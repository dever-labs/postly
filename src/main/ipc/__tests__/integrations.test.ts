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
vi.mock('../../services/backstage', () => ({
  authenticateWithBackstageGuest: vi.fn(),
  authenticateWithBackstage: vi.fn(),
  syncCatalog: vi.fn(),
}))
vi.mock('../../services/git-local', () => ({ testConnectivity: vi.fn() }))

import { registerIntegrationHandlers } from '../integrations'
import { queryOne, run } from '../../database'
import { authenticateWithBackstageGuest, syncCatalog } from '../../services/backstage'

const mockQueryOne = vi.mocked(queryOne)
const mockRun = vi.mocked(run)
const mockAuthGuest = vi.mocked(authenticateWithBackstageGuest)
const mockSyncCatalog = vi.mocked(syncCatalog)

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

// ── connect — Backstage SSL verification ─────────────────────────────────────

function makeBackstageIntegration(sslVerification: string) {
  return {
    id: 'bs-1',
    type: 'backstage',
    base_url: 'https://backstage.example.com',
    client_id: 'guest',
    token: '',
    ssl_verification: sslVerification,
  }
}

describe('postly:integrations:connect — Backstage SSL', () => {
  const guestUser = { name: 'Guest', avatarUrl: '' }
  const syncResult = { entitiesFound: 2, synced: 2, skipped: 0, errors: [] }

  beforeEach(() => {
    mockAuthGuest.mockResolvedValue({ token: 'guest-token', user: { name: 'Guest' } })
    mockSyncCatalog.mockResolvedValue(syncResult)
  })

  it('passes sslVerification=true to syncCatalog when ssl_verification is "enabled"', async () => {
    const integration = makeBackstageIntegration('enabled')
    mockQueryOne.mockReturnValueOnce(integration).mockReturnValueOnce(integration)

    await handlers['postly:integrations:connect'](null, { id: 'bs-1' })

    expect(mockSyncCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ sslVerification: true }),
    )
  })

  it('passes sslVerification=false to syncCatalog when ssl_verification is "disabled"', async () => {
    const integration = makeBackstageIntegration('disabled')
    mockQueryOne.mockReturnValueOnce(integration).mockReturnValueOnce(integration)

    await handlers['postly:integrations:connect'](null, { id: 'bs-1' })

    expect(mockSyncCatalog).toHaveBeenCalledWith(
      expect.objectContaining({ sslVerification: false }),
    )
  })

  it('passes sslVerification=true to authenticateWithBackstageGuest when ssl_verification is "enabled"', async () => {
    const integration = makeBackstageIntegration('enabled')
    mockQueryOne.mockReturnValueOnce(integration).mockReturnValueOnce(integration)

    await handlers['postly:integrations:connect'](null, { id: 'bs-1' })

    expect(mockAuthGuest).toHaveBeenCalledWith(
      'https://backstage.example.com',
      expect.objectContaining({ sslVerification: true }),
    )
  })

  it('passes sslVerification=false to authenticateWithBackstageGuest when ssl_verification is "disabled"', async () => {
    const integration = makeBackstageIntegration('disabled')
    mockQueryOne.mockReturnValueOnce(integration).mockReturnValueOnce(integration)

    await handlers['postly:integrations:connect'](null, { id: 'bs-1' })

    expect(mockAuthGuest).toHaveBeenCalledWith(
      'https://backstage.example.com',
      expect.objectContaining({ sslVerification: false }),
    )
  })

  it('returns an error when the integration is not found', async () => {
    mockQueryOne.mockReturnValueOnce(null)

    const result = await handlers['postly:integrations:connect'](null, { id: 'missing' }) as { error: string }

    expect(result.error).toBe('Integration not found')
    expect(mockSyncCatalog).not.toHaveBeenCalled()
  })
})
