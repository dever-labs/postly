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

  it('creates one folder per unique tag', async () => {
    const { folders } = await parseOpenApiToRequests({}, 'col-1')
    const names = folders.map((folder) => folder.name)
    expect(names).toContain('Users')
    expect(names).toContain('Products')
    expect(folders).toHaveLength(2)
  })

  it('places a multi-tag operation in the first tag folder', async () => {
    const spec = {
      ...OAS3_SPEC,
      paths: {
        '/reports': {
          get: {
            tags: ['Reports', 'Admin'],
            summary: 'List reports',
          }
        }
      }
    }
    mockDereference.mockResolvedValue(spec as never)

    const { folders, requests } = await parseOpenApiToRequests({}, 'col-1')
    const reportsFolder = folders.find((folder) => folder.name === 'Reports')

    expect(folders.map((folder) => folder.name)).toEqual(['Reports'])
    expect(reportsFolder).toBeDefined()
    expect(requests[0].folderId).toBe(reportsFolder?.id)
  })

  it('sets parentId on every folder', async () => {
    const { folders } = await parseOpenApiToRequests({}, 'col-1')
    for (const folder of folders) expect(folder.parentId).toBe('col-1')
  })

  it('creates a request for every operation', async () => {
    const { requests } = await parseOpenApiToRequests({}, 'col-1')
    expect(requests).toHaveLength(5)
  })

  it('prepends server base URL to each request URL', async () => {
    const { requests } = await parseOpenApiToRequests({}, 'col-1')
    for (const request of requests) {
      expect(request.url).toMatch(/^https:\/\/api\.example\.com\/v1\//)
    }
  })

  it('uses summary as request name when available', async () => {
    const { requests } = await parseOpenApiToRequests({}, 'col-1')
    const listUsers = requests.find((request) => request.method === 'GET' && request.url.endsWith('/users'))
    expect(listUsers?.name).toBe('List users')
  })

  it('falls back to operationId when summary is absent', async () => {
    const { requests } = await parseOpenApiToRequests({}, 'col-1')
    const deleteUser = requests.find((request) => request.method === 'DELETE')
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
    for (const request of requests) {
      expect(request.method).toBe(request.method.toUpperCase())
    }
  })

  it('extracts query parameters', async () => {
    const { requests } = await parseOpenApiToRequests({}, 'col-1')
    const listUsers = requests.find((request) => request.method === 'GET' && request.url.endsWith('/users'))
    if (!listUsers) throw new Error('GET /users request not found')
    const params = JSON.parse(listUsers.params) as Array<{ key: string }>
    expect(params.map((param) => param.key)).toEqual(['page', 'limit'])
  })

  it('extracts header parameters', async () => {
    const { requests } = await parseOpenApiToRequests({}, 'col-1')
    const listUsers = requests.find((request) => request.method === 'GET' && request.url.endsWith('/users'))
    if (!listUsers) throw new Error('GET /users request not found')
    const headers = JSON.parse(listUsers.headers) as Array<{ key: string }>
    expect(headers.map((header) => header.key)).toEqual(['X-Tenant-Id'])
  })

  it('assigns requests to the correct folder', async () => {
    const { folders, requests } = await parseOpenApiToRequests({}, 'col-1')
    const usersFolder = folders.find((folder) => folder.name === 'Users')
    const productsFolder = folders.find((folder) => folder.name === 'Products')
    if (!usersFolder) throw new Error('Users folder not found')
    if (!productsFolder) throw new Error('Products folder not found')
    const userRequests = requests.filter((request) => request.folderId === usersFolder.id)
    const productRequests = requests.filter((request) => request.folderId === productsFolder.id)
    expect(userRequests).toHaveLength(4)
    expect(productRequests).toHaveLength(1)
  })

  it('initialises all requests with isDirty = 0', async () => {
    const { requests } = await parseOpenApiToRequests({}, 'col-1')
    for (const request of requests) expect(request.isDirty).toBe(0)
  })

  it('initialises all requests with authType none', async () => {
    const { requests } = await parseOpenApiToRequests({}, 'col-1')
    for (const request of requests) expect(request.authType).toBe('none')
  })

  it('assigns incrementing sortOrder within each folder', async () => {
    const { folders, requests } = await parseOpenApiToRequests({}, 'col-1')
    for (const folder of folders) {
      const orders = requests.filter((request) => request.folderId === folder.id).map((request) => request.sortOrder)
      expect(orders).toEqual([...Array(orders.length).keys()])
    }
  })

  it('assigns unique UUIDs to all folders and requests', async () => {
    const { folders, requests } = await parseOpenApiToRequests({}, 'col-1')
    const allIds = [...folders.map((folder) => folder.id), ...requests.map((request) => request.id)]
    expect(new Set(allIds).size).toBe(allIds.length)
  })

  it('uses description from operation when present', async () => {
    const { requests } = await parseOpenApiToRequests({}, 'col-1')
    const deleteUser = requests.find((request) => request.method === 'DELETE')
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
  it('returns empty folders and requests when paths is absent', async () => {
    mockDereference.mockResolvedValue({ openapi: '3.0.0' } as never)
    const result = await parseOpenApiToRequests({}, 'col-1')
    expect(result.folders).toHaveLength(0)
    expect(result.requests).toHaveLength(0)
  })

  it('places untagged operations directly in the parent folder', async () => {
    const spec = {
      openapi: '3.0.0',
      servers: [{ url: '' }],
      paths: { '/ping': { get: { summary: 'Ping' } } }
    }
    mockDereference.mockResolvedValue(spec as never)
    const { folders, requests } = await parseOpenApiToRequests({}, 'col-1')
    expect(folders).toHaveLength(0)
    expect(requests[0].folderId).toBe('col-1')
  })

  it('treats an empty tags array as untagged and keeps the request in the parent folder', async () => {
    const spec = {
      openapi: '3.0.0',
      servers: [{ url: '' }],
      paths: {
        '/health': {
          get: {
            tags: [],
            summary: 'Get health',
          }
        }
      }
    }
    mockDereference.mockResolvedValue(spec as never)

    const { folders, requests } = await parseOpenApiToRequests({}, 'col-1')
    expect(folders).toHaveLength(0)
    expect(requests[0].folderId).toBe('col-1')
  })

  it('reuses the same folder for multiple operations sharing a tag', async () => {
    mockDereference.mockResolvedValue(OAS3_SPEC as never)
    const { folders, requests } = await parseOpenApiToRequests({}, 'col-1')
    const usersFolder = folders.find((folder) => folder.name === 'Users')
    if (!usersFolder) throw new Error('Users folder not found')
    const usersRequests = requests.filter((request) => request.folderId === usersFolder.id)
    expect(usersRequests).toHaveLength(4)
    expect(folders.filter((folder) => folder.name === 'Users')).toHaveLength(1)
  })

  it('sets request folderId values to the deduplicated folder id for shared tags', async () => {
    const spec = {
      openapi: '3.0.0',
      servers: [{ url: '' }],
      paths: {
        '/users': {
          get: { tags: ['Users'], summary: 'List users' },
          post: { tags: ['Users'], summary: 'Create user' },
        }
      }
    }
    mockDereference.mockResolvedValue(spec as never)

    const { folders, requests } = await parseOpenApiToRequests({}, 'col-1')
    const usersFolder = folders.find((folder) => folder.name === 'Users')

    expect(folders.filter((folder) => folder.name === 'Users')).toHaveLength(1)
    expect(usersFolder).toBeDefined()
    expect(requests.map((request) => request.folderId)).toEqual([
      usersFolder?.id,
      usersFolder?.id,
    ])
  })
})
