/**
 * Integration tests for backstage.ts using Mockly as a real HTTP backend.
 *
 * Unlike backstage.test.ts (which mocks axios), these tests exercise the
 * real HTTP path: the service makes actual network requests to Mockly.
 * Only the database layer is mocked.
 *
 * Prerequisites: run `node scripts/download-mockly.mjs` to download the binary.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'

vi.mock('../../database', () => ({
  queryOne: vi.fn().mockReturnValue(null),
  run: vi.fn(),
}))

vi.mock('electron', () => ({ BrowserWindow: vi.fn() }))

import { queryOne, run } from '../../database'
import { syncCatalog, authenticateWithBackstageGuest } from '../backstage'
import { MocklyServer } from './helpers/mockly'

// ─── Minimal OpenAPI spec for testing ────────────────────────────────────────

const MINIMAL_OAS3 = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Pet Store', version: '1.0.0' },
  paths: {
    '/pets': {
      get: {
        summary: 'List pets',
        operationId: 'listPets',
        tags: ['pets'],
        responses: { '200': { description: 'OK' } },
      },
      post: {
        summary: 'Create pet',
        operationId: 'createPet',
        tags: ['pets'],
        responses: { '201': { description: 'Created' } },
      },
    },
  },
})

// ─── Server lifecycle ─────────────────────────────────────────────────────────

let server: MocklyServer

beforeAll(async () => {
  server = await MocklyServer.create()
}, 30_000)

afterAll(() => server?.stop())

beforeEach(async () => {
  vi.clearAllMocks()
  await server.reset()
  vi.mocked(queryOne).mockReturnValue(null)
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function settings(overrides: Record<string, unknown> = {}) {
  return {
    baseUrl: server.httpBase,
    token: 'test-token',
    autoSync: false,
    ...overrides,
  }
}

const EMPTY_CATALOG_MOCKS = [
  {
    id: 'catalog-apis',
    request: { method: 'GET', path: '/api/catalog/entities', query: { filter: 'kind=API' } },
    response: { status: 200, headers: { 'Content-Type': 'application/json' }, body: '[]' },
  },
  {
    id: 'catalog-components',
    request: { method: 'GET', path: '/api/catalog/entities', query: { filter: 'kind=Component' } },
    response: { status: 200, headers: { 'Content-Type': 'application/json' }, body: '[]' },
  },
]

async function setupEmptyCatalog() {
  for (const mock of EMPTY_CATALOG_MOCKS) await server.addMock(mock)
}

// ─── syncCatalog — empty catalog ─────────────────────────────────────────────

describe('syncCatalog — empty catalog', () => {
  it('returns zero counts when both endpoints return empty arrays', async () => {
    await setupEmptyCatalog()
    const result = await syncCatalog(settings())
    expect(result).toEqual({ entitiesFound: 0, synced: 0, skipped: 0, errors: [] })
  })

  it('does not call run() when there are no entities', async () => {
    await setupEmptyCatalog()
    await syncCatalog(settings())
    expect(vi.mocked(run)).not.toHaveBeenCalled()
  })
})

// ─── syncCatalog — standalone API with inline OpenAPI spec ───────────────────

describe('syncCatalog — standalone API entity', () => {
  const API_ENTITY = {
    metadata: { name: 'pet-store', namespace: 'default' },
    spec: { type: 'openapi', definition: MINIMAL_OAS3 },
  }

  beforeEach(async () => {
    await server.addMock({
      id: 'catalog-apis',
      request: { method: 'GET', path: '/api/catalog/entities', query: { filter: 'kind=API' } },
      response: {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([API_ENTITY]),
      },
    })
    await server.addMock({
      id: 'catalog-components',
      request: { method: 'GET', path: '/api/catalog/entities', query: { filter: 'kind=Component' } },
      response: { status: 200, headers: { 'Content-Type': 'application/json' }, body: '[]' },
    })
  })

  it('reports 1 entity found and 1 synced', async () => {
    const result = await syncCatalog(settings())
    expect(result.entitiesFound).toBe(1)
    expect(result.synced).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.errors).toHaveLength(0)
  })

  it('inserts a new collection row for the API', async () => {
    await syncCatalog(settings())
    const insertCalls = vi.mocked(run).mock.calls.filter(([sql]) =>
      (sql as string).startsWith('INSERT INTO folders') && (sql as string).includes("'backstage'"),
    )
    expect(insertCalls).toHaveLength(1)
    const [sql, params] = insertCalls[0]
    expect((params as unknown[])[1]).toBe('pet-store') // collection name
    expect(sql).toContain("'backstage'")  // source is a literal in the SQL
  })

  it('updates existing collection instead of inserting when it already exists', async () => {
    vi.mocked(queryOne).mockReturnValue({ id: 'existing-coll-id' })
    await syncCatalog(settings())
    const updateCalls = vi.mocked(run).mock.calls.filter(([sql]) =>
      (sql as string).startsWith('UPDATE folders'),
    )
    const insertCalls = vi.mocked(run).mock.calls.filter(([sql]) =>
      (sql as string).startsWith('INSERT INTO folders') && (sql as string).includes("'backstage'"),
    )
    expect(updateCalls).toHaveLength(1)
    expect(insertCalls).toHaveLength(0)
  })

  it('inserts a group row for the pets tag', async () => {
    await syncCatalog(settings())
    const groupInserts = vi.mocked(run).mock.calls.filter(([sql]) =>
      (sql as string).startsWith('INSERT INTO folders'),
    )
    expect(groupInserts.length).toBeGreaterThanOrEqual(1)
    const groupNames = groupInserts.map(([, params]) => (params as unknown[])[2])
    expect(groupNames).toContain('pets')
  })

  it('inserts request rows for the openapi paths', async () => {
    await syncCatalog(settings())
    const reqInserts = vi.mocked(run).mock.calls.filter(([sql]) =>
      (sql as string).startsWith('INSERT INTO requests'),
    )
    expect(reqInserts.length).toBeGreaterThanOrEqual(2) // listPets + createPet
  })

  it('clears old groups and requests before re-importing', async () => {
    await syncCatalog(settings())
    const deleteGroupsCalls = vi.mocked(run).mock.calls.filter(([sql]) =>
      (sql as string).startsWith('DELETE FROM folders'),
    )
    const deleteRequestsCalls = vi.mocked(run).mock.calls.filter(([sql]) =>
      (sql as string).startsWith('DELETE FROM requests'),
    )
    expect(deleteGroupsCalls).toHaveLength(1)
    expect(deleteRequestsCalls).toHaveLength(1)
  })
})

// ─── syncCatalog — API with spec URL annotation ───────────────────────────────

describe('syncCatalog — API with spec URL annotation', () => {
  it('fetches spec from annotation URL and parses it', async () => {
    const specPath = '/backstage-specs/pet-store.json'
    const API_ENTITY = {
      metadata: {
        name: 'pet-store-annotated',
        namespace: 'default',
        annotations: { 'backstage.io/api-spec': `${server.httpBase}${specPath}` },
      },
      spec: { type: 'openapi' }, // no inline definition
    }

    await server.addMock({
      id: 'catalog-apis',
      request: { method: 'GET', path: '/api/catalog/entities', query: { filter: 'kind=API' } },
      response: {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([API_ENTITY]),
      },
    })
    await server.addMock({
      id: 'catalog-components',
      request: { method: 'GET', path: '/api/catalog/entities', query: { filter: 'kind=Component' } },
      response: { status: 200, headers: { 'Content-Type': 'application/json' }, body: '[]' },
    })
    await server.addMock({
      id: 'api-spec',
      request: { method: 'GET', path: specPath },
      response: {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: MINIMAL_OAS3,
      },
    })

    const result = await syncCatalog(settings())
    expect(result.synced).toBe(1)
    expect(result.errors).toHaveLength(0)

    const reqInserts = vi.mocked(run).mock.calls.filter(([sql]) =>
      (sql as string).startsWith('INSERT INTO requests'),
    )
    expect(reqInserts.length).toBeGreaterThanOrEqual(2)
  })

  it('adds to errors when spec URL fetch fails', async () => {
    const API_ENTITY = {
      metadata: {
        name: 'broken-api',
        namespace: 'default',
        annotations: { 'backstage.io/api-spec': `${server.httpBase}/no-such-spec` },
      },
      spec: { type: 'openapi' },
    }

    await server.addMock({
      id: 'catalog-apis',
      request: { method: 'GET', path: '/api/catalog/entities', query: { filter: 'kind=API' } },
      response: {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([API_ENTITY]),
      },
    })
    await server.addMock({
      id: 'catalog-components',
      request: { method: 'GET', path: '/api/catalog/entities', query: { filter: 'kind=Component' } },
      response: { status: 200, headers: { 'Content-Type': 'application/json' }, body: '[]' },
    })
    await server.addMock({
      id: 'missing-spec',
      request: { method: 'GET', path: '/no-such-spec' },
      response: { status: 404, body: 'Not Found' },
    })

    const result = await syncCatalog(settings())
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('broken-api')
    expect(result.synced).toBe(0)
    expect(result.skipped).toBe(1)
  })
})

// ─── syncCatalog — API with no definition ────────────────────────────────────

describe('syncCatalog — API with no definition', () => {
  it('adds to errors when no definition and no annotation', async () => {
    const API_ENTITY = {
      metadata: { name: 'no-def-api', namespace: 'default' },
      spec: { type: 'openapi' }, // no definition, no annotation
    }

    await server.addMock({
      id: 'catalog-apis',
      request: { method: 'GET', path: '/api/catalog/entities', query: { filter: 'kind=API' } },
      response: {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([API_ENTITY]),
      },
    })
    await server.addMock({
      id: 'catalog-components',
      request: { method: 'GET', path: '/api/catalog/entities', query: { filter: 'kind=Component' } },
      response: { status: 200, headers: { 'Content-Type': 'application/json' }, body: '[]' },
    })

    const result = await syncCatalog(settings())
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('no-def-api')
    expect(result.skipped).toBe(1)
  })
})

// ─── syncCatalog — component owning APIs ─────────────────────────────────────

describe('syncCatalog — component owning API via providesApis', () => {
  it('groups API under component collection name', async () => {
    const API_ENTITY = {
      metadata: { name: 'pet-store', namespace: 'default' },
      spec: { type: 'openapi', definition: MINIMAL_OAS3 },
    }
    const COMPONENT_ENTITY = {
      metadata: { name: 'my-service', namespace: 'default' },
      spec: { providesApis: ['pet-store'] },
      relations: [],
    }

    await server.addMock({
      id: 'catalog-apis',
      request: { method: 'GET', path: '/api/catalog/entities', query: { filter: 'kind=API' } },
      response: {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([API_ENTITY]),
      },
    })
    await server.addMock({
      id: 'catalog-components',
      request: { method: 'GET', path: '/api/catalog/entities', query: { filter: 'kind=Component' } },
      response: {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([COMPONENT_ENTITY]),
      },
    })

    const result = await syncCatalog(settings())
    expect(result.entitiesFound).toBe(1)
    expect(result.synced).toBe(1)

    const collectionInserts = vi.mocked(run).mock.calls.filter(([sql]) =>
      (sql as string).startsWith('INSERT INTO folders'),
    )
    // The collection should be named after the component, not the API
    expect(collectionInserts[0][1] as unknown[]).toContain('my-service')
  })
})

describe('syncCatalog — component owning API via relations', () => {
  it('groups API under component collection name via relation targetRef', async () => {
    const API_ENTITY = {
      metadata: { name: 'pet-store', namespace: 'default' },
      spec: { type: 'openapi', definition: MINIMAL_OAS3 },
    }
    const COMPONENT_ENTITY = {
      metadata: { name: 'my-service', namespace: 'default' },
      spec: {},
      relations: [{ type: 'providesApi', targetRef: 'api:default/pet-store' }],
    }

    await server.addMock({
      id: 'catalog-apis',
      request: { method: 'GET', path: '/api/catalog/entities', query: { filter: 'kind=API' } },
      response: {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([API_ENTITY]),
      },
    })
    await server.addMock({
      id: 'catalog-components',
      request: { method: 'GET', path: '/api/catalog/entities', query: { filter: 'kind=Component' } },
      response: {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([COMPONENT_ENTITY]),
      },
    })

    const result = await syncCatalog(settings())
    expect(result.synced).toBe(1)

    const collectionInserts = vi.mocked(run).mock.calls.filter(([sql]) =>
      (sql as string).startsWith('INSERT INTO folders'),
    )
    expect(collectionInserts[0][1] as unknown[]).toContain('my-service')
  })
})

// ─── syncCatalog — non-OpenAPI types ─────────────────────────────────────────

describe('syncCatalog — GraphQL API type', () => {
  it('stores raw definition with protocol graphql', async () => {
    const GRAPHQL_ENTITY = {
      metadata: { name: 'my-graph', namespace: 'default' },
      spec: { type: 'graphql', definition: 'type Query { hello: String }' },
    }

    await server.addMock({
      id: 'catalog-apis',
      request: { method: 'GET', path: '/api/catalog/entities', query: { filter: 'kind=API' } },
      response: {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([GRAPHQL_ENTITY]),
      },
    })
    await server.addMock({
      id: 'catalog-components',
      request: { method: 'GET', path: '/api/catalog/entities', query: { filter: 'kind=Component' } },
      response: { status: 200, headers: { 'Content-Type': 'application/json' }, body: '[]' },
    })

    const result = await syncCatalog(settings())
    expect(result.synced).toBe(1)
    expect(result.errors).toHaveLength(0)

    const groupInserts = vi.mocked(run).mock.calls.filter(([sql]) =>
      (sql as string).startsWith('INSERT INTO folders'),
    )
    const groupNames = groupInserts.map(([, params]) => (params as unknown[])[2])
    expect(groupNames).toContain('GraphQL Schema')

    const reqInserts = vi.mocked(run).mock.calls.filter(([sql]) =>
      (sql as string).includes('protocol_config'),
    )
    // protocol_config should contain the SDL as schema
    const protocolConfigStr = (reqInserts[0][1] as unknown[])[12] as string
    const configObj = JSON.parse(protocolConfigStr)
    expect(configObj).toHaveProperty('schema', 'type Query { hello: String }')
  })
})

describe('syncCatalog — gRPC API type', () => {
  it('stores raw definition with protocol grpc', async () => {
    const GRPC_ENTITY = {
      metadata: { name: 'my-service', namespace: 'default' },
      spec: { type: 'grpc', definition: 'syntax = "proto3"; service Greeter {}' },
    }

    await server.addMock({
      id: 'catalog-apis',
      request: { method: 'GET', path: '/api/catalog/entities', query: { filter: 'kind=API' } },
      response: {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([GRPC_ENTITY]),
      },
    })
    await server.addMock({
      id: 'catalog-components',
      request: { method: 'GET', path: '/api/catalog/entities', query: { filter: 'kind=Component' } },
      response: { status: 200, headers: { 'Content-Type': 'application/json' }, body: '[]' },
    })

    const result = await syncCatalog(settings())
    expect(result.synced).toBe(1)
    expect(result.errors).toHaveLength(0)

    const groupInserts = vi.mocked(run).mock.calls.filter(([sql]) =>
      (sql as string).startsWith('INSERT INTO folders'),
    )
    const groupNames = groupInserts.map(([, params]) => (params as unknown[])[2])
    expect(groupNames).toContain('gRPC Schema')

    const reqInserts = vi.mocked(run).mock.calls.filter(([sql]) =>
      (sql as string).includes('protocol_config'),
    )
    const protocolConfigStr = (reqInserts[0][1] as unknown[])[12] as string
    const configObj = JSON.parse(protocolConfigStr)
    expect(configObj).toHaveProperty('protoContent', 'syntax = "proto3"; service Greeter {}')
  })
})

// ─── syncCatalog — auth header forwarded ─────────────────────────────────────

describe('syncCatalog — auth token', () => {
  it('forwards the Bearer token as Authorization header', async () => {
    await server.addMock({
      id: 'catalog-apis',
      request: {
        method: 'GET',
        path: '/api/catalog/entities',
        query: { filter: 'kind=API' },
        headers: { Authorization: 'Bearer my-secret-token' },
      },
      response: { status: 200, headers: { 'Content-Type': 'application/json' }, body: '[]' },
    })
    await server.addMock({
      id: 'catalog-components',
      request: {
        method: 'GET',
        path: '/api/catalog/entities',
        query: { filter: 'kind=Component' },
        headers: { Authorization: 'Bearer my-secret-token' },
      },
      response: { status: 200, headers: { 'Content-Type': 'application/json' }, body: '[]' },
    })

    // If the token isn't forwarded, Mockly won't match the header and will 404
    const result = await syncCatalog(settings({ token: 'my-secret-token' }))
    expect(result).toBeDefined()
  })
})

// ─── authenticateWithBackstageGuest ─────────────────────────────────────────

describe('authenticateWithBackstageGuest', () => {
  const GUEST_RESPONSE = {
    backstageIdentity: { token: 'guest-token-abc' },
    profile: { displayName: 'Guest User', email: 'guest@example.com', picture: 'https://example.com/pic.png' },
  }

  it('returns token and user profile on success', async () => {
    await server.addMock({
      id: 'guest-refresh',
      request: { method: 'POST', path: '/api/auth/guest/refresh' },
      response: {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(GUEST_RESPONSE),
      },
    })

    const result = await authenticateWithBackstageGuest(server.httpBase)
    expect(result.token).toBe('guest-token-abc')
    expect(result.user.name).toBe('Guest User')
    expect(result.user.email).toBe('guest@example.com')
    expect(result.user.picture).toBe('https://example.com/pic.png')
  })

  it('strips trailing slash from baseUrl', async () => {
    await server.addMock({
      id: 'guest-refresh',
      request: { method: 'POST', path: '/api/auth/guest/refresh' },
      response: {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(GUEST_RESPONSE),
      },
    })

    // Pass URL with trailing slash — should still work
    const result = await authenticateWithBackstageGuest(`${server.httpBase}/`)
    expect(result.token).toBe('guest-token-abc')
  })

  it('defaults user name to Guest when displayName is absent', async () => {
    await server.addMock({
      id: 'guest-refresh',
      request: { method: 'POST', path: '/api/auth/guest/refresh' },
      response: {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backstageIdentity: { token: 'tok' }, profile: {} }),
      },
    })

    const result = await authenticateWithBackstageGuest(server.httpBase)
    expect(result.user.name).toBe('Guest')
  })

  it('throws when response has no token', async () => {
    await server.addMock({
      id: 'guest-refresh',
      request: { method: 'POST', path: '/api/auth/guest/refresh' },
      response: {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backstageIdentity: {}, profile: {} }),
      },
    })

    await expect(authenticateWithBackstageGuest(server.httpBase)).rejects.toThrow(
      'Guest refresh did not return a token',
    )
  })

  it('throws when server returns non-2xx', async () => {
    await server.addMock({
      id: 'guest-refresh',
      request: { method: 'POST', path: '/api/auth/guest/refresh' },
      response: { status: 401, body: 'Unauthorized' },
    })

    await expect(authenticateWithBackstageGuest(server.httpBase)).rejects.toThrow()
  })
})
