import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  state,
  mockShowSaveDialog,
  mockShowOpenDialog,
  mockWriteFileSync,
  mockReadFileSync,
  mockFromWebContents,
  mockExportCollectionVariables,
  mockCollectionVariableStatements,
  mockCleanVariables,
} = vi.hoisted(() => ({
  state: { handlers: {} as Record<string, (event: unknown, args: unknown) => Promise<unknown> | unknown> },
  mockShowSaveDialog: vi.fn(),
  mockShowOpenDialog: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockFromWebContents: vi.fn<() => { id: number } | null>(() => null),
  mockExportCollectionVariables: vi.fn(() => []),
  mockCollectionVariableStatements: vi.fn(() => []),
  mockCleanVariables: vi.fn((rows: unknown[]) => rows),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, args: unknown) => Promise<unknown> | unknown) => {
      state.handlers[channel] = handler
    }),
  },
  BrowserWindow: {
    fromWebContents: mockFromWebContents,
  },
  dialog: {
    showSaveDialog: mockShowSaveDialog,
    showOpenDialog: mockShowOpenDialog,
  },
}))

vi.mock('fs', () => ({
  default: {
    writeFileSync: mockWriteFileSync,
    readFileSync: mockReadFileSync,
  },
  writeFileSync: mockWriteFileSync,
  readFileSync: mockReadFileSync,
}))

vi.mock('../../database', () => ({
  queryAll: vi.fn(),
  runTransaction: vi.fn(),
}))

vi.mock('../../services/variable-store', () => ({
  exportCollectionVariables: mockExportCollectionVariables,
  collectionVariableStatements: mockCollectionVariableStatements,
  cleanVariables: mockCleanVariables,
}))

import { queryAll, runTransaction } from '../../database'
import { MAX_IMPORT_BYTES } from '../../services/import-formats'
import { tryParse, buildExport, importData, registerExportImportHandlers } from '../export-import'
import type { PostlyExportFile } from '../export-import'

const mockQueryAll = vi.mocked(queryAll)
const mockTransaction = vi.mocked(runTransaction)

function invoke(channel: string, args?: unknown) {
  return Promise.resolve(state.handlers[channel]?.({ sender: {} }, args)) as Promise<Record<string, unknown>>
}

beforeEach(() => {
  vi.clearAllMocks()
  state.handlers = {}
  mockQueryAll.mockReturnValue([])
  mockTransaction.mockImplementation(() => undefined)
  mockFromWebContents.mockReturnValue(null)
  mockShowSaveDialog.mockResolvedValue({ canceled: true })
  mockShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
  mockWriteFileSync.mockImplementation(() => undefined)
  mockReadFileSync.mockReturnValue('')
  mockExportCollectionVariables.mockReturnValue([])
  mockCollectionVariableStatements.mockReturnValue([])
  mockCleanVariables.mockImplementation((rows: unknown[]) => rows)
  registerExportImportHandlers()
})

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
    return mockTransaction.mock.calls
      .flatMap(([statements]) => statements.map((st) => [st.sql, st.params] as const))
      .filter(([sql]) => sql.trim().startsWith('INSERT'))
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

  it('writes everything in one transaction and rolls back as a whole on failure', () => {
    importData(makeFile())
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    mockTransaction.mockImplementationOnce(() => { throw new Error('boom') })
    expect(() => importData(makeFile())).toThrow('boom')
  })

  it('handles multiple collections', () => {
    const file = makeFile()
    file.collections = [...file.collections, { ...file.collections[0], name: 'Second API' }]
    expect(importData(file)).toBe(2)
  })

  it('rejects non-object collections before writing a transaction', () => {
    expect(() => importData({
      $schema: 'postly/v1',
      exportedAt: new Date().toISOString(),
      collections: [null as unknown as PostlyExportFile['collections'][number]],
    })).toThrow('Each collection must be an object.')
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('preserves request fields (url, method, bodyType)', () => {
    importData(makeFile())
    const params = requestInserts()[0][1] as unknown[]
    expect(params).toContain('Get Users')
    expect(params).toContain('GET')
    expect(params).toContain('/users')
  })

  it('uses default values for optional fields when absent', () => {
    const file: PostlyExportFile = {
      $schema: 'postly/v1',
      exportedAt: new Date().toISOString(),
      collections: [
        {
          name: 'Sparse API',
          requests: [
            {
              name: 'Minimal Root Request',
            } as unknown as PostlyExportFile['collections'][number]['requests'][number],
          ],
          folders: [
            {
              name: 'Sparse Folder',
              requests: [
                {
                  name: 'Minimal Nested Request',
                } as unknown as PostlyExportFile['collections'][number]['requests'][number],
              ],
              folders: [],
            } as unknown as PostlyExportFile['collections'][number]['folders'][number],
          ],
          environments: [
            {
              name: '   ',
              variables: [{ key: 'HOST', value: 'https://example.test', isSecret: false }],
            },
          ],
        } as unknown as PostlyExportFile['collections'][number],
      ],
    }

    expect(() => importData(file)).not.toThrow()

    const statements = mockTransaction.mock.calls.flatMap(([st]) => st)
    const folderInserts = statements.filter((st) => st.sql.includes('INSERT INTO folders'))
    const requestInserts = statements.filter((st) => st.sql.includes('INSERT INTO requests'))
    const environmentInsert = statements.find((st) => st.sql.includes('INSERT INTO environments'))

    expect(folderInserts[0]?.params).toEqual(expect.arrayContaining(['Sparse API', '', 'local', 'none', '{}', 'inherit']))
    expect(folderInserts[1]?.params).toEqual(expect.arrayContaining(['Sparse Folder', '', 'none', '{}', 'inherit']))
    expect(requestInserts[0]?.params).toEqual(expect.arrayContaining(['Minimal Root Request', 'GET', '', '[]', '[]', 'none', '{}', 'inherit', 'http']))
    expect(requestInserts[1]?.params).toEqual(expect.arrayContaining(['Minimal Nested Request', 'GET', '', '[]', '[]', 'none', '{}', 'inherit', 'http']))
    expect(environmentInsert?.params).toContain('Imported')
  })

  it('normalizes environment variable rows before building inserts', () => {
    const file = makeFile({
      collections: [
        {
          name: 'Env API',
          description: '',
          source: 'local',
          auth: { type: 'none', config: {} },
          ssl: 'inherit',
          requests: [],
          folders: [],
          environments: [
            {
              name: '  42  ',
              variables: [
                null,
                { key: 123, value: 456, isSecret: 'yes' },
              ] as unknown as Array<{ key: string; value: string; isSecret: boolean }>,
            },
          ],
        },
      ],
    })

    importData(file)

    const statements = mockTransaction.mock.calls.flatMap(([st]) => st)
    const envInsert = statements.find((st) => st.sql.includes('INSERT INTO environments'))
    const envVarInsert = statements.find((st) => st.sql.includes('INSERT INTO env_vars'))

    expect(envInsert?.params).toContain('42')
    expect(envVarInsert?.params).toContain('123')
    expect(envVarInsert?.params).toContain('456')
    expect(envVarInsert?.params).toContain(1)
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

describe('timeout / redirect overrides', () => {
  const req = (extra: Record<string, unknown> = {}) => ({ id: 'r1', folder_id: 'c1', name: 'Slow', method: 'GET', url: '/slow', protocol: 'http', params: '[]', headers: '[]', body_type: 'none', body_content: '', auth_type: 'none', auth_config: '{}', ssl_verification: 'inherit', description: '', protocol_config: '{}', sort_order: 0, ...extra })
  const col = (extra: Record<string, unknown> = {}) => ({ id: 'c1', parent_id: null, name: 'API', source: 'local', description: '', auth_type: 'none', auth_config: '{}', ssl_verification: 'inherit', sort_order: 0, ...extra })

  it('exports overrides on collections, folders and requests, and omits the key when inherited', () => {
    mockQueryAll
      .mockReturnValueOnce([col({ network_settings: '{"timeout":9000}' }), { ...col({ id: 'f1', parent_id: 'c1', name: 'F', network_settings: '{"followRedirects":false}' }) }])
      .mockReturnValueOnce([req({ folder_id: 'f1', network_settings: '{"maxRedirects":1}' }), req({ id: 'r2', network_settings: null })])
    const c = buildExport().collections[0]
    expect(c.network).toEqual({ timeout: 9000 })
    expect(c.folders[0].network).toEqual({ followRedirects: false })
    expect(c.folders[0].requests[0].network).toEqual({ maxRedirects: 1 })
    expect('network' in c.requests[0]).toBe(false)
  })

  it('imports overrides, and stores NULL for files written before this field existed', () => {
    const file: PostlyExportFile = {
      $schema: 'postly/v1',
      exportedAt: '',
      collections: [{
        name: 'API', description: '', source: 'local', auth: { type: 'none', config: {} }, ssl: 'inherit',
        network: { timeout: 7000 },
        requests: [{ name: 'Old', method: 'GET', url: '', protocol: 'http', params: [], headers: [], bodyType: 'none', bodyContent: '', auth: { type: 'none', config: {} }, ssl: 'inherit', description: '', protocolConfig: {} }],
        folders: [],
      }],
    }
    importData(file)
    const statements = mockTransaction.mock.calls.flatMap(([st]) => st)
    const folderInsert = statements.find((st) => st.sql.includes('INSERT INTO folders'))
    expect(folderInsert?.params).toContain('{"timeout":7000}')
    const requestInsert = statements.find((st) => st.sql.includes('INSERT INTO requests'))
    expect(requestInsert?.params).toContain(null)
  })
})

describe('registerExportImportHandlers', () => {
  it('exports collections to a chosen file path', async () => {
    mockQueryAll
      .mockReturnValueOnce([
        { id: 'c1', parent_id: null, name: 'My API?', source: 'local', description: '', auth_type: 'none', auth_config: '{}', ssl_verification: 'inherit', network_settings: null, sort_order: 0 },
      ])
      .mockReturnValueOnce([])
    mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/workspace/exports/my-api.postly.json' })

    const result = await invoke('postly:export', { collectionIds: ['c1'] })

    expect(result).toEqual({
      data: { filePath: '/workspace/exports/my-api.postly.json', count: 1 },
    })
    expect(mockShowSaveDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Export Collections',
      defaultPath: 'My_API_.postly.json',
    }))
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/workspace/exports/my-api.postly.json',
      expect.stringContaining('"$schema": "postly/v1"'),
      'utf-8',
    )
  })

  it('passes the owning BrowserWindow to dialog-based handlers when available', async () => {
    mockQueryAll.mockReturnValueOnce([]).mockReturnValueOnce([])
    mockFromWebContents.mockReturnValue({ id: 7 })
    mockShowSaveDialog.mockResolvedValue({ canceled: true })

    await invoke('postly:export', { collectionIds: [] })

    expect(mockShowSaveDialog).toHaveBeenCalledWith(
      { id: 7 },
      expect.objectContaining({ title: 'Export Collections' }),
    )
  })

  it('returns null when export or import dialogs are cancelled', async () => {
    mockQueryAll.mockReturnValueOnce([]).mockReturnValueOnce([])

    await expect(invoke('postly:export', { collectionIds: [] })).resolves.toEqual({ data: null })
    await expect(invoke('postly:import')).resolves.toEqual({ data: null })
  })

  it('wraps export write failures', async () => {
    mockQueryAll.mockReturnValueOnce([]).mockReturnValueOnce([])
    mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/workspace/export.json' })
    mockWriteFileSync.mockImplementationOnce(() => { throw new Error('disk full') })

    const result = await invoke('postly:export', { collectionIds: [] })

    expect(result).toEqual({ error: 'Error: disk full' })
  })

  it('imports a valid Postly file selected from the open dialog', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/workspace/import.postly.json'] })
    mockReadFileSync.mockReturnValue(JSON.stringify({
      $schema: 'postly/v1',
      exportedAt: '2026-01-01T00:00:00.000Z',
      collections: [
        {
          name: 'Imported API',
          description: '',
          source: 'local',
          auth: { type: 'none', config: {} },
          ssl: 'inherit',
          requests: [],
          folders: [],
        },
      ],
    }))

    const result = await invoke('postly:import')

    expect(result).toEqual({ data: { count: 1 } })
    expect(mockReadFileSync).toHaveBeenCalledWith('/workspace/import.postly.json', 'utf-8')
    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })

  it('rejects unreadable, invalid, or legacy import files', async () => {
    mockShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/workspace/import.json'] })

    mockReadFileSync.mockImplementationOnce(() => { throw new Error('read failed') })
    await expect(invoke('postly:import')).resolves.toEqual({ error: 'Error: read failed' })

    mockReadFileSync.mockReturnValueOnce('{ bad json')
    await expect(invoke('postly:import')).resolves.toEqual(expect.objectContaining({
      error: expect.stringContaining('Expected property name'),
    }))

    mockReadFileSync.mockReturnValueOnce(JSON.stringify({ collections: [] }))
    await expect(invoke('postly:import')).resolves.toEqual({ error: 'Not a valid Postly export file.' })
  })

  it('rejects invalid importCollections payloads before writing anything', async () => {
    await expect(invoke('postly:import:collections', { collections: 'bad' })).resolves.toEqual({ error: 'Invalid collections data.' })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('rejects malformed environments without throwing a TypeError or writing partial data', async () => {
    const result = await invoke('postly:import:collections', {
      collections: [
        {
          name: 'Broken API',
          description: '',
          source: 'local',
          auth: { type: 'none', config: {} },
          ssl: 'inherit',
          requests: [],
          folders: [],
          environments: [{ name: 123, variables: { key: 'TOKEN', value: 'x' } }],
        },
      ],
    })

    expect(result).toEqual({ error: 'Error: Environment variables must be arrays.' })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('rejects malformed top-level environments without writing partial data', async () => {
    const result = await invoke('postly:import:collections', {
      collections: [],
      environments: { name: 'Prod', variables: [] },
    })

    expect(result).toEqual({ error: 'Error: Environments must be arrays.' })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('imports validated collections directly from the renderer payload', async () => {
    const result = await invoke('postly:import:collections', {
      collections: [
        {
          name: 'Inline Import',
          description: '',
          source: 'local',
          auth: { type: 'none', config: {} },
          ssl: 'inherit',
          requests: [],
          folders: [],
        },
      ],
    })

    expect(result).toEqual({ data: { count: 1 } })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })

  it('imports standalone environments directly from the renderer payload', async () => {
    const result = await invoke('postly:import:collections', {
      collections: [],
      environments: [
        {
          name: 'Renderer Env',
          variables: [{ key: 'base_url', value: 'https://renderer.example.test', isSecret: false }],
        },
      ],
    })

    expect(result).toEqual({ data: { count: 0 } })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    const statements = mockTransaction.mock.calls[0]?.[0] ?? []
    expect(statements.some((statement) => statement.sql.includes('INSERT INTO environments'))).toBe(true)
    expect(statements.some((statement) => statement.sql.includes('INSERT INTO env_vars'))).toBe(true)
  })

  it('parses inline text and folder payloads through the preview handlers', async () => {
    const parseResult = await invoke('postly:import:parse', {
      text: JSON.stringify({
        info: {
          name: 'Parsed inline',
          schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
        },
        item: [{ name: 'Ping', request: { method: 'GET', url: 'https://example.com/ping' } }],
      }),
      sourceUrl: 'https://example.com/collection.json',
    })
    const folderResult = await invoke('postly:import:parse-folder', {
      files: [
        { path: 'picked/bruno.json', text: JSON.stringify({ name: 'Folder Import' }) },
        { path: 'picked/request.bru', text: 'meta { name: Ping type: http }\n\nget { url: https://example.com/ping }\n' },
      ],
    })

    expect(parseResult).toEqual({
      data: expect.objectContaining({
        format: 'postman',
        collections: [expect.objectContaining({ collection: expect.objectContaining({ name: 'Parsed inline' }) })],
      }),
    })
    expect(folderResult).toEqual({
      data: expect.objectContaining({
        format: 'bruno',
        collections: [expect.objectContaining({ collection: expect.objectContaining({ name: 'Folder Import' }) })],
      }),
    })
  })

  it('surfaces parse and folder preview validation errors', async () => {
    await expect(invoke('postly:import:parse', { text: 42 })).resolves.toEqual({ error: 'No file content provided.' })
    await expect(invoke('postly:import:parse', { text: '' })).resolves.toEqual({ error: 'The file is empty.' })
    await expect(invoke('postly:import:parse-folder', { files: 'bad' })).resolves.toEqual({ error: 'No files provided.' })
    await expect(invoke('postly:import:parse-folder', { files: [{ text: 'x' }] })).resolves.toEqual({ error: 'Each file must include string path and text.' })
    await expect(invoke('postly:import:parse-folder', { files: [{ path: 'picked/readme.md', text: 'hello' }] })).resolves.toEqual({
      error: 'No Bruno (.bru or YAML) or Postman v3 collection files were found in that folder.',
    })
  })

  it('rejects invalid URL input and non-http protocols before fetching', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await expect(invoke('postly:import:fetch-url', { url: 'not a url' })).resolves.toEqual({
      error: 'Enter a valid http(s) URL.',
    })
    await expect(invoke('postly:import:fetch-url', { url: 'ftp://example.com/spec.yaml' })).resolves.toEqual({
      error: 'Only http and https URLs can be imported.',
    })

    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('returns a fetched document when the upstream server succeeds', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('openapi: 3.0.0', {
        status: 200,
        headers: { 'content-length': '14' },
      }),
    )

    const result = await invoke('postly:import:fetch-url', { url: 'https://example.com/openapi.yaml' })

    expect(result).toEqual({ data: { text: 'openapi: 3.0.0' } })
    expect(fetchSpy).toHaveBeenCalledWith(
      new URL('https://example.com/openapi.yaml'),
      expect.objectContaining({
        headers: { Accept: 'application/json, application/yaml, text/yaml, */*' },
      }),
    )
    fetchSpy.mockRestore()
  })

  it('accepts plain http URLs and empty response bodies', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 200 }),
    )

    const result = await invoke('postly:import:fetch-url', { url: 'http://example.com/empty.yaml' })

    expect(result).toEqual({ data: { text: '' } })
    fetchSpy.mockRestore()
  })

  it('handles upstream errors, oversize bodies, and timeouts while fetching URLs', async () => {
    const oversizedChunk = new Uint8Array(MAX_IMPORT_BYTES + 1)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('nope', { status: 502, statusText: 'Bad Gateway' }))
      .mockResolvedValueOnce(new Response('ignored', {
        status: 200,
        headers: { 'content-length': String(MAX_IMPORT_BYTES + 1) },
      }))
      .mockResolvedValueOnce(new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(oversizedChunk)
        },
      }), { status: 200 }))
      .mockRejectedValueOnce(new Error('timed out'))

    await expect(invoke('postly:import:fetch-url', { url: 'https://example.com/status' })).resolves.toEqual({
      error: 'The server answered 502 Bad Gateway.',
    })
    await expect(invoke('postly:import:fetch-url', { url: 'https://example.com/header-too-large' })).resolves.toEqual({
      error: 'The document is larger than 20 MB.',
    })
    await expect(invoke('postly:import:fetch-url', { url: 'https://example.com/stream-too-large' })).resolves.toEqual({
      error: 'The document is larger than 20 MB.',
    })
    await expect(invoke('postly:import:fetch-url', { url: 'https://example.com/timeout' })).resolves.toEqual({
      error: 'Could not fetch the document: timed out',
    })

    fetchSpy.mockRestore()
  })
})
