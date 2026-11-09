import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../database', () => ({ queryOne: vi.fn(), run: vi.fn() }))
vi.mock('../backstage-oauth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../backstage-oauth')>()),
  discoverAuthorizationServer: vi.fn(),
  refreshAccessToken: vi.fn(),
  revokeToken: vi.fn(),
}))

import { queryOne, run } from '../../database'
import { discoverAuthorizationServer, refreshAccessToken, revokeToken } from '../backstage-oauth'
import { getBackstageAccessToken, refreshIntegrationToken, signOutBackstageOAuth, withBackstageAccessToken } from '../backstage-session'

const META = { authorization_endpoint: 'https://b.example/a', token_endpoint: 'https://b.example/t', revocation_endpoint: 'https://b.example/r' }
const NOW = 1_700_000_000_000

let row: Record<string, unknown>
const savedTokens = () => vi.mocked(run).mock.calls.filter((c) => String(c[0]).startsWith('UPDATE integrations SET token = ?, refresh_token = ?'))

beforeEach(() => {
  vi.resetAllMocks()
  row = { id: 'i1', base_url: 'https://b.example', client_id: 'oauth', token: 'access-1', refresh_token: 'refresh-1', token_expires_at: NOW + 3_600_000, ssl_verification: 'enabled' }
  vi.mocked(queryOne).mockImplementation(() => row)
  // Persist writes back into the row so later reads see them.
  vi.mocked(run).mockImplementation((sql: string, params?: unknown[]) => {
    if (sql.startsWith('UPDATE integrations SET token = ?, refresh_token = ?, token_expires_at = ?')) {
      const [token, refresh, exp] = params as [string, string, number]
      row = { ...row, token, refresh_token: refresh, token_expires_at: exp }
    }
  })
  vi.mocked(discoverAuthorizationServer).mockResolvedValue(META)
})

describe('getBackstageAccessToken', () => {
  it('returns the stored token while it is valid', async () => {
    await expect(getBackstageAccessToken('i1', NOW)).resolves.toBe('access-1')
    expect(refreshAccessToken).not.toHaveBeenCalled()
  })

  it('refreshes shortly before expiry and stores the rotated refresh token', async () => {
    row.token_expires_at = NOW + 30_000
    vi.mocked(refreshAccessToken).mockResolvedValueOnce({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresAt: NOW + 3_600_000 })
    await expect(getBackstageAccessToken('i1', NOW)).resolves.toBe('access-2')
    expect(refreshAccessToken).toHaveBeenCalledWith(META, 'refresh-1', { sslVerification: true })
    expect(savedTokens().at(-1)?.[1]).toEqual(['access-2', 'refresh-2', NOW + 3_600_000, expect.any(Number), 'i1'])
  })

  it('refreshes when there is no access token but a refresh token', async () => {
    row.token = ''
    vi.mocked(refreshAccessToken).mockResolvedValueOnce({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresAt: 0 })
    await expect(getBackstageAccessToken('i1', NOW)).resolves.toBe('access-2')
  })

  it('fails when signed out', async () => {
    row = { ...row, token: '', refresh_token: '' }
    await expect(getBackstageAccessToken('i1', NOW)).rejects.toThrow(/Not signed in/)
  })
})

describe('refreshIntegrationToken', () => {
  it('runs a single refresh for concurrent callers (refresh tokens rotate)', async () => {
    let release!: () => void
    vi.mocked(refreshAccessToken).mockImplementationOnce(() => new Promise((resolve) => {
      release = () => resolve({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresAt: 0 })
    }))
    const a = refreshIntegrationToken('i1')
    const b = refreshIntegrationToken('i1')
    await vi.waitFor(() => expect(refreshAccessToken).toHaveBeenCalled())
    release()
    await expect(Promise.all([a, b])).resolves.toEqual(['access-2', 'access-2'])
    expect(refreshAccessToken).toHaveBeenCalledTimes(1)
  })

  it('clears the session and marks the source disconnected on invalid_grant', async () => {
    vi.mocked(refreshAccessToken).mockRejectedValueOnce(Object.assign(new Error('invalid_grant: expired'), { oauthError: 'invalid_grant' }))
    await expect(refreshIntegrationToken('i1')).rejects.toThrow(/session expired/)
    expect(row).toMatchObject({ token: '', refresh_token: '', token_expires_at: 0 })
    expect(vi.mocked(run).mock.calls.some((c) => String(c[0]).includes('SET status = ?') && (c[1] as unknown[])[0] === 'disconnected')).toBe(true)
  })

  it('keeps the session on transient errors', async () => {
    vi.mocked(refreshAccessToken).mockRejectedValueOnce(new Error('ECONNRESET'))
    await expect(refreshIntegrationToken('i1')).rejects.toThrow(/ECONNRESET/)
    expect(row.refresh_token).toBe('refresh-1')
  })
})

describe('withBackstageAccessToken', () => {
  beforeEach(() => { row.token_expires_at = Date.now() + 3_600_000 })

  it('refreshes once and retries after a 401', async () => {
    vi.mocked(refreshAccessToken).mockResolvedValueOnce({ accessToken: 'access-2', refreshToken: 'refresh-2', expiresAt: 0 })
    const fn = vi.fn()
      .mockRejectedValueOnce({ response: { status: 401 } })
      .mockResolvedValueOnce('ok')
    await expect(withBackstageAccessToken('i1', fn)).resolves.toBe('ok')
    expect(fn.mock.calls).toEqual([['access-1'], ['access-2']])
  })

  it('does not retry other errors', async () => {
    const fn = vi.fn().mockRejectedValue({ response: { status: 500 } })
    await expect(withBackstageAccessToken('i1', fn)).rejects.toEqual({ response: { status: 500 } })
    expect(fn).toHaveBeenCalledTimes(1)
    expect(refreshAccessToken).not.toHaveBeenCalled()
  })
})

describe('signOutBackstageOAuth', () => {
  it('revokes the refresh token and clears both tokens', async () => {
    await signOutBackstageOAuth('i1')
    expect(revokeToken).toHaveBeenCalledWith(META, 'refresh-1', { sslVerification: true })
    expect(row).toMatchObject({ token: '', refresh_token: '', token_expires_at: 0 })
  })

  it('still clears local tokens when revocation fails', async () => {
    vi.mocked(revokeToken).mockRejectedValueOnce(new Error('offline'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await signOutBackstageOAuth('i1')
    expect(row).toMatchObject({ token: '', refresh_token: '' })
  })
})
