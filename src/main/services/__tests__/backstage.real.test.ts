import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'

vi.mock('../../database', () => ({
  queryOne: vi.fn(),
  run: vi.fn(),
}))

const { createdWindows } = vi.hoisted(() => ({ createdWindows: [] as Array<{
  webContents: {
    url: string
    emit: (event: 'did-finish-load') => void
  }
  close: () => void
  isDestroyed: () => boolean
}> }))

vi.mock('electron', () => {
  class FakeWebContents {
    url = ''
    private listeners: Record<string, Array<() => void>> = {}
    on(event: string, cb: () => void) { (this.listeners[event] ??= []).push(cb); return this }
    off(event: string, cb: () => void) {
      this.listeners[event] = (this.listeners[event] ?? []).filter((listener) => listener !== cb)
      return this
    }
    emit(event: 'did-finish-load') { for (const cb of [...(this.listeners[event] ?? [])]) cb() }
    getURL() { return this.url }
  }

  class BrowserWindow {
    webContents = new FakeWebContents()
    private destroyed = false
    private closedListeners: Array<() => void> = []
    constructor() {
      createdWindows.push(this as unknown as typeof createdWindows[number])
    }
    loadURL(url: string) { this.webContents.url = url }
    on(event: string, cb: () => void) { if (event === 'closed') this.closedListeners.push(cb); return this }
    off(event: string, cb: () => void) {
      if (event === 'closed') this.closedListeners = this.closedListeners.filter((listener) => listener !== cb)
      return this
    }
    isDestroyed() { return this.destroyed }
    close() {
      if (this.destroyed) return
      this.destroyed = true
      for (const cb of [...this.closedListeners]) cb()
    }
  }

  const session = {
    defaultSession: {},
    // The partition session fetch hits the live test server directly
    fromPartition: () => ({ fetch: (url: string, init?: RequestInit) => fetch(url, init) }),
  }

  return { BrowserWindow, session }
})

import { queryOne, run } from '../../database'
import { authenticateWithBackstage, authenticateWithBackstageGuest, syncCatalog } from '../backstage'

const mockQueryOne = vi.mocked(queryOne)
const mockRun = vi.mocked(run)

const MINIMAL_OAS3 = {
  openapi: '3.0.0',
  info: { title: 'Pets', version: '1.0.0' },
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        tags: ['pets'],
        responses: { '200': { description: 'OK' } },
      },
    },
  },
}

let server: http.Server
let base = ''
let apis: unknown[] = []
let components: unknown[] = []

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url?.startsWith('/api/catalog/entities?filter=kind=API')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(apis))
      return
    }
    if (req.url?.startsWith('/api/catalog/entities?filter=kind=Component')) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(components))
      return
    }
    if (req.url === '/specs/pets.json') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(MINIMAL_OAS3))
      return
    }
    if (req.url === '/api/auth/guest/refresh' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        backstageIdentity: { token: 'guest-token' },
        profile: { displayName: 'Guest User', email: 'guest@example.com' },
      }))
      return
    }
    if (req.url === '/api/auth/github/refresh') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        backstageIdentity: { token: 'oauth-token' },
        profile: { displayName: 'Octo User', email: 'octo@example.com' },
      }))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}, 30_000)

afterAll(() => {
  server.closeAllConnections()
  server.close()
})

beforeEach(() => {
  vi.clearAllMocks()
  apis = []
  components = []
  createdWindows.length = 0
  mockQueryOne.mockReturnValue(null)
})

describe('backstage service over real HTTP', () => {
  it('imports component-owned OpenAPI specs and standalone GraphQL definitions', async () => {
    apis = [
      {
        metadata: {
          name: 'pets-api',
          namespace: 'default',
          annotations: { 'backstage.io/api-spec': `${base}/specs/pets.json` },
        },
        spec: { type: 'openapi' },
      },
      {
        metadata: { name: 'search-graphql', namespace: 'default' },
        spec: { type: 'graphql', definition: 'type Query { search: String }' },
      },
    ]
    components = [
      {
        metadata: { name: 'catalog-service', namespace: 'default' },
        spec: { providesApis: ['pets-api'] },
        relations: [],
      },
    ]

    const result = await syncCatalog({ baseUrl: base, token: 'token', autoSync: false })

    expect(result).toEqual({ entitiesFound: 2, synced: 2, skipped: 0, errors: [] })
    const collectionInserts = mockRun.mock.calls.filter(([sql]) => String(sql).startsWith('INSERT INTO folders'))
    expect(collectionInserts[0]?.[1]).toContain('catalog-service')
    expect(collectionInserts.some(([, params]) => (params as unknown[]).includes('GraphQL Schema'))).toBe(true)
    const graphqlRequest = mockRun.mock.calls.find(([sql]) => String(sql).includes('protocol_config'))
    expect(JSON.parse(String((graphqlRequest?.[1] as unknown[])[12]))).toEqual({
      schema: 'type Query { search: String }',
    })
  })

  it('records an error when an OpenAPI entity has no definition or annotation', async () => {
    apis = [{ metadata: { name: 'broken-api', namespace: 'default' }, spec: { type: 'openapi' } }]
    const result = await syncCatalog({ baseUrl: base, token: 'token', autoSync: false })
    expect(result.synced).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.errors[0]).toContain('broken-api')
  })

  it('refreshes guest auth against the live endpoint', async () => {
    await expect(authenticateWithBackstageGuest(`${base}/`)).resolves.toEqual({
      token: 'guest-token',
      user: { name: 'Guest User', email: 'guest@example.com', picture: undefined },
    })
  })

  it('completes browser auth by fetching the provider refresh endpoint', async () => {
    const auth = authenticateWithBackstage(base, 'github')
    const win = createdWindows.at(-1)
    if (!win) throw new Error('Missing auth window')

    win.webContents.url = `${base}/after-login`
    win.webContents.emit('did-finish-load')

    await expect(auth).resolves.toEqual({
      token: 'oauth-token',
      user: { name: 'Octo User', email: 'octo@example.com', picture: undefined },
    })
  })
})
