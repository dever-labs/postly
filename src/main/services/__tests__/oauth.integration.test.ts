/**
 * Integration tests for OAuth token flows using Mockly as the real HTTP backend.
 *
 * These tests exercise the actual HTTP token request path — real network calls to
 * a Mockly server — and verify that:
 *
 *   • clientCredentials sends the correct form params and returns a Token.
 *   • refreshTokenGrant sends the correct form params and returns a Token.
 *   • The token endpoint's error body (error_description) is surfaced in the
 *     thrown Error so callers can display a meaningful message.
 *   • The authorizeAuthCode flow reuses the same persistent session partition
 *     (`persist:oauth-<id>`) across calls so the IDP session cookie is
 *     preserved between auth attempts (no re-login).
 *
 * The database layer is mocked — these tests focus purely on HTTP behaviour.
 *
 * Prerequisites: run `node scripts/download-mockly.mjs` to download the binary.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { MocklyServer } from './helpers/mockly'
import type { OAuthConfig, Token } from '../oauth'

// ─── Mock database (not under test here) ─────────────────────────────────────

vi.mock('../../database', () => ({
  queryOne: vi.fn(),
  run: vi.fn(),
  runTransaction: vi.fn(),
}))

// ─── Mock Electron (authorizeAuthCode uses BrowserWindow / session) ───────────
//
// The session mock records every `session.fromPartition(name)` call so we can
// assert that the correct persistent partition is used on each auth attempt.

const mockSetCertVerifyProc = vi.hoisted(() => vi.fn())
const partitionHistory: string[] = []

const mockFromPartition = vi.hoisted(() =>
  vi.fn().mockImplementation((name: string) => {
    partitionHistory.push(name)
    return { setCertificateVerifyProc: mockSetCertVerifyProc }
  }),
)

vi.mock('electron', () => {
  const BrowserWindowMock = vi.fn().mockImplementation(function () {
    const wcListeners: Record<
      string,
      Array<(event: { preventDefault: () => void }, url: string) => void>
    > = {}
    const winListeners: Record<string, Array<() => void>> = {}

    const removeListener = <T>(listeners: Record<string, Array<T>>, event: string, handler: T) => {
      const list = listeners[event]
      if (!list) return
      const idx = list.indexOf(handler)
      if (idx !== -1) list.splice(idx, 1)
    }

    return {
      loadURL: vi.fn().mockImplementation((url: string) => {
        const authUrl = new URL(url)
        const redirectUri = authUrl.searchParams.get('redirect_uri')
        const state = authUrl.searchParams.get('state')
        if (!redirectUri) return
        const callback = new URL(redirectUri)
        callback.searchParams.set('code', 'integration-auth-code')
        if (state) callback.searchParams.set('state', state)
        setTimeout(() => {
          const evt = { preventDefault: vi.fn() }
          wcListeners['will-redirect']?.forEach((fn) => fn(evt, callback.toString()))
        }, 30)
      }),
      webContents: {
        on: vi.fn().mockImplementation(
          (
            event: string,
            handler: (evt: { preventDefault: () => void }, url: string) => void,
          ) => {
            ;(wcListeners[event] ??= []).push(handler)
          },
        ),
        off: vi.fn().mockImplementation(
          (
            event: string,
            handler: (evt: { preventDefault: () => void }, url: string) => void,
          ) => {
            removeListener(wcListeners, event, handler)
          },
        ),
      },
      on: vi.fn().mockImplementation((event: string, handler: () => void) => {
        ;(winListeners[event] ??= []).push(handler)
      }),
      off: vi.fn().mockImplementation((event: string, handler: () => void) => {
        removeListener(winListeners, event, handler)
      }),
      isDestroyed: vi.fn().mockReturnValue(false),
      close: vi.fn(),
    }
  })

  return {
    BrowserWindow: BrowserWindowMock,
    session: { fromPartition: mockFromPartition },
  }
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseFormBody(body: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(body))
}

const TOKEN_MOCK_ID = 'oauth-token'

const TOKEN_RESPONSE = {
  access_token: 'integration-access-token',
  token_type: 'Bearer',
  expires_in: 3600,
  refresh_token: 'integration-refresh-token',
  scope: 'read write',
}

// ─── Shared server setup ─────────────────────────────────────────────────────

let server: MocklyServer

beforeAll(async () => {
  server = await MocklyServer.create()
  await server.addMock({
    id: TOKEN_MOCK_ID,
    request: { method: 'POST', path: '/oauth2/token' },
    response: {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(TOKEN_RESPONSE),
    },
  })
}, 30_000)

afterAll(() => server?.stop())

beforeEach(async () => {
  await server.clearCalls(TOKEN_MOCK_ID)
  partitionHistory.length = 0
  mockSetCertVerifyProc.mockClear()
})

// ─── clientCredentials ────────────────────────────────────────────────────────

describe('clientCredentials', () => {
  function makeConfig(overrides: Partial<OAuthConfig> = {}): OAuthConfig {
    return {
      id: 'test-config-id',
      name: 'Test Config',
      grantType: 'client_credentials',
      clientId: 'test-client',
      scopes: 'read write',
      tokenUrl: `${server.httpBase}/oauth2/token`,
      redirectUri: 'http://localhost:19999/callback',
      ...overrides,
    }
  }

  it('returns a Token with correct fields from the server response', async () => {
    const { clientCredentials } = await import('../oauth')

    const token = await clientCredentials(makeConfig())

    expect(token.accessToken).toBe('integration-access-token')
    expect(token.tokenType).toBe('Bearer')
    expect(token.refreshToken).toBe('integration-refresh-token')
    expect(token.scope).toBe('read write')
    expect(token.expiresAt).toBeGreaterThan(Date.now())
    expect(typeof token.id).toBe('string')
  })

  it('sends grant_type, client_id, and scope in the POST body', async () => {
    const { clientCredentials } = await import('../oauth')

    await clientCredentials(makeConfig())

    const { calls } = await server.getCalls(TOKEN_MOCK_ID)
    expect(calls).toHaveLength(1)

    const params = parseFormBody(calls[0].body ?? '')
    expect(params['grant_type']).toBe('client_credentials')
    expect(params['client_id']).toBe('test-client')
    expect(params['scope']).toBe('read write')
    expect(params['client_secret']).toBeUndefined()
  })

  it('includes client_secret in the POST body when provided', async () => {
    const { clientCredentials } = await import('../oauth')

    await clientCredentials(makeConfig({ clientSecret: 's3cr3t' }))

    const { calls } = await server.getCalls(TOKEN_MOCK_ID)
    const params = parseFormBody(calls[0].body ?? '')
    expect(params['client_secret']).toBe('s3cr3t')
  })

  it('surfaces the provider error_description when the token endpoint returns 4xx', async () => {
    const { clientCredentials } = await import('../oauth')

    await server.addMock({
      id: 'token-error',
      request: { method: 'POST', path: '/oauth2/token-error' },
      response: {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: 'invalid_client',
          error_description: 'Client authentication failed',
        }),
      },
    })

    await expect(
      clientCredentials(makeConfig({ tokenUrl: `${server.httpBase}/oauth2/token-error` })),
    ).rejects.toThrow('Client authentication failed')

    await server.deleteMock('token-error')
  })

  it('surfaces the HTTP status when the token endpoint returns 5xx', async () => {
    const { clientCredentials } = await import('../oauth')

    await server.addMock({
      id: 'token-500',
      request: { method: 'POST', path: '/oauth2/token-500' },
      response: {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'server_error' }),
      },
    })

    await expect(
      clientCredentials(makeConfig({ tokenUrl: `${server.httpBase}/oauth2/token-500` })),
    ).rejects.toThrow('500')

    await server.deleteMock('token-500')
  })
})

// ─── refreshTokenGrant ────────────────────────────────────────────────────────

describe('refreshTokenGrant', () => {
  const config: OAuthConfig = {
    id: 'refresh-config',
    name: 'Refresh Config',
    grantType: 'authorization_code',
    clientId: 'refresh-client',
    clientSecret: 'refresh-secret',
    scopes: 'read',
    tokenUrl: '',
    redirectUri: 'http://localhost:19999/callback',
  }

  const existingToken: Token = {
    id: 'old-token-id',
    oauthConfigId: 'refresh-config',
    accessToken: 'old-access-token',
    refreshToken: 'my-refresh-token',
    tokenType: 'Bearer',
    createdAt: Date.now() - 3600_000,
  }

  it('sends grant_type=refresh_token, refresh_token, client_id, and client_secret', async () => {
    const { refreshTokenGrant } = await import('../oauth')

    await refreshTokenGrant(existingToken, {
      ...config,
      tokenUrl: `${server.httpBase}/oauth2/token`,
    })

    const { calls } = await server.getCalls(TOKEN_MOCK_ID)
    expect(calls).toHaveLength(1)

    const params = parseFormBody(calls[0].body ?? '')
    expect(params['grant_type']).toBe('refresh_token')
    expect(params['refresh_token']).toBe('my-refresh-token')
    expect(params['client_id']).toBe('refresh-client')
    expect(params['client_secret']).toBe('refresh-secret')
  })

  it('returns a new Token with the server response', async () => {
    const { refreshTokenGrant } = await import('../oauth')

    const token = await refreshTokenGrant(existingToken, {
      ...config,
      tokenUrl: `${server.httpBase}/oauth2/token`,
    })

    expect(token.accessToken).toBe('integration-access-token')
    expect(token.refreshToken).toBe('integration-refresh-token')
  })

  it('throws if the token has no refreshToken field', async () => {
    const { refreshTokenGrant } = await import('../oauth')

    const noRefresh: Token = { ...existingToken, refreshToken: undefined }

    await expect(
      refreshTokenGrant(noRefresh, {
        ...config,
        tokenUrl: `${server.httpBase}/oauth2/token`,
      }),
    ).rejects.toThrow('missing refresh token')
  })
})

// ─── authorizeAuthCode — session persistence ──────────────────────────────────
//
// These tests verify the key session-persistence contract: every call to
// authorizeAuthCode for the same config uses the *same* persistent Electron
// session partition (`persist:oauth-<configId>`), which keeps the IDP session
// cookie alive so the user is not re-prompted to log in.

describe('authorizeAuthCode — session partition persistence', () => {
  const AUTH_CONFIG: OAuthConfig = {
    id: 'session-test-config',
    name: 'Session Test',
    grantType: 'authorization_code',
    clientId: 'session-client',
    scopes: 'openid',
    authUrl: 'http://127.0.0.1:1/authorize', // irrelevant — BrowserWindow is mocked
    tokenUrl: ``,
    redirectUri: 'http://localhost:19999/callback',
  }

  beforeEach(() => {
    AUTH_CONFIG.tokenUrl = `${server.httpBase}/oauth2/token`
  })

  it('uses a persistent partition (persist: prefix) so the session survives', async () => {
    const { authorizeAuthCode } = await import('../oauth')

    await authorizeAuthCode(AUTH_CONFIG)

    // At least one fromPartition call must have used the persist: prefix.
    expect(partitionHistory.some((p) => p.startsWith('persist:'))).toBe(true)
  })

  it('derives the partition name from the config id', async () => {
    const { authorizeAuthCode } = await import('../oauth')

    await authorizeAuthCode(AUTH_CONFIG)

    expect(partitionHistory).toContain(`persist:oauth-${AUTH_CONFIG.id}`)
  })

  it('reuses the same partition across multiple auth attempts for the same config', async () => {
    const { authorizeAuthCode } = await import('../oauth')

    await authorizeAuthCode(AUTH_CONFIG)
    await authorizeAuthCode(AUTH_CONFIG)

    const relevant = partitionHistory.filter(
      (p) => p === `persist:oauth-${AUTH_CONFIG.id}`,
    )
    // Each call should have used the same named partition (at least twice).
    expect(relevant.length).toBeGreaterThanOrEqual(2)
  })

  it('uses a different partition when SSL verification is disabled', async () => {
    const { authorizeAuthCode } = await import('../oauth')

    await authorizeAuthCode(AUTH_CONFIG, false)

    expect(partitionHistory).toContain(`persist:oauth-ssl-disabled-${AUTH_CONFIG.id}`)
    // Must NOT mix the ssl-disabled partition with the normal one.
    expect(partitionHistory).not.toContain(`persist:oauth-${AUTH_CONFIG.id}`)
  })

  it('SSL-disabled partition calls setCertificateVerifyProc to bypass validation', async () => {
    const { authorizeAuthCode } = await import('../oauth')

    await authorizeAuthCode(AUTH_CONFIG, false)

    expect(mockSetCertVerifyProc).toHaveBeenCalledOnce()
  })

  it('different configs get isolated partitions', async () => {
    const { authorizeAuthCode } = await import('../oauth')

    const configA = { ...AUTH_CONFIG, id: 'config-a' }
    const configB = { ...AUTH_CONFIG, id: 'config-b' }

    await authorizeAuthCode(configA)
    await authorizeAuthCode(configB)

    expect(partitionHistory).toContain('persist:oauth-config-a')
    expect(partitionHistory).toContain('persist:oauth-config-b')
  })

  it('token exchange is sent to the token endpoint after the auth redirect', async () => {
    const { authorizeAuthCode } = await import('../oauth')

    const token = await authorizeAuthCode(AUTH_CONFIG)

    // Verify Mockly received the code exchange request.
    const { calls } = await server.getCalls(TOKEN_MOCK_ID)
    expect(calls).toHaveLength(1)

    const params = parseFormBody(calls[0].body ?? '')
    expect(params['grant_type']).toBe('authorization_code')
    expect(params['code']).toBe('integration-auth-code')
    expect(params['client_id']).toBe('session-client')
    expect(params['redirect_uri']).toBe('http://localhost:19999/callback')
    expect(params['code_verifier']).toBeDefined()

    expect(token.accessToken).toBe('integration-access-token')
  })
})
