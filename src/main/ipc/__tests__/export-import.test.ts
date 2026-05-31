import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── DB mock ───────────────────────────────────────────────────────────────────

vi.mock('../../database', () => ({
  queryAll: vi.fn(),
  run: vi.fn(),
}))

import { queryAll, run } from '../../database'
import { tryParse, buildExport, importData } from '../export-import'
import type { PostlyExportFile } from '../export-import'

const mockQueryAll = vi.mocked(queryAll)
const mockRun = vi.mocked(run)

// resetAllMocks also clears the mockReturnValueOnce queue between tests
beforeEach(() => vi.resetAllMocks())

// ── tryParse ──────────────────────────────────────────────────────────────────

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

// ── buildExport ───────────────────────────────────────────────────────────────

describe('buildExport', () => {
  function setupDb(cols: object[], groups: object[], requests: object[]) {
    mockQueryAll
      .mockReturnValueOnce(cols)     // collections query
      .mockReturnValueOnce(groups)   // groups for col[0]
      .mockReturnValueOnce(requests) // requests for grp[0]
    // Note: no integration query mock here — tests that need it add it themselves
  }

  it('returns a file with the correct schema string', () => {
    setupDb(
      [{ id: 'c1', name: 'My API', source: 'local', description: '', auth_type: 'none', auth_config: '{}', ssl_verification: 'inherit' }],
      [{ id: 'g1', collection_id: 'c1', name: 'Default', description: '', auth_type: 'none', auth_config: '{}', ssl_verification: 'inherit' }],
      [],
    )

    const file = buildExport()
    expect(file.$schema).toBe('postly/v1')
    expect(file.exportedAt).toBeTruthy()
  })

  it('serializes a collection with groups and requests', () => {
    const col = { id: 'c1', name: 'API', source: 'local', description: 'desc', auth_type: 'none', auth_config: '{}', ssl_verification: 'inherit', integration_id: null }
    const grp = { id: 'g1', collection_id: 'c1', name: 'Default', description: '', auth_type: 'bearer', auth_config: '{"token":"t"}', ssl_verification: 'verify' }
    const req = { id: 'r1', group_id: 'g1', name: 'Get Users', method: 'GET', url: '/users', protocol: 'http', params: '[]', headers: '[]', body_type: 'none', body_content: '', auth_type: 'none', auth_config: '{}', ssl_verification: 'inherit', description: '', protocol_config: '{}' }

    mockQueryAll
      .mockReturnValueOnce([col])
      .mockReturnValueOnce([grp])
      .mockReturnValueOnce([req])
      .mockReturnValueOnce([]) // integration

    const file = buildExport()
    expect(file.collections).toHaveLength(1)

    const exported = file.collections[0]
    expect(exported.name).toBe('API')
    expect(exported.groups).toHaveLength(1)
    expect(exported.groups[0].requests).toHaveLength(1)
    expect(exported.groups[0].requests[0].name).toBe('Get Users')
    expect(exported.groups[0].requests[0].method).toBe('GET')
  })

  it('filters collections when collectionIds is provided', () => {
    mockQueryAll
      .mockReturnValueOnce([]) // no collections (filtered result)

    const file = buildExport(['c-specific'])
    expect(file.collections).toHaveLength(0)

    const [sql, params] = mockQueryAll.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('WHERE id IN')
    expect(params).toContain('c-specific')
  })

  it('uses all collections when no ids are passed', () => {
    mockQueryAll.mockReturnValueOnce([])

    buildExport()

    const [sql] = mockQueryAll.mock.calls[0] as [string, unknown[]]
    expect(sql).not.toContain('WHERE id IN')
  })

  it('attaches integrationName when the collection has an integration', () => {
    const col = { id: 'c1', name: 'GitHub', source: 'github', description: '', auth_type: 'none', auth_config: '{}', ssl_verification: 'inherit', integration_id: 'int-1' }

    mockQueryAll
      .mockReturnValueOnce([col])
      .mockReturnValueOnce([]) // no groups
      .mockReturnValueOnce([{ name: 'My GitHub Integration' }]) // integration lookup

    const file = buildExport()
    expect(file.collections[0].integrationName).toBe('My GitHub Integration')
  })
})

// ── importData ────────────────────────────────────────────────────────────────

describe('importData', () => {
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
          groups: [
            {
              name: 'Default',
              description: '',
              auth: { type: 'none', config: {} },
              ssl: 'inherit',
              requests: [
                {
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
                },
              ],
            },
          ],
        },
      ],
      ...overrides,
    }
  }

  it('returns the number of imported collections', () => {
    const count = importData(makeFile())
    expect(count).toBe(1)
  })

  it('inserts one collection, one group, and one request row', () => {
    importData(makeFile())

    const insertCalls = mockRun.mock.calls.filter(([sql]) => (sql as string).startsWith('INSERT'))
    expect(insertCalls).toHaveLength(3) // collection + group + request
    const sqls = insertCalls.map(([sql]) => sql as string)
    expect(sqls.some((s) => s.includes('INSERT INTO collections'))).toBe(true)
    expect(sqls.some((s) => s.includes('INSERT INTO groups'))).toBe(true)
    expect(sqls.some((s) => s.includes('INSERT INTO requests'))).toBe(true)
  })

  it('handles multiple collections', () => {
    const file = makeFile()
    file.collections = [...file.collections, { ...file.collections[0], name: 'Second API' }]

    const count = importData(file)
    expect(count).toBe(2)
  })

  it('preserves request fields (url, method, bodyType)', () => {
    importData(makeFile())

    const reqInsert = mockRun.mock.calls.find(([sql]) => (sql as string).includes('INSERT INTO requests'))
    expect(reqInsert).toBeDefined()
    const params = (reqInsert as unknown[][])[1] as unknown[]
    expect(params).toContain('Get Users')
    expect(params).toContain('GET')
    expect(params).toContain('/users')
    expect(params).toContain('none') // bodyType
  })

  it('uses default values for optional fields when absent', () => {
    const file = makeFile()
    const req = file.collections[0].groups[0].requests[0]
    // Remove optional fields to simulate a minimal import
    delete (req as unknown as Record<string, unknown>).description
    delete (req as unknown as Record<string, unknown>).protocolConfig

    // Should not throw
    expect(() => importData(file)).not.toThrow()
  })
})
