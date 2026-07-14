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
 *   • waitForRedirect validates the state on every captured navigation event so
 *     that intermediate same-origin redirects with a wrong or absent state are
 *     ignored — fixing the "OAuth state mismatch" error observed on Windows 11.
 *
 * The database layer is mocked — these tests focus purely on HTTP behaviour.
 *
 * Prerequisites: run `node scripts/download-mockly.mjs` to download the binary.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { BrowserWindow } from 'electron'
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

// ─── authorizeAuthCode — state validation (OAuth state mismatch fix) ──────────
//
// Root cause of issue #134: waitForRedirect captured the first navigation event
// from the same origin that carried a `code` param, regardless of whether its
// `state` matched the one generated for the current flow. On Windows 11, the IDP
// or Chromium can fire extra will-navigate/will-redirect events during the login
// sequence (intermediate form POSTs, consent pages, cached redirects). If any of
// those URLs happened to contain a `code` query parameter but a different — or
// absent — `state`, the flow resolved with the wrong state and threw "OAuth state
// mismatch" before the real callback arrived.
//
// The fix validates the state inside tryCapture and skips any URL whose state
// does not match the generated value, continuing to wait for the real callback.
//
// These tests simulate the exact pattern that triggered the bug: one or more
// "decoy" navigation events that match the redirect-URI origin and carry a code
// but the wrong (or absent) state, followed by the legitimate IDP callback with
// the correct state. The real token exchange is completed against a live Mockly
// server so the full code→token round-trip is exercised.

describe('authorizeAuthCode — state validation', () => {
  /** Builds a BrowserWindow constructor that fires `decoys` before the real callback. */
  function makeWindowWithDecoys({
    decoyUrls,
    decoyEventName = 'will-redirect',
    callbackEventName = 'will-redirect',
  }: {
    /** URLs to fire as decoy events before the real callback. */
    decoyUrls: (redirectOrigin: string) => string[]
    decoyEventName?: 'will-redirect' | 'will-navigate'
    callbackEventName?: 'will-redirect' | 'will-navigate'
  }) {
    return function (this: unknown) {
      const wcListeners: Record<
        string,
        Array<(e: { preventDefault: () => void }, url: string) => void>
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
          const correctState = authUrl.searchParams.get('state')
          if (!redirectUri) return

          const redirectOrigin = new URL(redirectUri).origin
          const decoys = decoyUrls(redirectOrigin)

          // Fire decoy events first, each 20 ms apart.
          decoys.forEach((decoyUrl, i) => {
            setTimeout(() => {
              wcListeners[decoyEventName]?.forEach((fn) =>
                fn({ preventDefault: vi.fn() }, decoyUrl),
              )
            }, 20 * (i + 1))
          })

          // Fire the real callback with the correct code and state after all decoys.
          setTimeout(() => {
            const cb = new URL(redirectUri)
            cb.searchParams.set('code', 'integration-auth-code')
            if (correctState) cb.searchParams.set('state', correctState)
            wcListeners[callbackEventName]?.forEach((fn) =>
              fn({ preventDefault: vi.fn() }, cb.toString()),
            )
          }, 20 * (decoys.length + 1) + 30)
        }),
        webContents: {
          on: vi.fn().mockImplementation(
            (event: string, handler: (e: { preventDefault: () => void }, url: string) => void) => {
              ;(wcListeners[event] ??= []).push(handler)
            },
          ),
          off: vi.fn().mockImplementation(
            (event: string, handler: (e: { preventDefault: () => void }, url: string) => void) => {
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
    }
  }

  const AUTH_CONFIG: OAuthConfig = {
    id: 'state-validation-config',
    name: 'State Validation Test',
    grantType: 'authorization_code',
    clientId: 'state-client',
    scopes: 'openid',
    authUrl: 'http://127.0.0.1:1/authorize',
    tokenUrl: '',
    redirectUri: 'http://localhost:19999/callback',
  }

  beforeEach(() => {
    AUTH_CONFIG.tokenUrl = `${server.httpBase}/oauth2/token`
  })

  it('ignores a will-redirect with a wrong state and resolves on the real callback', async () => {
    vi.mocked(BrowserWindow).mockImplementationOnce(
      makeWindowWithDecoys({
        decoyUrls: (origin) => [`${origin}/callback?code=decoy_code&state=completely-wrong-state`],
      }),
    )
    const { authorizeAuthCode } = await import('../oauth')

    const token = await authorizeAuthCode({ ...AUTH_CONFIG })

    expect(token.accessToken).toBe('integration-access-token')
    const { calls } = await server.getCalls(TOKEN_MOCK_ID)
    // Only the real code (not the decoy) must reach the token endpoint.
    expect(parseFormBody(calls[0].body ?? '')['code']).toBe('integration-auth-code')
  })

  it('ignores a will-redirect with no state param and resolves on the real callback', async () => {
    vi.mocked(BrowserWindow).mockImplementationOnce(
      makeWindowWithDecoys({
        // No `state` param at all — simulates an IDP that omits state on intermediate redirects.
        decoyUrls: (origin) => [`${origin}/callback?code=stateless_code`],
      }),
    )
    const { authorizeAuthCode } = await import('../oauth')

    const token = await authorizeAuthCode({ ...AUTH_CONFIG })

    expect(token.accessToken).toBe('integration-access-token')
  })

  it('ignores a will-navigate with a wrong state and resolves on the real callback', async () => {
    vi.mocked(BrowserWindow).mockImplementationOnce(
      makeWindowWithDecoys({
        decoyUrls: (origin) => [`${origin}/callback?code=nav_decoy&state=bad-state`],
        decoyEventName: 'will-navigate',
      }),
    )
    const { authorizeAuthCode } = await import('../oauth')

    const token = await authorizeAuthCode({ ...AUTH_CONFIG })

    expect(token.accessToken).toBe('integration-access-token')
  })

  it('ignores multiple decoy events in a row before the correct callback arrives', async () => {
    vi.mocked(BrowserWindow).mockImplementationOnce(
      makeWindowWithDecoys({
        decoyUrls: (origin) => [
          `${origin}/callback?code=decoy1&state=wrong-1`,
          `${origin}/other-path?code=decoy2&state=wrong-2`,
          `${origin}/callback?code=decoy3`,
        ],
      }),
    )
    const { authorizeAuthCode } = await import('../oauth')

    const token = await authorizeAuthCode({ ...AUTH_CONFIG })

    expect(token.accessToken).toBe('integration-access-token')
    const { calls } = await server.getCalls(TOKEN_MOCK_ID)
    expect(calls).toHaveLength(1)
    expect(parseFormBody(calls[0].body ?? '')['code']).toBe('integration-auth-code')
  })

  it('ignores will-redirect decoys but resolves when the real callback comes via will-navigate', async () => {
    vi.mocked(BrowserWindow).mockImplementationOnce(
      makeWindowWithDecoys({
        decoyUrls: (origin) => [`${origin}/callback?code=redirect_decoy&state=stale-state`],
        decoyEventName: 'will-redirect',
        callbackEventName: 'will-navigate',
      }),
    )
    const { authorizeAuthCode } = await import('../oauth')

    const token = await authorizeAuthCode({ ...AUTH_CONFIG })

    expect(token.accessToken).toBe('integration-access-token')
  })

  it('completes the full code exchange and persists the token after skipping decoys', async () => {
    const { runTransaction } = await import('../../database')
    vi.mocked(BrowserWindow).mockImplementationOnce(
      makeWindowWithDecoys({
        decoyUrls: (origin) => [
          `${origin}/callback?code=ignored_code&state=stale`,
        ],
      }),
    )
    const { authorizeAuthCode } = await import('../oauth')

    const token = await authorizeAuthCode({ ...AUTH_CONFIG })

    // Token fields from Mockly response.
    expect(token.accessToken).toBe('integration-access-token')
    expect(token.tokenType).toBe('Bearer')
    expect(token.refreshToken).toBe('integration-refresh-token')

    // Database transaction must have been called to persist the token.
    expect(vi.mocked(runTransaction)).toHaveBeenCalled()
    const [statements] = vi.mocked(runTransaction).mock.calls[0]
    const insert = statements.find((s) => s.sql.includes('INSERT INTO tokens'))
    expect(insert?.params).toEqual(expect.arrayContaining(['integration-access-token']))
  })
})
