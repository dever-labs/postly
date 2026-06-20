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

vi.mock('../../services/git-local', () => ({}))

import { registerCollectionHandlers } from '../collections'
import { queryAll, queryOne, run } from '../../database'

const mockQueryAll = vi.mocked(queryAll)
const mockQueryOne = vi.mocked(queryOne)
const mockRun = vi.mocked(run)

beforeEach(() => {
  vi.clearAllMocks()
  registerCollectionHandlers()
})

describe('postly:collections:list', () => {
  it('returns folders from the database', async () => {
    const folders = [{ id: 'c1', name: 'My API', parent_id: null, collapsed: 0 }]
    mockQueryAll.mockReturnValueOnce(folders)

    const result = await handlers['postly:collections:list'](null, undefined) as { data: unknown }
    expect(result.data).toEqual(folders)
  })
})

describe('postly:folders:create', () => {
  it('creates a root folder with local defaults when parentId is null', async () => {
    mockQueryOne.mockReturnValueOnce({ id: 'root-1' })

    const result = await handlers['postly:folders:create'](null, {
      name: 'New API',
      parentId: null,
    }) as { data: unknown }

    expect(result.data).toEqual({ id: 'root-1' })
    const [sql, params] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('INSERT INTO folders')
    expect(sql).toContain("'none'")
    expect(sql).toContain("'{}'")
    expect(sql).toContain("'inherit'")
    expect(sql).toContain('hidden, collapsed, sort_order')
    expect(params[1]).toBeNull()
    expect(params[2]).toBe('New API')
    expect(params[3]).toBe('local')
    expect(params[4]).toBeNull()
  })

  it('creates a sub-folder with a parentId', async () => {
    mockQueryOne.mockReturnValueOnce({ id: 'child-1' })

    await handlers['postly:folders:create'](null, {
      name: 'Endpoints',
      parentId: 'root-1',
    })

    const [, params] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(params[1]).toBe('root-1')
  })

  it('returns the created folder row', async () => {
    const created = { id: 'folder-1', parent_id: null, name: 'Imported API', source: 'local' }
    mockQueryOne.mockReturnValueOnce(created)

    const result = await handlers['postly:folders:create'](null, { name: 'Imported API' }) as { data: unknown }

    expect(result.data).toEqual(created)
    expect(mockQueryOne).toHaveBeenCalledWith('SELECT * FROM folders WHERE id = ?', [expect.any(String)])
  })

  it('wraps errors', async () => {
    mockRun.mockImplementationOnce(() => { throw new Error('insert failed') })

    const result = await handlers['postly:folders:create'](null, { name: 'Broken API' }) as { error: string }
    expect(result.error).toContain('insert failed')
  })
})

describe('postly:folders:rename', () => {
  it('updates the name field only', async () => {
    const result = await handlers['postly:folders:rename'](null, {
      id: 'f1',
      name: 'Renamed Folder',
    }) as { data: unknown }

    expect(result.data).toBe(true)
    const [sql, params] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(sql).toBe('UPDATE folders SET name = ?, updated_at = ? WHERE id = ?')
    expect(params[0]).toBe('Renamed Folder')
    expect(params[2]).toBe('f1')
  })

  it('wraps errors', async () => {
    mockRun.mockImplementationOnce(() => { throw new Error('rename failed') })

    const result = await handlers['postly:folders:rename'](null, {
      id: 'f1',
      name: 'Renamed Folder',
    }) as { error: string }

    expect(result.error).toContain('rename failed')
  })
})

describe('postly:folders:delete', () => {
  it('deletes a local folder with a direct DELETE', async () => {
    mockQueryOne.mockReturnValueOnce({
      id: 'f1',
      parent_id: null,
      name: 'Local Folder',
      source: 'local',
      source_meta: null,
      integration_id: null,
    })

    const result = await handlers['postly:folders:delete'](null, { id: 'f1' }) as { data: unknown }

    expect(result.data).toBe(true)
    expect(mockQueryOne).toHaveBeenCalledTimes(1)
    expect(mockRun).toHaveBeenCalledWith('DELETE FROM folders WHERE id = ?', ['f1'])
  })

  it('wraps errors', async () => {
    mockQueryOne.mockReturnValueOnce({
      id: 'f1',
      parent_id: null,
      name: 'Local Folder',
      source: 'local',
      source_meta: null,
      integration_id: null,
    })
    mockRun.mockImplementationOnce(() => { throw new Error('delete failed') })

    const result = await handlers['postly:folders:delete'](null, { id: 'f1' }) as { error: string }
    expect(result.error).toContain('delete failed')
  })
})

describe('postly:collections:update', () => {
  it('persists collapsed=true as integer 1', async () => {
    const result = await handlers['postly:collections:update'](null, {
      id: 'c1',
      collapsed: true,
    }) as { data: unknown }

    expect(result.data).toBe(true)
    const [sql, params] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('collapsed = ?')
    expect(params).toContain(1)
  })

  it('persists collapsed=false as integer 0', async () => {
    await handlers['postly:collections:update'](null, { id: 'c1', collapsed: false })

    const [sql, params] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('collapsed = ?')
    expect(params).toContain(0)
  })

  it('omits collapsed field when not provided', async () => {
    await handlers['postly:collections:update'](null, { id: 'c1', name: 'Renamed' })

    const [sql] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(sql).not.toContain('collapsed')
  })

  it('returns data:true with no-op when no fields provided', async () => {
    const result = await handlers['postly:collections:update'](null, { id: 'c1' }) as { data: unknown }
    expect(result.data).toBe(true)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('updates name alongside collapsed', async () => {
    await handlers['postly:collections:update'](null, {
      id: 'c1',
      name: 'Updated',
      collapsed: true,
    })

    const [sql, params] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('name = ?')
    expect(sql).toContain('collapsed = ?')
    expect(params).toContain('Updated')
    expect(params).toContain(1)
  })

  it('maps parentId to parent_id for folder moves', async () => {
    await handlers['postly:collections:update'](null, { id: 'f1', parentId: 'root-1' })

    const [sql, params] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('parent_id = ?')
    expect(params).toContain('root-1')
  })
})

describe('postly:reorder', () => {
  it('updates sort_order for a folder without changing parent', async () => {
    await handlers['postly:reorder'](null, {
      type: 'folder',
      updates: [{ id: 'f1', sortOrder: 2 }],
    })

    const [sql, params] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('sort_order = ?')
    expect(sql).not.toContain('parent_id')
    expect(params).toContain(2)
  })

  it('sets parent_id to a new folder id when moving a folder between parents', async () => {
    await handlers['postly:reorder'](null, {
      type: 'folder',
      updates: [{ id: 'f1', sortOrder: 0, newParentId: 'parent-2' }],
    })

    const [sql, params] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('parent_id = ?')
    expect(params).toContain('parent-2')
  })

  it('sets parent_id to NULL when moving a folder to the root level (newParentId = null)', async () => {
    await handlers['postly:reorder'](null, {
      type: 'folder',
      updates: [{ id: 'f1', sortOrder: 0, newParentId: null }],
    })

    const [sql, params] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('parent_id = ?')
    // null must be passed so SQLite stores NULL — not undefined which would skip the update
    expect(params).toContain(null)
  })

  it('does NOT update parent_id when newParentId is absent (reorder within same parent)', async () => {
    await handlers['postly:reorder'](null, {
      type: 'folder',
      updates: [{ id: 'f1', sortOrder: 1 }],
    })

    const [sql] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(sql).not.toContain('parent_id')
  })

  it('sets folder_id when moving a request to a different folder', async () => {
    await handlers['postly:reorder'](null, {
      type: 'request',
      updates: [{ id: 'r1', sortOrder: 0, newParentId: 'f2' }],
    })

    const [sql, params] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('folder_id = ?')
    expect(params).toContain('f2')
  })
})
