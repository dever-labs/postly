import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers: Record<string, (ev: unknown, args: unknown) => Promise<unknown>> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (ev: unknown, args: unknown) => Promise<unknown>) => {
      handlers[channel] = handler
    }),
  },
}))

vi.mock('../../database', () => ({
  queryAll: vi.fn(),
  queryOne: vi.fn(),
  run: vi.fn(),
}))

import { registerRequestHandlers } from '../requests'
import { queryAll, queryOne, run } from '../../database'

const mockQueryAll = vi.mocked(queryAll)
const mockQueryOne = vi.mocked(queryOne)
const mockRun = vi.mocked(run)

beforeEach(() => {
  vi.clearAllMocks()
  registerRequestHandlers()
})

describe('postly:requests:list', () => {
  it('returns requests for a folder ordered by sort_order', async () => {
    const requests = [{ id: 'r1', folder_id: 'f1', name: 'Get Users' }]
    mockQueryAll.mockReturnValueOnce(requests)

    const result = await handlers['postly:requests:list'](null, { folderId: 'f1' }) as { data: unknown }
    expect(result.data).toEqual(requests)

    const [sql, params] = mockQueryAll.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('WHERE folder_id = ?')
    expect(params).toContain('f1')
  })

  it('returns error string on db failure', async () => {
    mockQueryAll.mockImplementationOnce(() => { throw new Error('db error') })

    const result = await handlers['postly:requests:list'](null, { folderId: 'f1' }) as { error: string }
    expect(result.error).toContain('db error')
  })
})

describe('postly:requests:list-all', () => {
  it('returns all requests ordered by sort_order with no folder filter', async () => {
    const requests = [
      { id: 'r1', folder_id: 'f1', sort_order: 0, name: 'Get Users' },
      { id: 'r2', folder_id: 'f2', sort_order: 1, name: 'Get Health' },
    ]
    mockQueryAll.mockReturnValueOnce(requests)

    const result = await handlers['postly:requests:list-all'](null, undefined) as { data: unknown }
    expect(result.data).toEqual(requests)

    const [sql, params] = mockQueryAll.mock.calls[0] as [string, unknown[] | undefined]
    expect(sql).toBe('SELECT * FROM requests ORDER BY sort_order ASC')
    expect(params).toBeUndefined()
  })

  it('returns an empty array when no requests exist', async () => {
    mockQueryAll.mockReturnValueOnce([])

    const result = await handlers['postly:requests:list-all'](null, undefined) as { data: unknown[] }
    expect(result.data).toEqual([])
  })

  it('wraps database errors', async () => {
    mockQueryAll.mockImplementationOnce(() => { throw new Error('db error') })

    const result = await handlers['postly:requests:list-all'](null, undefined) as { error: string }
    expect(result.error).toContain('db error')
  })
})

describe('postly:requests:get', () => {
  it('returns a single request by id', async () => {
    const req = { id: 'r1', name: 'Get Users' }
    mockQueryOne.mockReturnValueOnce(req)

    const result = await handlers['postly:requests:get'](null, { id: 'r1' }) as { data: unknown }
    expect(result.data).toEqual(req)
    expect(mockQueryOne.mock.calls[0][1]).toContain('r1')
  })

  it('returns error string on db failure', async () => {
    mockQueryOne.mockImplementationOnce(() => { throw new Error('not found') })

    const result = await handlers['postly:requests:get'](null, { id: 'r1' }) as { error: string }
    expect(result.error).toContain('not found')
  })
})

describe('postly:requests:create', () => {
  it('inserts a row and returns the new request', async () => {
    const created = { id: 'new-id', folder_id: 'f1', name: 'New Request', method: 'GET' }
    mockQueryOne.mockReturnValueOnce(created)

    const result = await handlers['postly:requests:create'](null, { folderId: 'f1' }) as { data: unknown }
    expect(result.data).toEqual(created)
    expect(mockRun).toHaveBeenCalledOnce()

    const [sql, params] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('INSERT INTO requests')
    expect(params).toContain('f1')
  })

  it('uses provided name and method', async () => {
    mockQueryOne.mockReturnValueOnce({ id: 'x' })

    await handlers['postly:requests:create'](null, { folderId: 'f1', name: 'My Request', method: 'POST' })

    const [, params] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(params).toContain('My Request')
    expect(params).toContain('POST')
  })

  it('defaults to name "New Request" and method "GET" when omitted', async () => {
    mockQueryOne.mockReturnValueOnce({ id: 'x' })

    await handlers['postly:requests:create'](null, { folderId: 'f1' })

    const [, params] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(params).toContain('New Request')
    expect(params).toContain('GET')
  })

  it('returns error string on db failure', async () => {
    mockRun.mockImplementationOnce(() => { throw new Error('constraint') })

    const result = await handlers['postly:requests:create'](null, { folderId: 'f1' }) as { error: string }
    expect(result.error).toContain('constraint')
  })
})

describe('postly:requests:update', () => {
  it('updates mapped fields and sets updated_at', async () => {
    const result = await handlers['postly:requests:update'](null, {
      id: 'r1',
      url: 'https://api.example.com',
      method: 'POST',
    }) as { data: unknown }

    expect(result.data).toBe(true)
    const [sql, params] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('url = ?')
    expect(sql).toContain('method = ?')
    expect(params).toContain('https://api.example.com')
    expect(params).toContain('POST')
  })

  it('maps camelCase bodyType to snake_case body_type', async () => {
    await handlers['postly:requests:update'](null, { id: 'r1', bodyType: 'raw-json' })

    const [sql] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('body_type = ?')
    expect(sql).not.toContain('bodyType')
  })

  it('maps authConfig to auth_config', async () => {
    await handlers['postly:requests:update'](null, { id: 'r1', authConfig: '{"token":"x"}' })

    const [sql] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('auth_config = ?')
  })

  it('maps folderId to folder_id', async () => {
    await handlers['postly:requests:update'](null, { id: 'r1', folderId: 'f2' })

    const [sql] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('folder_id = ?')
  })

  it('returns data:true with no db call when no fields provided', async () => {
    const result = await handlers['postly:requests:update'](null, { id: 'r1' }) as { data: unknown }
    expect(result.data).toBe(true)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('returns error string on db failure', async () => {
    mockRun.mockImplementationOnce(() => { throw new Error('lock') })

    const result = await handlers['postly:requests:update'](null, { id: 'r1', url: 'x' }) as { error: string }
    expect(result.error).toContain('lock')
  })
})

describe('postly:requests:delete', () => {
  it('deletes the request by id', async () => {
    const result = await handlers['postly:requests:delete'](null, { id: 'r1' }) as { data: unknown }

    expect(result.data).toBe(true)
    const [sql, params] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('DELETE FROM requests')
    expect(params).toContain('r1')
  })

  it('returns error string on db failure', async () => {
    mockRun.mockImplementationOnce(() => { throw new Error('fk') })

    const result = await handlers['postly:requests:delete'](null, { id: 'r1' }) as { error: string }
    expect(result.error).toContain('fk')
  })
})

describe('postly:requests:mark-dirty', () => {
  it('sets is_dirty=1 when isDirty=true', async () => {
    await handlers['postly:requests:mark-dirty'](null, { id: 'r1', isDirty: true })

    const [sql, params] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('is_dirty = ?')
    expect(params).toContain(1)
    expect(params).toContain('r1')
  })

  it('sets is_dirty=0 when isDirty=false', async () => {
    await handlers['postly:requests:mark-dirty'](null, { id: 'r1', isDirty: false })

    const [, params] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(params).toContain(0)
  })
})
