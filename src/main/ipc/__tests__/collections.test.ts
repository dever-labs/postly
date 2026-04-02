import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture registered handlers by channel name so tests can call them directly.
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
import { queryAll, run } from '../../database'

const mockQueryAll = vi.mocked(queryAll)
const mockRun = vi.mocked(run)

beforeEach(() => {
  vi.clearAllMocks()
  registerCollectionHandlers()
})

// ── list ─────────────────────────────────────────────────────────────────────

describe('postly:collections:list', () => {
  it('returns collections and groups from the database', async () => {
    const cols = [{ id: 'c1', name: 'My API', collapsed: 0 }]
    const grps = [{ id: 'g1', collection_id: 'c1', name: 'Default', collapsed: 0 }]
    mockQueryAll
      .mockReturnValueOnce(cols)
      .mockReturnValueOnce(grps)

    const result = await handlers['postly:collections:list'](null, undefined) as { data: unknown }
    expect(result.data).toEqual({ collections: cols, groups: grps })
  })
})

// ── update ───────────────────────────────────────────────────────────────────

describe('postly:collections:update', () => {
  it('persists collapsed=true as integer 1', async () => {
    const result = await handlers['postly:collections:update'](null, {
      id: 'c1',
      collapsed: true,
    }) as { data: unknown }

    expect(result.data).toBe(true)
    expect(mockRun).toHaveBeenCalledOnce()
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
})
