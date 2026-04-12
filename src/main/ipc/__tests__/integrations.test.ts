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

vi.mock('../../services/scm-oauth', () => ({}))
vi.mock('../../services/git-local', () => ({ testConnectivity: vi.fn() }))

import { registerIntegrationHandlers } from '../integrations'
import { queryOne, run } from '../../database'

const mockQueryOne = vi.mocked(queryOne)
const mockRun = vi.mocked(run)

beforeEach(() => {
  vi.clearAllMocks()
  registerIntegrationHandlers()
})

// ── create ────────────────────────────────────────────────────────────────────

describe('postly:integrations:create — URL validation', () => {
  it('accepts a valid https repository URL', async () => {
    mockQueryOne.mockReturnValueOnce({ id: 'i1' })
    const result = await handlers['postly:integrations:create'](null, {
      type: 'git', name: 'My Repo', baseUrl: '', repo: 'https://github.com/org/repo.git',
    }) as { data: unknown; error?: string }
    expect(result.error).toBeUndefined()
    expect(result.data).toBeDefined()
  })

  it('accepts a valid ssh git@ repository URL', async () => {
    mockQueryOne.mockReturnValueOnce({ id: 'i2' })
    const result = await handlers['postly:integrations:create'](null, {
      type: 'git', name: 'My Repo', baseUrl: '', repo: 'git@github.com:org/repo.git',
    }) as { data: unknown; error?: string }
    expect(result.error).toBeUndefined()
    expect(result.data).toBeDefined()
  })

  it('accepts a gitlab ssh git@ repository URL', async () => {
    mockQueryOne.mockReturnValueOnce({ id: 'i3' })
    const result = await handlers['postly:integrations:create'](null, {
      type: 'git', name: 'My Repo', baseUrl: '', repo: 'git@gitlab.com:group/project.git',
    }) as { data: unknown; error?: string }
    expect(result.error).toBeUndefined()
    expect(result.data).toBeDefined()
  })

  it('rejects an invalid repository URL', async () => {
    const result = await handlers['postly:integrations:create'](null, {
      type: 'git', name: 'My Repo', baseUrl: '', repo: 'not-a-valid-url',
    }) as { data?: unknown; error: string }
    expect(result.error).toBe('Invalid repository URL')
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('allows creation without a repo field', async () => {
    mockQueryOne.mockReturnValueOnce({ id: 'i4' })
    const result = await handlers['postly:integrations:create'](null, {
      type: 'github', name: 'GitHub', baseUrl: 'https://github.com',
    }) as { data: unknown; error?: string }
    expect(result.error).toBeUndefined()
    expect(result.data).toBeDefined()
  })
})
