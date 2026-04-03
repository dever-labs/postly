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
  queryOne: vi.fn(),
  run: vi.fn(),
  runDraft: vi.fn(),
}))

import { registerDraftHandlers } from '../drafts'
import { queryOne, run, runDraft } from '../../database'

const mockQueryOne = vi.mocked(queryOne)
const mockRun = vi.mocked(run)
const mockRunDraft = vi.mocked(runDraft)

beforeEach(() => {
  vi.clearAllMocks()
  registerDraftHandlers()
})

// ── Request drafts ────────────────────────────────────────────────────────────

describe('postly:drafts:request:get', () => {
  it('returns null when no draft exists', async () => {
    mockQueryOne.mockReturnValueOnce(null)
    const result = await handlers['postly:drafts:request:get'](null, { requestId: 'r1' }) as { data: unknown }
    expect(result.data).toBeNull()
    expect(mockQueryOne).toHaveBeenCalledWith(
      'SELECT * FROM request_drafts WHERE request_id = ?',
      ['r1']
    )
  })

  it('returns the draft row when one exists', async () => {
    const draft = { request_id: 'r1', url: 'https://example.com', method: 'POST' }
    mockQueryOne.mockReturnValueOnce(draft)
    const result = await handlers['postly:drafts:request:get'](null, { requestId: 'r1' }) as { data: unknown }
    expect(result.data).toEqual(draft)
  })
})

describe('postly:drafts:request:upsert', () => {
  it('inserts a draft with all provided fields', async () => {
    await handlers['postly:drafts:request:upsert'](null, {
      requestId: 'r1',
      method: 'POST',
      url: 'https://api.example.com/users',
      params: '[]',
      headers: '[]',
      bodyType: 'raw-json',
      bodyContent: '{"name":"test"}',
      authType: 'bearer',
      authConfig: '{"token":"abc"}',
      sslVerification: 'enabled',
      protocol: 'http',
      protocolConfig: '{}',
    })

    expect(mockRunDraft).toHaveBeenCalledOnce()
    const [sql, params] = mockRunDraft.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('INSERT OR REPLACE INTO request_drafts')
    expect(params[0]).toBe('r1')
    expect(params[1]).toBe('POST')
    expect(params[2]).toBe('https://api.example.com/users')
    expect(params[6]).toBe('{"name":"test"}')
  })

  it('uses null for omitted optional fields', async () => {
    await handlers['postly:drafts:request:upsert'](null, { requestId: 'r1', url: 'http://localhost' })

    const [, params] = mockRunDraft.mock.calls[0] as [string, unknown[]]
    // method is second param, should be null when not provided
    expect(params[1]).toBeNull()
  })
})

describe('postly:drafts:request:delete', () => {
  it('deletes the draft for the given requestId', async () => {
    await handlers['postly:drafts:request:delete'](null, { requestId: 'r1' })

    expect(mockRun).toHaveBeenCalledWith(
      'DELETE FROM request_drafts WHERE request_id = ?',
      ['r1']
    )
  })
})

// ── Collection drafts ─────────────────────────────────────────────────────────

describe('postly:drafts:collection:get', () => {
  it('returns null when no draft exists', async () => {
    mockQueryOne.mockReturnValueOnce(null)
    const result = await handlers['postly:drafts:collection:get'](null, { collectionId: 'c1' }) as { data: unknown }
    expect(result.data).toBeNull()
  })

  it('returns the draft when it exists', async () => {
    const draft = { collection_id: 'c1', name: 'Draft Name', description: 'desc' }
    mockQueryOne.mockReturnValueOnce(draft)
    const result = await handlers['postly:drafts:collection:get'](null, { collectionId: 'c1' }) as { data: unknown }
    expect(result.data).toEqual(draft)
  })
})

describe('postly:drafts:collection:upsert', () => {
  it('inserts a collection draft with correct fields', async () => {
    await handlers['postly:drafts:collection:upsert'](null, {
      collectionId: 'c1',
      name: 'My Collection',
      description: 'A test collection',
      authType: 'bearer',
      authConfig: '{"token":"secret"}',
      sslVerification: 'enabled',
    })

    expect(mockRunDraft).toHaveBeenCalledOnce()
    const [sql, params] = mockRunDraft.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('INSERT OR REPLACE INTO collection_drafts')
    expect(params[0]).toBe('c1')
    expect(params[1]).toBe('My Collection')
    expect(params[3]).toBe('bearer')
  })
})

describe('postly:drafts:collection:delete', () => {
  it('deletes the collection draft', async () => {
    await handlers['postly:drafts:collection:delete'](null, { collectionId: 'c1' })

    expect(mockRun).toHaveBeenCalledWith(
      'DELETE FROM collection_drafts WHERE collection_id = ?',
      ['c1']
    )
  })
})

// ── Group drafts ──────────────────────────────────────────────────────────────

describe('postly:drafts:group:get', () => {
  it('returns null when no draft exists', async () => {
    mockQueryOne.mockReturnValueOnce(null)
    const result = await handlers['postly:drafts:group:get'](null, { groupId: 'g1' }) as { data: unknown }
    expect(result.data).toBeNull()
    expect(mockQueryOne).toHaveBeenCalledWith(
      'SELECT * FROM group_drafts WHERE group_id = ?',
      ['g1']
    )
  })

  it('returns the draft when it exists', async () => {
    const draft = { group_id: 'g1', name: 'Draft Group', description: 'desc' }
    mockQueryOne.mockReturnValueOnce(draft)
    const result = await handlers['postly:drafts:group:get'](null, { groupId: 'g1' }) as { data: unknown }
    expect(result.data).toEqual(draft)
  })
})

describe('postly:drafts:group:upsert', () => {
  it('inserts a group draft with correct fields', async () => {
    await handlers['postly:drafts:group:upsert'](null, {
      groupId: 'g1',
      name: 'My Group',
      description: 'A test group',
      authType: 'bearer',
      authConfig: '{"token":"secret"}',
      sslVerification: 'enabled',
    })

    expect(mockRunDraft).toHaveBeenCalledOnce()
    const [sql, params] = mockRunDraft.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('INSERT OR REPLACE INTO group_drafts')
    expect(params[0]).toBe('g1')
    expect(params[1]).toBe('My Group')
    expect(params[3]).toBe('bearer')
  })

  it('uses null for omitted optional fields', async () => {
    await handlers['postly:drafts:group:upsert'](null, { groupId: 'g1' })

    const [, params] = mockRunDraft.mock.calls[0] as [string, unknown[]]
    expect(params[1]).toBeNull()
    expect(params[2]).toBeNull()
  })
})

describe('postly:drafts:group:delete', () => {
  it('deletes the group draft', async () => {
    await handlers['postly:drafts:group:delete'](null, { groupId: 'g1' })

    expect(mockRun).toHaveBeenCalledWith(
      'DELETE FROM group_drafts WHERE group_id = ?',
      ['g1']
    )
  })
})

// ── Environment drafts ────────────────────────────────────────────────────────

describe('postly:drafts:env:get', () => {
  it('returns null when no env draft exists', async () => {
    mockQueryOne.mockReturnValueOnce(null)
    const result = await handlers['postly:drafts:env:get'](null, { envId: 'e1' }) as { data: unknown }
    expect(result.data).toBeNull()
  })
})

describe('postly:drafts:env:upsert', () => {
  it('stores the full vars JSON snapshot', async () => {
    const varsJson = JSON.stringify([{ id: 'v1', key: 'API_URL', value: 'http://localhost', isSecret: false }])
    await handlers['postly:drafts:env:upsert'](null, { envId: 'e1', varsJson })

    expect(mockRunDraft).toHaveBeenCalledOnce()
    const [sql, params] = mockRunDraft.mock.calls[0] as [string, unknown[]]
    expect(sql).toContain('INSERT OR REPLACE INTO env_drafts')
    expect(params[0]).toBe('e1')
    expect(params[1]).toBe(varsJson)
  })
})

describe('postly:drafts:env:delete', () => {
  it('deletes the env draft', async () => {
    await handlers['postly:drafts:env:delete'](null, { envId: 'e1' })

    expect(mockRun).toHaveBeenCalledWith(
      'DELETE FROM env_drafts WHERE env_id = ?',
      ['e1']
    )
  })
})
