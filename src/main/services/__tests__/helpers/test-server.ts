import { createServer } from 'node:net'
import type {
  CallEntry,
  FaultConfig as DriverFaultConfig,
  HttpMock as DriverHttpMock,
  MocklyServerOptions as DriverMocklyServerOptions,
  Scenario as DriverScenario,
} from '@dever-labs/mockly-driver'
import type { InstallOptions } from '@dever-labs/mockly-driver'

type DriverModule = typeof import('@dever-labs/mockly-driver')
type DriverServer = import('@dever-labs/mockly-driver').MocklyServer

type JsonBody = string | number | boolean | Record<string, unknown> | Array<unknown> | null

type DriverRequest = DriverHttpMock['request'] & {
  query?: Record<string, string>
  auth?: { type: 'ntlm' | 'bearer' | 'basic' | 'digest'; token?: string }
}

type DriverCompatibleHttpMock = Omit<DriverHttpMock, 'request'> & {
  request: DriverRequest
}

let driverPromise: Promise<DriverModule> | null = null

function loadMocklyDriver(): Promise<DriverModule> {
  driverPromise ??= import('@dever-labs/mockly-driver')
  return driverPromise
}

function toDelayString(delay: string | undefined, delayMs: number | undefined): string | undefined {
  if (delayMs != null) return `${delayMs}ms`
  return delay
}

function normalizeBody(body: JsonBody | undefined): string | undefined {
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

function normalizeCapturedRequest(call: CallEntry): CapturedRequest {
  const { path, query } = normalizeCapturedPath(call.path)
  return {
    method: call.method ?? 'GET',
    path,
    query,
    headers: normalizeHeaders(call.headers),
    body: call.body,
  }
}

function toDriverScenario(scenario: ScenarioDefinition): DriverScenario {
  return {
    id: scenario.id,
    name: scenario.name,
    description: scenario.description,
    patches: scenario.patches.map((patch) => ({
      mock_id: patch.stubId,
      status: patch.status,
      body: normalizeBody(patch.body),
      headers: patch.headers,
      delay: toDelayString(patch.delay, patch.delayMs),
      disabled: patch.disabled,
    })),
  }
}

function toDriverFault(config: FaultDefinition): DriverFaultConfig {
  return {
    enabled: config.enabled,
    delay: toDelayString(config.delay, config.delayMs),
    status: config.status,
    error_rate: config.errorRate,
  }
}

async function waitForHttpReady(server: DriverServer, timeoutMs = 8_000): Promise<void> {
  const probeId = `ready-${crypto.randomUUID()}`
  const probePath = `/__test-server-ready/${probeId}`
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

    throw new Error(`Test server did not become ready within ${timeoutMs}ms`)
  } finally {
    await server.deleteMock(probeId).catch(() => undefined)
  }
}

export interface RequestAuth {
  type: 'ntlm' | 'bearer' | 'basic' | 'digest'
  token?: string
}

export interface StubRequestMatcher {
  method: string
  path: string
  query?: Record<string, string>
  headers?: Record<string, string>
  auth?: RequestAuth
}

export interface StubResponseDefinition {
  status: number
  headers?: Record<string, string>
  body?: JsonBody
  delay?: string
  delayMs?: number
}

export interface StubDefinition {
  id?: string
  method?: string
  path?: string
  query?: Record<string, string>
  headers?: Record<string, string>
  auth?: RequestAuth
  request?: StubRequestMatcher
  response: StubResponseDefinition
}

export interface StubHandle {
  readonly id: string
  readonly method: string
  readonly path: string
}

export interface CapturedRequest {
  method: string
  path: string
  query: Record<string, string>
  headers: Record<string, string>
  body?: string
}

export interface ScenarioPatchDefinition {
  stubId: string
  status?: number
  body?: JsonBody
  headers?: Record<string, string>
  delay?: string
  delayMs?: number
  disabled?: boolean
}

export interface ScenarioDefinition {
  id: string
  name: string
  description?: string
  patches: ScenarioPatchDefinition[]
}

export interface FaultDefinition {
  enabled: boolean
  delay?: string
  delayMs?: number
  status?: number
  errorRate?: number
}

export interface StartTestServerOptions {
  ensureInstalled?: boolean
  install?: InstallOptions
  scenarios?: ScenarioDefinition[]
  waitUntilReadyTimeoutMs?: number
  https?: false
  port?: number
  apiPort?: number
}

export async function ensureInstalled(options?: InstallOptions): Promise<string> {
  const { install } = await loadMocklyDriver()
  return install(options)
}

export async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not determine a free port')))
        return
      }
      server.close((err) => {
        if (err) reject(err)
        else resolve(address.port)
      })
    })
  })
}

export class TestServer {
  constructor(private readonly inner: DriverServer) {}

  get baseUrl(): string {
    return this.inner.httpBase
  }

  get apiBase(): string {
    return this.inner.apiBase
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
        delay: toDelayString(definition.response.delay, definition.response.delayMs),
      },
    } as DriverCompatibleHttpMock)

    return handle
  }

  async requests(handle: StubHandle, options: { waitForCount?: number; timeoutMs?: number } = {}): Promise<CapturedRequest[]> {
    const summary = options.waitForCount == null
      ? await this.inner.getCalls(handle.id)
      : await this.inner.waitForCalls(handle.id, options.waitForCount, `${options.timeoutMs ?? 10_000}ms`)

    return summary.calls.map(normalizeCapturedRequest)
  }

  waitForRequests(handle: StubHandle, count = 1, options: { timeoutMs?: number } = {}): Promise<CapturedRequest[]> {
    return this.requests(handle, { waitForCount: count, timeoutMs: options.timeoutMs })
  }

  activateScenario(id: string): Promise<void> {
    return this.inner.activateScenario(id)
  }

  deactivateScenario(id: string): Promise<void> {
    return this.inner.deactivateScenario(id)
  }

  setFault(config: FaultDefinition): Promise<void> {
    return this.inner.setFault(toDriverFault(config))
  }

  clearFault(): Promise<void> {
    return this.inner.clearFault()
  }

  reset(): Promise<void> {
    return this.inner.reset()
  }

  stop(): Promise<void> {
    return this.inner.stop()
  }
}

export async function startTestServer(options: StartTestServerOptions = {}): Promise<TestServer> {
  if (options.https) {
    throw new Error('HTTPS test servers are not supported by @dever-labs/mockly-driver yet')
  }
  if (options.port != null || options.apiPort != null) {
    throw new Error('Custom test-server ports are not supported by @dever-labs/mockly-driver yet')
  }

  const driverOptions: DriverMocklyServerOptions = {
    scenarios: options.scenarios?.map(toDriverScenario),
  }

  const { MocklyServer } = await loadMocklyDriver()
  const server = options.ensureInstalled
    ? await MocklyServer.ensure({ ...driverOptions, ...options.install })
    : await MocklyServer.create(driverOptions)
  await waitForHttpReady(server, options.waitUntilReadyTimeoutMs)
  return new TestServer(server)
}
