import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers: Record<string, (ev: unknown, args?: unknown) => Promise<Record<string, unknown>>> = {}

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn((ch: string, fn: (ev: unknown, args?: unknown) => Promise<Record<string, unknown>>) => { handlers[ch] = fn }) }
}))
vi.mock('../../database', () => ({ queryOne: vi.fn(), run: vi.fn() }))
vi.mock('../../services/backstage', () => ({
  syncCatalog: vi.fn(),
  authenticateWithBackstage: vi.fn(),
  authenticateWithBackstageGuest: vi.fn()
}))

import { registerBackstageHandlers } from '../backstage'
import { queryOne, run } from '../../database'
import { syncCatalog, authenticateWithBackstage, authenticateWithBackstageGuest } from '../../services/backstage'

const mockQ1 = vi.mocked(queryOne)
const mockRun = vi.mocked(run)
const user = { name: 'Ada', picture: 'p.png' }

function savedSettings(): Record<string, unknown> {
  const call = mockRun.mock.calls.find((c) => String(c[0]).includes('INSERT OR REPLACE INTO settings'))
  return JSON.parse((call?.[1] as unknown[])[1] as string)
}

beforeEach(() => {
  vi.clearAllMocks()
  registerBackstageHandlers()
})

describe('postly:backstage:sync', () => {
  it('errors when no settings are stored', async () => {
    mockQ1.mockReturnValueOnce(null)
    expect(await handlers['postly:backstage:sync'](null)).toEqual({ error: 'Backstage settings not configured' })
  })

  it('syncs using the stored settings', async () => {
    const settings = { baseUrl: 'https://bs', token: 't', autoSync: false, sslVerification: false }
    mockQ1.mockReturnValueOnce({ value: JSON.stringify(settings) })
    vi.mocked(syncCatalog).mockResolvedValueOnce({ entitiesFound: 2, synced: 2, skipped: 0, errors: [] })
    const res = await handlers['postly:backstage:sync'](null)
    expect(syncCatalog).toHaveBeenCalledWith(settings)
    expect(res.data).toMatchObject({ synced: 2 })
  })

  it('returns an error when the sync throws', async () => {
    mockQ1.mockReturnValueOnce({ value: '{"baseUrl":"x","token":"t"}' })
    vi.mocked(syncCatalog).mockRejectedValueOnce(new Error('boom'))
    expect((await handlers['postly:backstage:sync'](null)).error).toMatch(/boom/)
  })
})

describe('postly:backstage:auth', () => {
  it('rejects unsupported providers', async () => {
    const res = await handlers['postly:backstage:auth'](null, { baseUrl: 'https://bs', provider: 'ldap' })
    expect(res.error).toMatch(/Unsupported auth provider/)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('guest sign-in honours the stored SSL setting and persists the token', async () => {
    mockQ1.mockReturnValueOnce({ value: JSON.stringify({ baseUrl: 'https://bs', token: '', autoSync: true, sslVerification: false }) })
    vi.mocked(authenticateWithBackstageGuest).mockResolvedValueOnce({ token: 'guest-tok', user })
    const res = await handlers['postly:backstage:auth'](null, { baseUrl: 'https://bs', provider: 'guest' })
    expect(authenticateWithBackstageGuest).toHaveBeenCalledWith('https://bs', { sslVerification: false })
    expect(res.data).toEqual({ user })
    expect(savedSettings()).toMatchObject({ token: 'guest-tok', authProvider: 'guest', autoSync: true, connectedUser: user })
  })

  it('defaults SSL verification on and creates settings when none exist', async () => {
    mockQ1.mockReturnValueOnce(null)
    vi.mocked(authenticateWithBackstageGuest).mockResolvedValueOnce({ token: 'g', user })
    await handlers['postly:backstage:auth'](null, { baseUrl: 'https://bs', provider: 'guest' })
    expect(authenticateWithBackstageGuest).toHaveBeenCalledWith('https://bs', { sslVerification: true })
    expect(savedSettings()).toMatchObject({ baseUrl: 'https://bs', token: 'g' })
  })

  it.each(['github', 'gitlab', 'google'])('%s uses the browser OAuth flow', async (provider) => {
    mockQ1.mockReturnValueOnce(null)
    vi.mocked(authenticateWithBackstage).mockResolvedValueOnce({ token: 'oauth-tok', user })
    await handlers['postly:backstage:auth'](null, { baseUrl: 'https://bs', provider })
    expect(authenticateWithBackstage).toHaveBeenCalledWith('https://bs', provider)
    expect(savedSettings()).toMatchObject({ authProvider: provider, token: 'oauth-tok' })
  })

  it('does not persist anything when sign-in fails', async () => {
    mockQ1.mockReturnValueOnce(null)
    vi.mocked(authenticateWithBackstage).mockRejectedValueOnce(new Error('closed'))
    const res = await handlers['postly:backstage:auth'](null, { baseUrl: 'https://bs', provider: 'github' })
    expect(res.error).toMatch(/closed/)
    expect(mockRun).not.toHaveBeenCalled()
  })
})

describe('postly:backstage:disconnect', () => {
  it('clears the token and user but keeps the rest of the settings', async () => {
    mockQ1.mockReturnValueOnce({ value: JSON.stringify({ baseUrl: 'https://bs', token: 't', autoSync: true, connectedUser: user }) })
    expect(await handlers['postly:backstage:disconnect'](null)).toEqual({ data: true })
    const saved = savedSettings()
    expect(saved).toMatchObject({ baseUrl: 'https://bs', token: '', autoSync: true })
    expect(saved.connectedUser).toBeUndefined()
  })

  it('works with no stored settings', async () => {
    mockQ1.mockReturnValueOnce(null)
    expect(await handlers['postly:backstage:disconnect'](null)).toEqual({ data: true })
  })
})
