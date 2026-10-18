import { MocklyServer, type HttpMock, type MocklyServerOptions } from './mockly'

export interface StubRequestMatcher {
  method: string
  path: string
  query?: Record<string, string>
  headers?: Record<string, string>
  auth?: HttpMock['request']['auth']
}

export interface StubResponseDefinition {
  status: number
  headers?: Record<string, string>
  body?: string | number | boolean | Record<string, unknown> | Array<unknown> | null
  delayMs?: number
}

export interface StubDefinition {
  id?: string
  method?: string
  path?: string
  query?: Record<string, string>
  headers?: Record<string, string>
  auth?: HttpMock['request']['auth']
  request?: StubRequestMatcher
  response: StubResponseDefinition
}

export interface StubHandle {
  readonly id: string
  readonly method: string
  readonly path: string
}

export interface CapturedStubRequest {
  method: string
  path: string
  query: Record<string, string>
  headers: Record<string, string>
  body?: string
}

export interface StartStubServerOptions {
  ensureInstalled?: boolean
  scenarios?: MocklyServerOptions['scenarios']
}

function toDelayString(delayMs: number | undefined): string | undefined {
  return delayMs == null ? undefined : `${delayMs}ms`
}

function normalizeBody(body: StubResponseDefinition['body']): string | undefined {
  if (body === undefined) return undefined
  if (typeof body === 'string') return body
  return JSON.stringify(body)
}

function normalizeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  )
}

function normalizeCapturedPath(pathWithQuery: string): { path: string; query: Record<string, string> } {
  const parsed = new URL(pathWithQuery, 'http://stub.local')
  return {
    path: parsed.pathname,
    query: Object.fromEntries(parsed.searchParams.entries()),
  }
}

function normalizeCapturedRequest(call: { method?: string; path: string; headers?: Record<string, string>; body?: string }): CapturedStubRequest {
  const { path, query } = normalizeCapturedPath(call.path)
  return {
    method: call.method ?? 'GET',
    path,
    query,
    headers: normalizeHeaders(call.headers),
    body: call.body,
  }
}

async function waitForHttpReady(server: MocklyServer, timeoutMs = 8_000): Promise<void> {
  const probeId = `ready-${crypto.randomUUID()}`
  const probePath = `/__http-stub-ready/${probeId}`
  await server.addMock({
    id: probeId,
    request: { method: 'GET', path: probePath },
    response: { status: 204 },
  })

  try {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${server.httpBase}${probePath}`, {
          signal: AbortSignal.timeout(500),
        })
        if (response.status === 204) return
      } catch {
        // HTTP server may still be starting.
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 100))
    }

    throw new Error(`HTTP stub server did not become ready within ${timeoutMs}ms`)
  } finally {
    await server.deleteMock(probeId).catch(() => undefined)
  }
}

export class HttpStubServer {
  constructor(private readonly inner: MocklyServer) {}

  get baseUrl(): string {
    return this.inner.httpBase
  }

  get httpBase(): string {
    return this.baseUrl
  }

  async stub(definition: StubDefinition): Promise<StubHandle> {
    const request = definition.request ?? {
      method: definition.method,
      path: definition.path,
      query: definition.query,
      headers: definition.headers,
      auth: definition.auth,
    }

    if (!request.method || !request.path) {
      throw new Error('Stub definitions require a method and path')
    }

    const handle: StubHandle = {
      id: definition.id ?? `stub-${crypto.randomUUID()}`,
      method: request.method,
      path: request.path,
    }

    await this.inner.addMock({
      id: handle.id,
      request: {
        method: request.method,
        path: request.path,
        query: request.query,
        headers: request.headers,
        auth: request.auth,
      },
      response: {
        status: definition.response.status,
        headers: definition.response.headers,
        body: normalizeBody(definition.response.body),
        delay: toDelayString(definition.response.delayMs),
      },
    })

    return handle
  }

  async requestsTo(handle: StubHandle): Promise<CapturedStubRequest[]> {
    const { calls } = await this.inner.getCalls(handle.id)
    return calls.map(normalizeCapturedRequest)
  }

  async waitForRequests(handle: StubHandle, count = 1, options: { timeoutMs?: number } = {}): Promise<CapturedStubRequest[]> {
    const timeoutMs = options.timeoutMs ?? 10_000
    const { calls } = await this.inner.waitForCalls(handle.id, count, `${timeoutMs}ms`)
    return calls.map(normalizeCapturedRequest)
  }

  reset(): Promise<void> {
    return this.inner.reset()
  }

  stop(): Promise<void> {
    return this.inner.stop()
  }
}

export async function startStubServer(options: StartStubServerOptions = {}): Promise<HttpStubServer> {
  const server = options.ensureInstalled
    ? await MocklyServer.ensure({ scenarios: options.scenarios })
    : await MocklyServer.create({ scenarios: options.scenarios })
  await waitForHttpReady(server)
  return new HttpStubServer(server)
}
