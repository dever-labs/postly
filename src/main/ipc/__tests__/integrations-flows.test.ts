import { describe, it, expect, vi, beforeEach } from 'vitest'

type Res = Record<string, unknown>
const handlers: Record<string, (ev: unknown, args?: unknown) => Promise<Res>> = {}

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn((ch: string, fn: (ev: unknown, args?: unknown) => Promise<Res>) => { handlers[ch] = fn }) }
}))
vi.mock('../../database', () => ({ queryAll: vi.fn(), queryOne: vi.fn(), run: vi.fn() }))
vi.mock('../../services/scm-oauth', () => ({
  startGitHubOAuth: vi.fn(),
  startGitLabOAuth: vi.fn(),
  requestGitHubDeviceCode: vi.fn(),
  pollGitHubDeviceToken: vi.fn(),
  requestGitLabDeviceCode: vi.fn(),
  pollGitLabDeviceToken: vi.fn()
}))
vi.mock('../../services/git-local', () => ({ testConnectivity: vi.fn() }))
vi.mock('../../services/backstage', () => ({
  authenticateWithBackstage: vi.fn(),
  authenticateWithBackstageGuest: vi.fn(),
  syncCatalog: vi.fn()
}))

import { registerIntegrationHandlers } from '../integrations'
import { queryAll, queryOne, run } from '../../database'
import * as scm from '../../services/scm-oauth'
import { testConnectivity } from '../../services/git-local'
import { authenticateWithBackstage, authenticateWithBackstageGuest, syncCatalog } from '../../services/backstage'

const mockQ1 = vi.mocked(queryOne)
const mockRun = vi.mocked(run)

const base = { id: 'i1', base_url: 'https://host', client_id: 'cid', client_secret: 'sec', repo: 'https://h/r.git', token: '', ssl_verification: 'enabled' }
const connect = (row: Record<string, unknown>) => {
  mockQ1.mockReturnValueOnce(row) // lookup
  mockQ1.mockReturnValue({ ...row, status: 'connected' }) // re-read after update
  return handlers['postly:integrations:connect'](null, { id: 'i1' })
}
const statusUpdate = () => mockRun.mock.calls.find((c) => String(c[0]).includes('SET token = ?, connected_user = ?, status = ?, error_message'))
const errorUpdate = () => mockRun.mock.calls.find((c) => String(c[0]).includes('SET status = ?, error_message = ?'))

beforeEach(() => {
  vi.resetAllMocks()
  registerIntegrationHandlers()
})

describe('integrations:list / delete / disconnect', () => {
  it('lists integrations', async () => {
    vi.mocked(queryAll).mockReturnValueOnce([{ id: 'a' }])
    expect(await handlers['postly:integrations:list'](null)).toEqual({
      data: [{ id: 'a', has_token: false, has_client_secret: false }],
    })
  })

  it('never returns tokens or client secrets to the renderer', async () => {
    vi.mocked(queryAll).mockReturnValueOnce([{ id: 'a', token: 'tok-123', client_secret: 'sec-456', name: 'n' }])
    const list = await handlers['postly:integrations:list'](null)
    expect(JSON.stringify(list)).not.toMatch(/tok-123|sec-456/)
    expect(list).toEqual({ data: [{ id: 'a', name: 'n', has_token: true, has_client_secret: true }] })

    vi.mocked(queryOne).mockReturnValueOnce({ id: 'a', token: 'tok-123', client_secret: 'sec-456' })
    const created = await handlers['postly:integrations:create'](null, { type: 'backstage', name: 'n', baseUrl: 'https://b.example' })
    expect(JSON.stringify(created)).not.toMatch(/tok-123|sec-456/)
  })

  it('deletes an integration', async () => {
    expect(await handlers['postly:integrations:delete'](null, { id: 'x' })).toEqual({ data: true })
    expect(mockRun).toHaveBeenCalledWith('DELETE FROM integrations WHERE id = ?', ['x'])
  })

  it('disconnect clears credentials and marks disconnected', async () => {
    await handlers['postly:integrations:disconnect'](null, { id: 'x' })
    const [sql, params] = mockRun.mock.calls[0]
    expect(sql).toMatch(/SET token = \?/)
    expect((params as unknown[]).slice(0, 3)).toEqual(['', '', 'disconnected'])
  })
})

describe('integrations:update', () => {
  it('updates only allow-listed columns, accepting snake_case and camelCase', async () => {
    await handlers['postly:integrations:update'](null, { id: 'i1', name: 'N', baseUrl: 'https://x', evil: '1; DROP TABLE', sslVerification: 'disabled' })
    const [sql, params] = mockRun.mock.calls[0]
    expect(sql).toContain('name = ?')
    expect(sql).toContain('base_url = ?')
    expect(sql).toContain('ssl_verification = ?')
    expect(sql).not.toContain('evil')
    expect(sql).toMatch(/WHERE id = \?$/)
    expect((params as unknown[])[(params as unknown[]).length - 1]).toBe('i1')
  })

  it('is a no-op when no allowed fields are given', async () => {
    expect(await handlers['postly:integrations:update'](null, { id: 'i1', evil: 1 })).toEqual({ data: true })
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('persists the token so Backstage OAuth tokens survive Save', async () => {
    await handlers['postly:integrations:update'](null, { id: 'i1', token: 'tok' })
    expect(mockRun.mock.calls[0][1]).toContain('tok')
  })
})

describe('integrations:connect', () => {
  it('git: tests connectivity, stores detected default branch and connects', async () => {
    vi.mocked(testConnectivity).mockResolvedValueOnce({ name: 'Me', defaultBranch: 'trunk' })
    const res = await connect({ ...base, type: 'git' })
    expect(testConnectivity).toHaveBeenCalledWith('https://h/r.git')
    expect(mockRun.mock.calls.some((c) => String(c[0]).includes('SET branch = ?') && (c[1] as unknown[])[0] === 'trunk')).toBe(true)
    expect(statusUpdate()?.[1]).toEqual(['', JSON.stringify({ name: 'Me', avatarUrl: '' }), 'connected', '', expect.any(Number), 'i1'])
    expect(res.data).toBeDefined()
  })

  it('github: runs OAuth with client credentials and stores token + user', async () => {
    vi.mocked(scm.startGitHubOAuth).mockResolvedValueOnce({ token: 'gh-tok', user: { login: 'a' } } as never)
    await connect({ ...base, type: 'github' })
    expect(scm.startGitHubOAuth).toHaveBeenCalledWith({ baseUrl: 'https://host', clientId: 'cid', clientSecret: 'sec' })
    expect(statusUpdate()?.[1]).toEqual(['gh-tok', JSON.stringify({ login: 'a' }), 'connected', '', expect.any(Number), 'i1'])
  })

  it('gitlab: runs OAuth without a client secret', async () => {
    vi.mocked(scm.startGitLabOAuth).mockResolvedValueOnce({ token: 'gl-tok', user: { login: 'b' } } as never)
    await connect({ ...base, type: 'gitlab' })
    expect(scm.startGitLabOAuth).toHaveBeenCalledWith({ baseUrl: 'https://host', clientId: 'cid' })
    expect((statusUpdate()?.[1] as unknown[])[0]).toBe('gl-tok')
  })

  it('backstage token provider keeps the stored token and then syncs', async () => {
    vi.mocked(syncCatalog).mockResolvedValueOnce({ entitiesFound: 1, synced: 1, skipped: 0, errors: [] })
    const res = await connect({ ...base, type: 'backstage', client_id: '', token: 'stored-token' })
    expect(authenticateWithBackstage).not.toHaveBeenCalled()
    expect((statusUpdate()?.[1] as unknown[])[0]).toBe('stored-token')
    expect(syncCatalog).toHaveBeenCalledWith(expect.objectContaining({ token: 'stored-token', authProvider: 'token', integrationId: 'i1', sslVerification: true }))
    expect(res.syncResult).toMatchObject({ synced: 1 })
  })

  it('backstage OAuth provider signs in through the browser flow', async () => {
    vi.mocked(authenticateWithBackstage).mockResolvedValueOnce({ token: 'bs', user: { name: 'U', picture: 'pic' } } as never)
    vi.mocked(syncCatalog).mockResolvedValueOnce({ entitiesFound: 0, synced: 0, skipped: 0, errors: [] })
    await connect({ ...base, type: 'backstage', client_id: 'github' })
    expect(authenticateWithBackstage).toHaveBeenCalledWith('https://host', 'github')
    expect(statusUpdate()?.[1]).toEqual(['bs', JSON.stringify({ name: 'U', avatarUrl: 'pic' }), 'connected', '', expect.any(Number), 'i1'])
  })

  it('backstage with an unknown provider id falls back to token auth', async () => {
    vi.mocked(syncCatalog).mockResolvedValueOnce({ entitiesFound: 0, synced: 0, skipped: 0, errors: [] })
    await connect({ ...base, type: 'backstage', client_id: 'weird', token: 't' })
    expect(authenticateWithBackstage).not.toHaveBeenCalled()
    expect(authenticateWithBackstageGuest).not.toHaveBeenCalled()
    expect(syncCatalog).toHaveBeenCalledWith(expect.objectContaining({ authProvider: 'token' }))
  })

  it('backstage sync failure keeps the connection but records and reports the error', async () => {
    vi.mocked(syncCatalog).mockRejectedValueOnce(new Error('catalog down'))
    const res = await connect({ ...base, type: 'backstage', client_id: '', token: 't' })
    expect(res.syncError).toMatch(/catalog down/)
    expect(mockRun.mock.calls.some((c) => String(c[0]).includes('SET error_message = ?'))).toBe(true)
    expect(errorUpdate()).toBeUndefined()
  })

  it('reports not found without touching the DB', async () => {
    mockQ1.mockReturnValueOnce(null)
    expect(await handlers['postly:integrations:connect'](null, { id: 'nope' })).toEqual({ error: 'Integration not found' })
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('marks the integration as errored when connecting fails', async () => {
    vi.mocked(scm.startGitHubOAuth).mockRejectedValueOnce(new Error('denied'))
    const res = await connect({ ...base, type: 'github' })
    expect(res.error).toMatch(/denied/)
    expect(errorUpdate()?.[1]).toEqual(['error', expect.stringMatching(/denied/), expect.any(Number), 'i1'])
  })
})

describe('integrations device flow', () => {
  const info = { deviceCode: 'dc', userCode: 'UC', verificationUri: 'https://v', interval: 5, expiresIn: 900 }

  it('requires a client id', async () => {
    mockQ1.mockReturnValueOnce({ ...base, type: 'github', client_id: '' })
    expect((await handlers['postly:integrations:device-init'](null, { id: 'i1' })).error).toMatch(/Client ID/)
  })

  it('rejects unsupported integration types', async () => {
    mockQ1.mockReturnValueOnce({ ...base, type: 'git' })
    expect((await handlers['postly:integrations:device-init'](null, { id: 'i1' })).error).toMatch(/not supported/)
  })

  it('github: init returns the user code and poll stores the token', async () => {
    mockQ1.mockReturnValueOnce({ ...base, type: 'github' })
    vi.mocked(scm.requestGitHubDeviceCode).mockResolvedValueOnce(info)
    const init = await handlers['postly:integrations:device-init'](null, { id: 'i1' })
    expect(init.data).toEqual({ userCode: 'UC', verificationUri: 'https://v', expiresIn: 900 })

    vi.mocked(scm.pollGitHubDeviceToken).mockResolvedValueOnce({ token: 'dev-tok', user: { login: 'u' } } as never)
    mockQ1.mockReturnValueOnce({ id: 'i1', status: 'connected' })
    const poll = await handlers['postly:integrations:device-poll'](null, { id: 'i1' })
    expect(scm.pollGitHubDeviceToken).toHaveBeenCalledWith({ baseUrl: 'https://host', clientId: 'cid', deviceCode: 'dc', interval: 5, expiresIn: 900 })
    expect((statusUpdate()?.[1] as unknown[])[0]).toBe('dev-tok')
    expect(poll.data).toBeDefined()

    // the pending flow is consumed
    expect((await handlers['postly:integrations:device-poll'](null, { id: 'i1' })).error).toMatch(/No pending/)
  })

  it('gitlab: poll failure records the error and clears the pending flow', async () => {
    mockQ1.mockReturnValueOnce({ ...base, id: 'g1', type: 'gitlab' })
    vi.mocked(scm.requestGitLabDeviceCode).mockResolvedValueOnce(info)
    await handlers['postly:integrations:device-init'](null, { id: 'g1' })
    vi.mocked(scm.pollGitLabDeviceToken).mockRejectedValueOnce(new Error('expired'))
    const poll = await handlers['postly:integrations:device-poll'](null, { id: 'g1' })
    expect(poll.error).toMatch(/expired/)
    expect(errorUpdate()?.[1]).toEqual(['error', expect.stringMatching(/expired/), expect.any(Number), 'g1'])
    expect((await handlers['postly:integrations:device-poll'](null, { id: 'g1' })).error).toMatch(/No pending/)
  })
})
