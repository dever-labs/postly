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
import { discoverApis } from '../gitlab'

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

describe('discoverApis (GitLab)', () => {
  it('imports discovered specs, loops across groups, and forwards auth headers', async () => {
    const token = 'gl-token'
    const parsed = makeParsed('00000000-0000-0000-0000-000000000001')

    mockGet
      .mockResolvedValueOnce({
        data: [
          {
            id: 10,
            name: 'orders',
            path_with_namespace: 'team-a/orders',
            default_branch: 'develop',
          },
        ],
      })
      .mockResolvedValueOnce({ data: { openapi: '3.0.0' } })
      .mockResolvedValueOnce({ data: [] })
    mockDereference.mockResolvedValue(dereferencedSpec)
    mockParseOpenApiToRequests.mockResolvedValue(parsed)
    mockQueryOne.mockReturnValue(null)

    await discoverApis({
      baseUrl: 'https://gitlab.example.com/',
      clientId: 'cid',
      token,
      connectedUser: undefined,
      repo: '',
      groups: ['team-a', 'team-b'],
    })

    expect(mockGet).toHaveBeenNthCalledWith(
      1,
      'https://gitlab.example.com/api/v4/groups/team-a/projects?per_page=100',
      expect.objectContaining({
        headers: expect.objectContaining({
          'PRIVATE-TOKEN': token,
        }),
      }),
    )
    expect(mockGet).toHaveBeenNthCalledWith(
      2,
      'https://gitlab.example.com/api/v4/projects/10/repository/files/openapi.yaml/raw?ref=develop',
      expect.objectContaining({
        headers: expect.objectContaining({
          'PRIVATE-TOKEN': token,
        }),
      }),
    )
    expect(mockGet).toHaveBeenNthCalledWith(
      3,
      'https://gitlab.example.com/api/v4/groups/team-b/projects?per_page=100',
      expect.any(Object),
    )
    expect(mockParseOpenApiToRequests).toHaveBeenCalledWith(dereferencedSpec, '00000000-0000-0000-0000-000000000001')
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO folders (id, parent_id, name, source, source_meta"),
      [
        '00000000-0000-0000-0000-000000000001',
        'team-a/orders',
        JSON.stringify({ projectId: 10, projectPath: 'team-a/orders', filePath: 'openapi.yaml' }),
        expect.any(Number),
        expect.any(Number),
      ],
    )
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO requests'),
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
        null,
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
        data: [
          {
            id: 10,
            name: 'orders',
            path_with_namespace: 'team-a/orders',
            default_branch: 'main',
          },
        ],
      })
      .mockResolvedValueOnce({ data: { openapi: '3.0.0' } })
    mockDereference.mockResolvedValue(dereferencedSpec)
    mockParseOpenApiToRequests.mockResolvedValue({ folders: [], requests: [] })
    mockQueryOne.mockReturnValue({ id: 'existing-collection' })

    await discoverApis({
      baseUrl: 'https://gitlab.example.com',
      clientId: 'cid',
      token: 'gl-token',
      connectedUser: undefined,
      repo: '',
      groups: ['team-a'],
    })

    expect(mockRun).toHaveBeenCalledWith('UPDATE folders SET updated_at = ? WHERE id = ?', [
      expect.any(Number),
      'existing-collection',
    ])
    expect(
      mockRun.mock.calls.some(([sql]) => String(sql).includes("VALUES (?, NULL, ?, 'gitlab'")),
    ).toBe(false)
  })

  it('skips failed spec candidates without aborting the import', async () => {
    mockGet
      .mockResolvedValueOnce({
        data: [
          {
            id: 10,
            name: 'orders',
            path_with_namespace: 'team-a/orders',
            default_branch: 'main',
          },
        ],
      })
      .mockRejectedValueOnce(new Error('missing openapi.yaml'))
      .mockRejectedValueOnce(new Error('missing openapi.json'))
      .mockResolvedValueOnce({ data: { openapi: '3.0.0' } })
    mockDereference.mockResolvedValue(dereferencedSpec)
    mockParseOpenApiToRequests.mockResolvedValue({ folders: [], requests: [] })
    mockQueryOne.mockReturnValue(null)

    await expect(
      discoverApis({
        baseUrl: 'https://gitlab.example.com',
        clientId: 'cid',
        token: 'gl-token',
        connectedUser: undefined,
        repo: '',
        groups: ['team-a'],
      }),
    ).resolves.toBeUndefined()

    expect(mockGet).toHaveBeenNthCalledWith(
      2,
      'https://gitlab.example.com/api/v4/projects/10/repository/files/openapi.yaml/raw?ref=main',
      expect.any(Object),
    )
    expect(mockGet).toHaveBeenNthCalledWith(
      3,
      'https://gitlab.example.com/api/v4/projects/10/repository/files/openapi.json/raw?ref=main',
      expect.any(Object),
    )
    expect(mockGet).toHaveBeenNthCalledWith(
      4,
      'https://gitlab.example.com/api/v4/projects/10/repository/files/openapi%2Fopenapi.yaml/raw?ref=main',
      expect.any(Object),
    )
    expect(mockParseOpenApiToRequests).toHaveBeenCalledTimes(1)
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO folders (id, parent_id, name, source, source_meta"),
      [
        '00000000-0000-0000-0000-000000000001',
        'team-a/orders',
        JSON.stringify({ projectId: 10, projectPath: 'team-a/orders', filePath: 'openapi/openapi.yaml' }),
        expect.any(Number),
        expect.any(Number),
      ],
    )
  })
})
