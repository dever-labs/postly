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

import { registerEnvironmentHandlers } from '../environments'
import { queryAll, queryOne, run } from '../../database'

const mockQueryAll = vi.mocked(queryAll)
const mockQueryOne = vi.mocked(queryOne)
const mockRun = vi.mocked(run)

beforeEach(() => {
  vi.clearAllMocks()
  registerEnvironmentHandlers()
})

// ── list ──────────────────────────────────────────────────────────────────────

describe('postly:environments:list', () => {
  it('returns environments and vars in a single response', async () => {
    const envs = [{ id: 'e1', name: 'Production', is_active: 1 }]
    const vars = [{ id: 'v1', env_id: 'e1', key: 'API_URL', value: 'https://api.example.com' }]
    mockQueryAll.mockReturnValueOnce(envs).mockReturnValueOnce(vars)

    const result = await handlers['postly:environments:list'](null, undefined) as { data: unknown }
    expect(result.data).toEqual({ environments: envs, vars })
  })

  it('returns error string on db failure', async () => {
    mockQueryAll.mockImplementationOnce(() => { throw new Error('db error') })

    const result = await handlers['postly:environments:list'](null, undefined) as { error: string }
    expect(result.error).toContain('db error')
  })
})

// ── create ────────────────────────────────────────────────────────────────────

describe('postly:environments:create', () => {
  it('inserts an environment and returns the new row', async () => {
    const created = { id: 'e1', name: 'Dev', is_active: 0 }
    mockQueryOne.mockReturnValueOnce(created)

    const result = await handlers['postly:environments:create'](null, { name: 'Dev' }) as { data: unknown }
    expect(result.data).toEqual(created)

    const [sql, params] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('INSERT INTO environments')
    expect(params).toContain('Dev')
  })

  it('creates the environment as inactive (is_active=0 is a SQL literal)', async () => {
    mockQueryOne.mockReturnValueOnce({ id: 'e1' })

    await handlers['postly:environments:create'](null, { name: 'Staging' })

    const [sql] = mockRun.mock.calls[0] as [string, unknown[]]
    // is_active=0 is written as a literal in the INSERT, not a bound parameter
    expect(sql).toMatch(/is_active.*0|VALUES.*\?, 0,/)
  })
})

// ── rename ────────────────────────────────────────────────────────────────────

describe('postly:environments:rename', () => {
  it('updates the name for the given id', async () => {
    const result = await handlers['postly:environments:rename'](null, { id: 'e1', name: 'Staging' }) as { data: unknown }
    expect(result.data).toBe(true)

    const [sql, params] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('UPDATE environments SET name = ?')
    expect(params).toContain('Staging')
    expect(params).toContain('e1')
  })
})

// ── delete ────────────────────────────────────────────────────────────────────

describe('postly:environments:delete', () => {
  it('deletes the environment by id', async () => {
    const result = await handlers['postly:environments:delete'](null, { id: 'e1' }) as { data: unknown }
    expect(result.data).toBe(true)

    const [sql, params] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('DELETE FROM environments WHERE id = ?')
    expect(params).toContain('e1')
  })
})

// ── set-active ────────────────────────────────────────────────────────────────

describe('postly:environments:set-active', () => {
  it('clears all is_active flags before activating the given id', async () => {
    const result = await handlers['postly:environments:set-active'](null, { id: 'e2' }) as { data: unknown }
    expect(result.data).toBe(true)

    expect(mockRun).toHaveBeenCalledTimes(2)
    const [sql1] = mockRun.mock.calls[0] as [string, unknown[]]
    const [sql2, params2] = mockRun.mock.calls[1] as [string, unknown[]]
    expect(sql1).toContain('is_active = 0')
    expect(sql2).toContain('is_active = 1')
    expect(params2).toContain('e2')
  })
})

// ── env-vars:list ─────────────────────────────────────────────────────────────

describe('postly:env-vars:list', () => {
  it('returns vars for a given environment id', async () => {
    const vars = [{ id: 'v1', env_id: 'e1', key: 'TOKEN', value: 'abc' }]
    mockQueryAll.mockReturnValueOnce(vars)

    const result = await handlers['postly:env-vars:list'](null, { envId: 'e1' }) as { data: unknown }
    expect(result.data).toEqual(vars)

    const [sql, params] = mockQueryAll.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('WHERE env_id = ?')
    expect(params).toContain('e1')
  })
})

// ── env-vars:upsert ───────────────────────────────────────────────────────────

describe('postly:env-vars:upsert', () => {
  it('inserts or replaces a var and returns the saved row', async () => {
    const saved = { id: 'v1', env_id: 'e1', key: 'TOKEN', value: 'abc', is_secret: 0 }
    mockQueryOne.mockReturnValueOnce(saved)

    const result = await handlers['postly:env-vars:upsert'](null, {
      envId: 'e1', key: 'TOKEN', value: 'abc',
    }) as { data: unknown }
    expect(result.data).toEqual(saved)

    const [sql, params] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('INSERT OR REPLACE INTO env_vars')
    expect(params).toContain('TOKEN')
    expect(params).toContain('abc')
  })

  it('sets is_secret=1 when isSecret=true', async () => {
    mockQueryOne.mockReturnValueOnce({ id: 'v1' })

    await handlers['postly:env-vars:upsert'](null, {
      envId: 'e1', key: 'PWD', value: 'secret', isSecret: true,
    })

    const [, params] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(params).toContain(1)
  })

  it('sets is_secret=0 when isSecret is not provided', async () => {
    mockQueryOne.mockReturnValueOnce({ id: 'v1' })

    await handlers['postly:env-vars:upsert'](null, { envId: 'e1', key: 'K', value: 'V' })

    const [, params] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(params).toContain(0)
  })

  it('reuses provided id instead of generating a new uuid', async () => {
    mockQueryOne.mockReturnValueOnce({ id: 'existing-id' })

    await handlers['postly:env-vars:upsert'](null, {
      envId: 'e1', key: 'K', value: 'V', id: 'existing-id',
    })

    const [, params] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(params[0]).toBe('existing-id')
  })
})

// ── env-vars:delete ───────────────────────────────────────────────────────────

describe('postly:env-vars:delete', () => {
  it('deletes the var by id', async () => {
    const result = await handlers['postly:env-vars:delete'](null, { id: 'v1' }) as { data: unknown }
    expect(result.data).toBe(true)

    const [sql, params] = mockRun.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('DELETE FROM env_vars WHERE id = ?')
    expect(params).toContain('v1')
  })
})
