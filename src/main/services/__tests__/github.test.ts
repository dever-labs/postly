import { beforeEach, describe, expect, it, vi } from 'vitest'
import axios from 'axios'
import crypto from 'crypto'
import SwaggerParser from '@apidevtools/swagger-parser'

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
  },
}))

vi.mock('../../database', () => ({
  queryOne: vi.fn(),
  run: vi.fn(),
}))

vi.mock('@apidevtools/swagger-parser', () => ({
  default: {
    dereference: vi.fn(),
  },
}))

vi.mock('../openapi-parser', () => ({
  parseOpenApiToRequests: vi.fn(),
}))

import { queryOne, run } from '../../database'
import { parseOpenApiToRequests } from '../openapi-parser'
import { discoverApis } from '../github'

const mockGet = vi.mocked(axios.get)
const mockQueryOne = vi.mocked(queryOne)
const mockRun = vi.mocked(run)
const mockDereference = vi.mocked(SwaggerParser.dereference)
const mockParseOpenApiToRequests = vi.mocked(parseOpenApiToRequests)

type ParsedRequests = Awaited<ReturnType<typeof parseOpenApiToRequests>>

const dereferencedSpec = {
  openapi: '3.0.0',
  info: { title: 'API', version: '1.0.0' },
  paths: {},
  components: {},
} as Awaited<ReturnType<typeof SwaggerParser.dereference>>

function makeParsed(collectionId: string): ParsedRequests {
  return {
    folders: [
      {
        id: 'folder-1',
        parentId: collectionId,
        name: 'Pets',
        description: 'Pet endpoints',
        hidden: false,
        collapsed: false,
        sortOrder: 0,
        createdAt: 101,
        updatedAt: 102,
      },
    ],
    requests: [
      {
        id: 'request-1',
        folderId: collectionId,
        name: 'List pets',
        method: 'GET',
        url: 'https://example.com/pets',
        params: '[]',
        headers: '{}',
        bodyType: 'none',
        bodyContent: '',
        authType: 'none',
        authConfig: '{}',
        description: 'Returns pets',
        scmPath: null,
        scmSha: null,
        isDirty: 0,
        sortOrder: 0,
        createdAt: 201,
        updatedAt: 202,
      },
    ],
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-000000000001' as `${string}-${string}-${string}-${string}-${string}`)
})

describe('discoverApis (GitHub)', () => {
  it('imports discovered specs, loops across orgs, and forwards auth headers', async () => {
    const token = 'gh-token'
    const parsed = makeParsed('00000000-0000-0000-0000-000000000001')

    mockGet
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              repository: { full_name: 'acme/orders' },
              path: 'openapi.yaml',
              sha: 'sha-1',
            },
          ],
        },
      })
      .mockResolvedValueOnce({ data: { openapi: '3.0.0' } })
      .mockResolvedValueOnce({ data: { items: [] } })
    mockDereference.mockResolvedValue(dereferencedSpec)
    mockParseOpenApiToRequests.mockResolvedValue(parsed)
    mockQueryOne.mockReturnValue(null)

    await discoverApis({
      baseUrl: 'https://github.com',
      clientId: 'cid',
      clientSecret: 'secret',
      token,
      repo: '',
      orgs: ['acme', 'empty-org'],
    })

    expect(mockGet).toHaveBeenNthCalledWith(
      1,
      'https://api.github.com/search/code?q=filename:openapi.yaml+org:acme',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
        }),
      }),
    )
    expect(mockGet).toHaveBeenNthCalledWith(
      2,
      'https://raw.githubusercontent.com/acme/orders/HEAD/openapi.yaml',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Bearer ${token}`,
        }),
      }),
    )
    expect(mockGet).toHaveBeenNthCalledWith(
      3,
      'https://api.github.com/search/code?q=filename:openapi.yaml+org:empty-org',
      expect.any(Object),
    )
    expect(mockParseOpenApiToRequests).toHaveBeenCalledWith(dereferencedSpec, '00000000-0000-0000-0000-000000000001')
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO folders (id, parent_id, name, source, source_meta"),
      [
        '00000000-0000-0000-0000-000000000001',
        'acme/orders / openapi.yaml',
        JSON.stringify({ org: 'acme', repo: 'acme/orders', path: 'openapi.yaml' }),
        expect.any(Number),
        expect.any(Number),
      ],
    )
    expect(mockRun).toHaveBeenCalledWith('DELETE FROM requests WHERE folder_id = ?', ['00000000-0000-0000-0000-000000000001'])
    expect(mockRun).toHaveBeenCalledWith('DELETE FROM folders WHERE parent_id = ?', ['00000000-0000-0000-0000-000000000001'])
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO requests"),
      [
        'request-1',
        '00000000-0000-0000-0000-000000000001',
        'List pets',
        'GET',
        'https://example.com/pets',
        '[]',
        '{}',
        'none',
        '',
        'none',
        '{}',
        'Returns pets',
        'openapi.yaml',
        'sha-1',
        0,
        0,
        201,
        202,
      ],
    )
  })

  it('updates an existing root folder instead of inserting a new one', async () => {
    mockGet
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              repository: { full_name: 'acme/orders' },
              path: 'openapi.yaml',
              sha: 'sha-1',
            },
          ],
        },
      })
      .mockResolvedValueOnce({ data: { openapi: '3.0.0' } })
    mockDereference.mockResolvedValue(dereferencedSpec)
    mockParseOpenApiToRequests.mockResolvedValue({ folders: [], requests: [] })
    mockQueryOne.mockReturnValue({ id: 'existing-collection' })

    await discoverApis({
      baseUrl: 'https://github.com',
      clientId: 'cid',
      clientSecret: 'secret',
      token: 'gh-token',
      repo: '',
      orgs: ['acme'],
    })

    expect(mockRun).toHaveBeenCalledWith('UPDATE folders SET updated_at = ? WHERE id = ?', [
      expect.any(Number),
      'existing-collection',
    ])
    expect(
      mockRun.mock.calls.some(([sql]) => String(sql).includes("VALUES (?, NULL, ?, 'github'")),
    ).toBe(false)
  })

  it('skips a failed spec fetch without aborting the remaining imports', async () => {
    mockGet
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              repository: { full_name: 'acme/failing' },
              path: 'openapi.yaml',
              sha: 'sha-fail',
            },
            {
              repository: { full_name: 'acme/working' },
              path: 'docs/openapi.yaml',
              sha: 'sha-ok',
            },
          ],
        },
      })
      .mockRejectedValueOnce(new Error('not found'))
      .mockResolvedValueOnce({ data: { openapi: '3.0.0' } })
    mockDereference.mockResolvedValue(dereferencedSpec)
    mockParseOpenApiToRequests.mockResolvedValue({ folders: [], requests: [] })
    mockQueryOne.mockReturnValue(null)

    await expect(
      discoverApis({
        baseUrl: 'https://github.com',
        clientId: 'cid',
        clientSecret: 'secret',
        token: 'gh-token',
        repo: '',
        orgs: ['acme'],
      }),
    ).resolves.toBeUndefined()

    expect(mockGet).toHaveBeenNthCalledWith(
      2,
      'https://raw.githubusercontent.com/acme/failing/HEAD/openapi.yaml',
      expect.any(Object),
    )
    expect(mockGet).toHaveBeenNthCalledWith(
      3,
      'https://raw.githubusercontent.com/acme/working/HEAD/docs/openapi.yaml',
      expect.any(Object),
    )
    expect(mockParseOpenApiToRequests).toHaveBeenCalledTimes(1)
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO folders (id, parent_id, name, source, source_meta"),
      [
        '00000000-0000-0000-0000-000000000001',
        'acme/working / docs/openapi.yaml',
        JSON.stringify({ org: 'acme', repo: 'acme/working', path: 'docs/openapi.yaml' }),
        expect.any(Number),
        expect.any(Number),
      ],
    )
  })
})
