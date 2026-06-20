import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../database', () => ({
  queryAll: vi.fn(),
  run: vi.fn(),
}))

import { queryAll, run } from '../../database'
import { tryParse, buildExport, importData } from '../export-import'
import type { PostlyExportFile } from '../export-import'

const mockQueryAll = vi.mocked(queryAll)
const mockRun = vi.mocked(run)

beforeEach(() => vi.resetAllMocks())

describe('tryParse', () => {
  it('parses a valid JSON string', () => {
    expect(tryParse('{"a":1}', {})).toEqual({ a: 1 })
  })

  it('returns the fallback on invalid JSON', () => {
    expect(tryParse('not-json', [])).toEqual([])
  })

  it('returns the fallback for null/undefined/empty string', () => {
    expect(tryParse(null, 42)).toBe(42)
    expect(tryParse(undefined, 'default')).toBe('default')
    expect(tryParse('', 'x')).toBe('x')
  })
})

describe('buildExport', () => {
  it('returns a file with the correct schema string', () => {
    mockQueryAll
      .mockReturnValueOnce([{ id: 'c1', parent_id: null, name: 'My API', source: 'local', description: '', auth_type: 'none', auth_config: '{}', ssl_verification: 'inherit', sort_order: 0 }])
      .mockReturnValueOnce([])

    const file = buildExport()
    expect(file.$schema).toBe('postly/v1')
    expect(file.exportedAt).toBeTruthy()
  })

  it('serializes a recursive collection tree with requests in a sub-folder', () => {
    const folderRows = [
      { id: 'c1', parent_id: null, name: 'API', source: 'local', description: 'desc', auth_type: 'none', auth_config: '{}', ssl_verification: 'inherit', sort_order: 0 },
      { id: 'f1', parent_id: 'c1', name: 'Default', source: 'local', description: '', auth_type: 'bearer', auth_config: '{"token":"t"}', ssl_verification: 'inherit', sort_order: 0 },
    ]
    const requestRows = [
      { id: 'r1', folder_id: 'f1', name: 'Get Users', method: 'GET', url: '/users', protocol: 'http', params: '[]', headers: '[]', body_type: 'none', body_content: '', auth_type: 'none', auth_config: '{}', ssl_verification: 'inherit', description: '', protocol_config: '{}', sort_order: 0 },
    ]

    mockQueryAll
      .mockReturnValueOnce(folderRows)
      .mockReturnValueOnce(requestRows)

    const file = buildExport()
    expect(file.collections).toHaveLength(1)
    const exported = file.collections[0]
    expect(exported.name).toBe('API')
    expect(exported.requests).toHaveLength(0)
    expect(exported.folders).toHaveLength(1)
    expect(exported.folders[0].requests).toHaveLength(1)
    expect(exported.folders[0].requests[0].name).toBe('Get Users')
  })

  it('serializes requests placed directly at collection level (no sub-folder)', () => {
    const folderRows = [
      { id: 'c1', parent_id: null, name: 'Simple API', source: 'local', description: '', auth_type: 'none', auth_config: '{}', ssl_verification: 'inherit', sort_order: 0 },
    ]
    const requestRows = [
      { id: 'r1', folder_id: 'c1', name: 'Health Check', method: 'GET', url: '/health', protocol: 'http', params: '[]', headers: '[]', body_type: 'none', body_content: '', auth_type: 'none', auth_config: '{}', ssl_verification: 'inherit', description: '', protocol_config: '{}', sort_order: 0 },
    ]

    mockQueryAll.mockReturnValueOnce(folderRows).mockReturnValueOnce(requestRows)

    const file = buildExport()
    const col = file.collections[0]
    expect(col.requests).toHaveLength(1)
    expect(col.requests[0].name).toBe('Health Check')
    expect(col.folders).toHaveLength(0)
  })

  it('serializes deeply nested folders (3 levels)', () => {
    const folderRows = [
      { id: 'c1', parent_id: null,  name: 'Root',   source: 'local', description: '', auth_type: 'none', auth_config: '{}', ssl_verification: 'inherit', sort_order: 0 },
      { id: 'f1', parent_id: 'c1', name: 'Level 1', source: 'local', description: '', auth_type: 'none', auth_config: '{}', ssl_verification: 'inherit', sort_order: 0 },
      { id: 'f2', parent_id: 'f1', name: 'Level 2', source: 'local', description: '', auth_type: 'none', auth_config: '{}', ssl_verification: 'inherit', sort_order: 0 },
    ]
    const requestRows = [
      { id: 'r1', folder_id: 'f2', name: 'Deep Request', method: 'POST', url: '/deep', protocol: 'http', params: '[]', headers: '[]', body_type: 'json', body_content: '{}', auth_type: 'none', auth_config: '{}', ssl_verification: 'inherit', description: '', protocol_config: '{}', sort_order: 0 },
    ]

    mockQueryAll.mockReturnValueOnce(folderRows).mockReturnValueOnce(requestRows)

    const file = buildExport()
    const col = file.collections[0]
    expect(col.folders).toHaveLength(1)
    expect(col.folders[0].name).toBe('Level 1')
    expect(col.folders[0].folders).toHaveLength(1)
    expect(col.folders[0].folders[0].name).toBe('Level 2')
    expect(col.folders[0].folders[0].requests).toHaveLength(1)
    expect(col.folders[0].folders[0].requests[0].name).toBe('Deep Request')
  })

  it('serializes auth config on sub-folders', () => {
    const folderRows = [
      { id: 'c1', parent_id: null, name: 'API', source: 'local', description: '', auth_type: 'none', auth_config: '{}', ssl_verification: 'inherit', sort_order: 0 },
      { id: 'f1', parent_id: 'c1', name: 'Secured', source: 'local', description: '', auth_type: 'bearer', auth_config: '{"token":"secret"}', ssl_verification: 'false', sort_order: 0 },
    ]

    mockQueryAll.mockReturnValueOnce(folderRows).mockReturnValueOnce([])

    const file = buildExport()
    const folder = file.collections[0].folders[0]
    expect(folder.auth.type).toBe('bearer')
    expect(folder.auth.config).toEqual({ token: 'secret' })
    expect(folder.ssl).toBe('false')
  })

  it('filters collections when collectionIds is provided', () => {
    mockQueryAll
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])

    const file = buildExport(['c-specific'])
    expect(file.collections).toHaveLength(0)

    const [sql, params] = mockQueryAll.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('WITH RECURSIVE tree')
    expect(params).toContain('c-specific')
  })

  it('uses all collections when no ids are passed', () => {
    mockQueryAll.mockReturnValueOnce([]).mockReturnValueOnce([])

    buildExport()

    const [sql] = mockQueryAll.mock.calls[0] as [string, unknown[]]
    expect(sql).not.toContain('WITH RECURSIVE tree')
  })
})

describe('importData', () => {
  // ── helpers ──────────────────────────────────────────────────────────────

  const baseRequest = {
    name: 'Get Users',
    method: 'GET',
    url: '/users',
    protocol: 'http',
    params: [],
    headers: [],
    bodyType: 'none',
    bodyContent: '',
    auth: { type: 'none', config: {} },
    ssl: 'inherit',
    description: '',
    protocolConfig: {},
  }

  function makeFile(overrides: Partial<PostlyExportFile> = {}): PostlyExportFile {
    return {
      $schema: 'postly/v1',
      exportedAt: new Date().toISOString(),
      collections: [
        {
          name: 'Imported API',
          description: 'desc',
          source: 'local',
          auth: { type: 'none', config: {} },
          ssl: 'inherit',
          requests: [],
          folders: [
            {
              name: 'Default',
              description: '',
              auth: { type: 'none', config: {} },
              ssl: 'inherit',
              requests: [{ ...baseRequest }],
              folders: [],
            },
          ],
        },
      ],
      ...overrides,
    }
  }

  function insertCalls() {
    return mockRun.mock.calls.filter(([sql]) => (sql as string).startsWith('INSERT'))
  }

  function folderInserts() {
    return insertCalls().filter(([sql]) => (sql as string).includes('INSERT INTO folders'))
  }

  function requestInserts() {
    return insertCalls().filter(([sql]) => (sql as string).includes('INSERT INTO requests'))
  }

  // ── basic ─────────────────────────────────────────────────────────────────

  it('returns the number of imported collections', () => {
    expect(importData(makeFile())).toBe(1)
  })

  it('inserts one collection folder, one sub-folder, and one request row', () => {
    importData(makeFile())
    expect(folderInserts()).toHaveLength(2)
    expect(requestInserts()).toHaveLength(1)
  })

  it('handles multiple collections', () => {
    const file = makeFile()
    file.collections = [...file.collections, { ...file.collections[0], name: 'Second API' }]
    expect(importData(file)).toBe(2)
  })

  it('preserves request fields (url, method, bodyType)', () => {
    importData(makeFile())
    const params = requestInserts()[0][1] as unknown[]
    expect(params).toContain('Get Users')
    expect(params).toContain('GET')
    expect(params).toContain('/users')
  })

  it('uses default values for optional fields when absent', () => {
    const file = makeFile()
    const req = file.collections[0].folders[0].requests[0]
    delete (req as unknown as Record<string, unknown>).description
    delete (req as unknown as Record<string, unknown>).protocolConfig
    expect(() => importData(file)).not.toThrow()
  })

  // ── new format ────────────────────────────────────────────────────────────

  describe('new format (folders)', () => {
    it('imports requests placed directly at collection level', () => {
      const file: PostlyExportFile = {
        $schema: 'postly/v1',
        exportedAt: new Date().toISOString(),
        collections: [
          {
            name: 'Flat API',
            description: '',
            source: 'local',
            auth: { type: 'none', config: {} },
            ssl: 'inherit',
            requests: [{ ...baseRequest, name: 'Health', url: '/health' }],
            folders: [],
          },
        ],
      }

      importData(file)

      // 1 root folder, 0 sub-folders, 1 request
      expect(folderInserts()).toHaveLength(1)
      expect(requestInserts()).toHaveLength(1)
      const reqParams = requestInserts()[0][1] as unknown[]
      expect(reqParams).toContain('Health')
    })

    it('imports 3-level deeply nested folders', () => {
      const file: PostlyExportFile = {
        $schema: 'postly/v1',
        exportedAt: new Date().toISOString(),
        collections: [
          {
            name: 'Deep API',
            description: '',
            source: 'local',
            auth: { type: 'none', config: {} },
            ssl: 'inherit',
            requests: [],
            folders: [
              {
                name: 'Level 1',
                description: '',
                auth: { type: 'none', config: {} },
                ssl: 'inherit',
                requests: [],
                folders: [
                  {
                    name: 'Level 2',
                    description: '',
                    auth: { type: 'none', config: {} },
                    ssl: 'inherit',
                    requests: [{ ...baseRequest, name: 'Deep Request', url: '/deep' }],
                    folders: [],
                  },
                ],
              },
            ],
          },
        ],
      }

      importData(file)

      // 1 root + Level1 + Level2 = 3 folder inserts, 1 request
      expect(folderInserts()).toHaveLength(3)
      expect(requestInserts()).toHaveLength(1)
      const reqParams = requestInserts()[0][1] as unknown[]
      expect(reqParams).toContain('Deep Request')
    })

    it('imports requests at multiple folder levels in the same collection', () => {
      const file: PostlyExportFile = {
        $schema: 'postly/v1',
        exportedAt: new Date().toISOString(),
        collections: [
          {
            name: 'Mixed API',
            description: '',
            source: 'local',
            auth: { type: 'none', config: {} },
            ssl: 'inherit',
            requests: [{ ...baseRequest, name: 'Root Request', url: '/root' }],
            folders: [
              {
                name: 'Sub',
                description: '',
                auth: { type: 'none', config: {} },
                ssl: 'inherit',
                requests: [{ ...baseRequest, name: 'Sub Request', url: '/sub' }],
                folders: [],
              },
            ],
          },
        ],
      }

      importData(file)

      expect(folderInserts()).toHaveLength(2)   // root + Sub
      expect(requestInserts()).toHaveLength(2)  // Root Request + Sub Request
    })

    it('preserves auth config on imported sub-folders', () => {
      const file: PostlyExportFile = {
        $schema: 'postly/v1',
        exportedAt: new Date().toISOString(),
        collections: [
          {
            name: 'Auth API',
            description: '',
            source: 'local',
            auth: { type: 'bearer', config: { token: 'root-token' } },
            ssl: 'inherit',
            requests: [],
            folders: [
              {
                name: 'Secured',
                description: '',
                auth: { type: 'bearer', config: { token: 'folder-token' } },
                ssl: 'false',
                requests: [],
                folders: [],
              },
            ],
          },
        ],
      }

      importData(file)

      const allFolderParams = folderInserts().map(([, params]) => params as unknown[])
      // root folder auth
      expect(allFolderParams[0]).toContain('bearer')
      expect(allFolderParams[0]).toContain(JSON.stringify({ token: 'root-token' }))
      // sub-folder auth + ssl
      expect(allFolderParams[1]).toContain('bearer')
      expect(allFolderParams[1]).toContain(JSON.stringify({ token: 'folder-token' }))
      expect(allFolderParams[1]).toContain('false')
    })
  })

  // ── old format ────────────────────────────────────────────────────────────

  describe('old format (groups)', () => {
    it('imports a single group with requests', () => {
      const oldFormat = {
        $schema: 'postly/v1',
        exportedAt: new Date().toISOString(),
        collections: [
          {
            name: 'Legacy API',
            description: '',
            source: 'local',
            auth: { type: 'none', config: {} },
            ssl: 'inherit',
            groups: [
              {
                name: 'Default',
                description: '',
                auth: { type: 'none', config: {} },
                ssl: 'inherit',
                requests: [{ ...baseRequest, name: 'List items', url: '/items' }],
              },
            ],
          },
        ],
      } as unknown as PostlyExportFile

      const count = importData(oldFormat)
      expect(count).toBe(1)
      // 1 root folder + 1 group-as-subfolder + 1 request
      expect(folderInserts()).toHaveLength(2)
      expect(requestInserts()).toHaveLength(1)
      const reqParams = requestInserts()[0][1] as unknown[]
      expect(reqParams).toContain('List items')
    })

    it('imports multiple groups each with multiple requests', () => {
      const oldFormat = {
        $schema: 'postly/v1',
        exportedAt: new Date().toISOString(),
        collections: [
          {
            name: 'Big API',
            description: '',
            source: 'local',
            auth: { type: 'none', config: {} },
            ssl: 'inherit',
            groups: [
              {
                name: 'Users',
                description: '',
                auth: { type: 'none', config: {} },
                ssl: 'inherit',
                requests: [
                  { ...baseRequest, name: 'List users', url: '/users' },
                  { ...baseRequest, name: 'Create user', method: 'POST', url: '/users' },
                ],
              },
              {
                name: 'Orders',
                description: '',
                auth: { type: 'none', config: {} },
                ssl: 'inherit',
                requests: [
                  { ...baseRequest, name: 'List orders', url: '/orders' },
                ],
              },
            ],
          },
        ],
      } as unknown as PostlyExportFile

      importData(oldFormat)

      // 1 root + 2 groups = 3 folder inserts, 3 requests
      expect(folderInserts()).toHaveLength(3)
      expect(requestInserts()).toHaveLength(3)
    })

    it('does not import any requests when both folders and groups are absent', () => {
      const oldFormat = {
        $schema: 'postly/v1',
        exportedAt: new Date().toISOString(),
        collections: [
          {
            name: 'Empty',
            description: '',
            source: 'local',
            auth: { type: 'none', config: {} },
            ssl: 'inherit',
          },
        ],
      } as unknown as PostlyExportFile

      importData(oldFormat)

      expect(folderInserts()).toHaveLength(1)  // root folder only
      expect(requestInserts()).toHaveLength(0)
    })

    it('prefers folders over groups when both are present (forward-compat)', () => {
      const mixedFormat = {
        $schema: 'postly/v1',
        exportedAt: new Date().toISOString(),
        collections: [
          {
            name: 'API',
            description: '',
            source: 'local',
            auth: { type: 'none', config: {} },
            ssl: 'inherit',
            folders: [
              {
                name: 'New Folder',
                description: '',
                auth: { type: 'none', config: {} },
                ssl: 'inherit',
                requests: [{ ...baseRequest, name: 'From folders', url: '/new' }],
                folders: [],
              },
            ],
            groups: [
              {
                name: 'Old Group',
                description: '',
                auth: { type: 'none', config: {} },
                ssl: 'inherit',
                requests: [{ ...baseRequest, name: 'From groups', url: '/old' }],
              },
            ],
          },
        ],
      } as unknown as PostlyExportFile

      importData(mixedFormat)

      // folders takes precedence — only "New Folder" sub-folder, not "Old Group"
      expect(folderInserts()).toHaveLength(2)
      expect(requestInserts()).toHaveLength(1)
      const reqParams = requestInserts()[0][1] as unknown[]
      expect(reqParams).toContain('From folders')
    })
  })
})
