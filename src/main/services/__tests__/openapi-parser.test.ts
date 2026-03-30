import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseOpenApiToRequests } from '../openapi-parser'

vi.mock('@apidevtools/swagger-parser', () => ({
  default: {
    dereference: vi.fn()
  }
}))

import SwaggerParser from '@apidevtools/swagger-parser'
const mockDereference = vi.mocked(SwaggerParser.dereference)

const OAS3_SPEC = {
  openapi: '3.0.0',
  info: { title: 'Test', version: '1' },
  servers: [{ url: 'https://api.example.com/v1' }],
  paths: {
    '/users': {
      get: {
        tags: ['Users'],
        summary: 'List users',
        operationId: 'listUsers',
        parameters: [
          { in: 'query', name: 'page' },
          { in: 'query', name: 'limit' },
          { in: 'header', name: 'X-Tenant-Id' }
        ]
      },
      post: {
        tags: ['Users'],
        summary: 'Create user',
        operationId: 'createUser'
      }
    },
    '/users/{id}': {
      get: {
        tags: ['Users'],
        summary: 'Get user',
        operationId: 'getUser'
      },
      delete: {
        tags: ['Users'],
        operationId: 'deleteUser',
        description: 'Permanently removes a user'
      }
    },
    '/products': {
      get: {
        tags: ['Products'],
        summary: 'List products'
      }
    }
  }
}

const SWAGGER2_SPEC = {
  swagger: '2.0',
  info: { title: 'Swagger', version: '1' },
  host: 'api.example.com',
  basePath: '/v2',
  schemes: ['https'],
  paths: {
    '/items': {
      get: {
        tags: ['Items'],
        summary: 'List items'
      }
    }
  }
}

describe('parseOpenApiToRequests — OAS3', () => {
  beforeEach(() => {
    mockDereference.mockResolvedValue(OAS3_SPEC as never)
  })

  it('creates one group per unique tag', async () => {
    const { groups } = await parseOpenApiToRequests({}, 'col-1')
    const names = groups.map((g) => g.name)
    expect(names).toContain('Users')
    expect(names).toContain('Products')
    expect(groups).toHaveLength(2)
  })

  it('sets collectionId on every group', async () => {
    const { groups } = await parseOpenApiToRequests({}, 'col-1')
    for (const g of groups) expect(g.collectionId).toBe('col-1')
  })

  it('creates a request for every operation', async () => {
    const { requests } = await parseOpenApiToRequests({}, 'col-1')
    // GET /users, POST /users, GET /users/{id}, DELETE /users/{id}, GET /products = 5
    expect(requests).toHaveLength(5)
  })

  it('prepends server base URL to each request URL', async () => {
    const { requests } = await parseOpenApiToRequests({}, 'col-1')
    for (const r of requests) {
      expect(r.url).toMatch(/^https:\/\/api\.example\.com\/v1\//)
    }
  })

  it('uses summary as request name when available', async () => {
    const { requests } = await parseOpenApiToRequests({}, 'col-1')
    const listUsers = requests.find((r) => r.method === 'GET' && r.url.endsWith('/users'))
    expect(listUsers?.name).toBe('List users')
  })

  it('falls back to operationId when summary is absent', async () => {
    const { requests } = await parseOpenApiToRequests({}, 'col-1')
    const deleteUser = requests.find((r) => r.method === 'DELETE')
    expect(deleteUser?.name).toBe('deleteUser')
  })

  it('falls back to "METHOD /path" when neither summary nor operationId', async () => {
    const spec = {
      ...OAS3_SPEC,
      paths: { '/bare': { patch: { tags: ['Default'] } } }
    }
    mockDereference.mockResolvedValue(spec as never)
    const { requests } = await parseOpenApiToRequests({}, 'col-1')
    expect(requests[0].name).toBe('PATCH /bare')
  })

  it('uppercases the HTTP method', async () => {
    const { requests } = await parseOpenApiToRequests({}, 'col-1')
    for (const r of requests) {
      expect(r.method).toBe(r.method.toUpperCase())
    }
  })

  it('extracts query parameters', async () => {
    const { requests } = await parseOpenApiToRequests({}, 'col-1')
    const listUsers = requests.find((r) => r.method === 'GET' && r.url.endsWith('/users'))
    if (!listUsers) throw new Error('GET /users request not found')
    const params = JSON.parse(listUsers.params) as Array<{ key: string }>
    expect(params.map((p) => p.key)).toEqual(['page', 'limit'])
  })

  it('extracts header parameters', async () => {
    const { requests } = await parseOpenApiToRequests({}, 'col-1')
    const listUsers = requests.find((r) => r.method === 'GET' && r.url.endsWith('/users'))
    if (!listUsers) throw new Error('GET /users request not found')
    const headers = JSON.parse(listUsers.headers) as Array<{ key: string }>
    expect(headers.map((h) => h.key)).toEqual(['X-Tenant-Id'])
  })

  it('assigns requests to the correct group', async () => {
    const { groups, requests } = await parseOpenApiToRequests({}, 'col-1')
    const usersGroup = groups.find((g) => g.name === 'Users')
    const productsGroup = groups.find((g) => g.name === 'Products')
    if (!usersGroup) throw new Error('Users group not found')
    if (!productsGroup) throw new Error('Products group not found')
    const userRequests = requests.filter((r) => r.groupId === usersGroup.id)
    const productRequests = requests.filter((r) => r.groupId === productsGroup.id)
    expect(userRequests).toHaveLength(4)
    expect(productRequests).toHaveLength(1)
  })

  it('initialises all requests with isDirty = 0', async () => {
    const { requests } = await parseOpenApiToRequests({}, 'col-1')
    for (const r of requests) expect(r.isDirty).toBe(0)
  })

  it('initialises all requests with authType none', async () => {
    const { requests } = await parseOpenApiToRequests({}, 'col-1')
    for (const r of requests) expect(r.authType).toBe('none')
  })

  it('assigns incrementing sortOrder to requests', async () => {
    const { requests } = await parseOpenApiToRequests({}, 'col-1')
    const orders = requests.map((r) => r.sortOrder)
    expect(orders).toEqual([...Array(requests.length).keys()])
  })

  it('assigns unique UUIDs to all groups and requests', async () => {
    const { groups, requests } = await parseOpenApiToRequests({}, 'col-1')
    const allIds = [...groups.map((g) => g.id), ...requests.map((r) => r.id)]
    const unique = new Set(allIds)
    expect(unique.size).toBe(allIds.length)
  })

  it('uses description from operation when present', async () => {
    const { requests } = await parseOpenApiToRequests({}, 'col-1')
    const deleteUser = requests.find((r) => r.method === 'DELETE')
    expect(deleteUser?.description).toBe('Permanently removes a user')
  })
})

describe('parseOpenApiToRequests — Swagger 2.x', () => {
  beforeEach(() => {
    mockDereference.mockResolvedValue(SWAGGER2_SPEC as never)
  })

  it('builds base URL from host + basePath + scheme', async () => {
    const { requests } = await parseOpenApiToRequests({}, 'col-2')
    expect(requests[0].url).toBe('https://api.example.com/v2/items')
  })

  it('defaults to https when no scheme specified', async () => {
    const spec = { ...SWAGGER2_SPEC, schemes: undefined }
    mockDereference.mockResolvedValue(spec as never)
    const { requests } = await parseOpenApiToRequests({}, 'col-2')
    expect(requests[0].url).toMatch(/^https:\/\//)
  })

  it('handles missing host by using only basePath', async () => {
    const spec = { ...SWAGGER2_SPEC, host: undefined }
    mockDereference.mockResolvedValue(spec as never)
    const { requests } = await parseOpenApiToRequests({}, 'col-2')
    expect(requests[0].url).toBe('/v2/items')
  })
})

describe('parseOpenApiToRequests — edge cases', () => {
  it('returns empty groups and requests when paths is absent', async () => {
    mockDereference.mockResolvedValue({ openapi: '3.0.0' } as never)
    const result = await parseOpenApiToRequests({}, 'col-1')
    expect(result.groups).toHaveLength(0)
    expect(result.requests).toHaveLength(0)
  })

  it('uses "Default" tag group for operations without tags', async () => {
    const spec = {
      openapi: '3.0.0',
      servers: [{ url: '' }],
      paths: { '/ping': { get: { summary: 'Ping' } } }
    }
    mockDereference.mockResolvedValue(spec as never)
    const { groups } = await parseOpenApiToRequests({}, 'col-1')
    expect(groups[0].name).toBe('Default')
  })

  it('reuses the same group for multiple operations sharing a tag', async () => {
    mockDereference.mockResolvedValue(OAS3_SPEC as never)
    const { groups, requests } = await parseOpenApiToRequests({}, 'col-1')
    const usersGroup = groups.find((g) => g.name === 'Users')
    if (!usersGroup) throw new Error('Users group not found')
    const usersRequests = requests.filter((r) => r.groupId === usersGroup.id)
    // GET /users, POST /users, GET /users/{id}, DELETE /users/{id}
    expect(usersRequests).toHaveLength(4)
    // Only one Users group was created
    expect(groups.filter((g) => g.name === 'Users')).toHaveLength(1)
  })
})
