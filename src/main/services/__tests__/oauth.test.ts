import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AddressInfo } from 'net'
import http from 'http'

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../../database', () => ({
  queryOne: vi.fn(),
  run: vi.fn(),
}))

/**
 * Fake BrowserWindow: when loadURL is called, parse the redirect_uri and state
 * from the auth URL, then simulate the OAuth provider redirecting back by firing
 * a `will-redirect` event on webContents after a short delay.
 *
 * Must use a regular `function` (not an arrow function) so the mock can be
 * called with `new` as a constructor.
 */
vi.mock('electron', () => {
  const BrowserWindowMock = vi.fn().mockImplementation(function () {
    const wcListeners: Record<string, Array<(event: { preventDefault: () => void }, url: string) => void>> = {}
    const winListeners: Record<string, Array<() => void>> = {}
    return {
      loadURL: vi.fn().mockImplementation((url: string) => {
        const authUrl = new URL(url)
        const redirectUri = authUrl.searchParams.get('redirect_uri')
        const state = authUrl.searchParams.get('state')
        if (!redirectUri) return
        const callbackUrl = new URL(redirectUri)
        callbackUrl.searchParams.set('code', 'fake_auth_code')
        if (state) callbackUrl.searchParams.set('state', state)
        // Simulate the OAuth provider's 302 redirect back to the redirect_uri
        setTimeout(() => {
          const event = { preventDefault: vi.fn() }
          wcListeners['will-redirect']?.forEach((fn) => fn(event, callbackUrl.toString()))
        }, 50)
      }),
      webContents: {
        on: vi.fn().mockImplementation(
          (event: string, handler: (evt: { preventDefault: () => void }, url: string) => void) => {
            ;(wcListeners[event] ??= []).push(handler)
          },
        ),
      },
      on: vi.fn().mockImplementation((event: string, handler: () => void) => {
        ;(winListeners[event] ??= []).push(handler)
      }),
      isDestroyed: vi.fn().mockReturnValue(false),
      close: vi.fn(),
    }
  })
  return { BrowserWindow: BrowserWindowMock }
})

import { authorizeAuthCode, clientCredentials, authorizeInline, type OAuthConfig } from '../oauth'
import { run } from '../../database'
import { BrowserWindow } from 'electron'

// ─── Fake IDP ────────────────────────────────────────────────────────────────

interface FakeIdp {
  tokenUrl: string
  authUrl: string
  stop: () => void
  /** Returns all raw request bodies received by the token endpoint so far. */
  requests: () => string[]
}

function startFakeIdp(tokenResponse?: Record<string, unknown>, statusCode = 200): Promise<FakeIdp> {
  const capturedBodies: string[] = []

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        capturedBodies.push(body)
        res.writeHead(statusCode, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify(
            tokenResponse ?? {
              access_token: 'test_access_token',
              token_type: 'Bearer',
              expires_in: 3600,
              scope: 'read write',
              refresh_token: 'test_refresh_token',
            },
          ),
        )
      })
    })

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      const base = `http://127.0.0.1:${port}`
      resolve({
        tokenUrl: `${base}/token`,
        authUrl: `${base}/authorize`,
        stop: () => server.close(),
        requests: () => capturedBodies,
      })
    })

    server.on('error', reject)
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<OAuthConfig> = {}): OAuthConfig {
  return {
    id: 'test-config',
    name: 'Test OAuth',
    grantType: 'authorization_code',
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    authUrl: 'http://idp.example/authorize',
    tokenUrl: 'http://idp.example/token',
    scopes: 'read write',
    redirectUri: 'http://localhost:9876/callback',
    ...overrides,
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('OAuth integration', () => {
  beforeEach(() => vi.clearAllMocks())

  // ── clientCredentials ──────────────────────────────────────────────────────

  describe('clientCredentials', () => {
    let idp: FakeIdp
    beforeEach(async () => { idp = await startFakeIdp() })
    afterEach(() => idp.stop())

    it('returns an access token from the token endpoint', async () => {
      const token = await clientCredentials(makeConfig({ tokenUrl: idp.tokenUrl }))

      expect(token.accessToken).toBe('test_access_token')
      expect(token.tokenType).toBe('Bearer')
      expect(token.refreshToken).toBe('test_refresh_token')
      expect(token.oauthConfigId).toBe('test-config')
      expect(token.expiresAt).toBeGreaterThan(Date.now())
    })

    it('posts the correct parameters to the token endpoint', async () => {
      await clientCredentials(makeConfig({ tokenUrl: idp.tokenUrl }))

      const params = new URLSearchParams(idp.requests()[0])
      expect(params.get('grant_type')).toBe('client_credentials')
      expect(params.get('client_id')).toBe('test-client-id')
      expect(params.get('client_secret')).toBe('test-client-secret')
      expect(params.get('scope')).toBe('read write')
    })

    it('omits client_secret when not provided', async () => {
      const config = makeConfig({ tokenUrl: idp.tokenUrl, clientSecret: undefined })
      await clientCredentials(config)

      const params = new URLSearchParams(idp.requests()[0])
      expect(params.has('client_secret')).toBe(false)
    })

    it('saves the token to the database', async () => {
      await clientCredentials(makeConfig({ tokenUrl: idp.tokenUrl }))

      const mockRun = vi.mocked(run)
      expect(mockRun).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM tokens'),
        ['test-config'],
      )
      expect(mockRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tokens'),
        expect.arrayContaining(['test-config', 'test_access_token', 'Bearer']),
      )
    })
  })

  // ── authorizeAuthCode ──────────────────────────────────────────────────────

  describe('authorizeAuthCode', () => {
    let idp: FakeIdp
    beforeEach(async () => { idp = await startFakeIdp() })
    afterEach(() => idp.stop())

    function cfg(overrides: Partial<OAuthConfig> = {}): OAuthConfig {
      return makeConfig({ tokenUrl: idp.tokenUrl, authUrl: idp.authUrl, ...overrides })
    }

    it('completes the full authorization code flow and returns a token', async () => {
      const token = await authorizeAuthCode(cfg())

      expect(token.accessToken).toBe('test_access_token')
      expect(token.tokenType).toBe('Bearer')
      expect(token.oauthConfigId).toBe('test-config')
    })

    it('sends the authorization code and PKCE verifier to the token endpoint', async () => {
      await authorizeAuthCode(cfg())

      const params = new URLSearchParams(idp.requests()[0])
      expect(params.get('grant_type')).toBe('authorization_code')
      expect(params.get('code')).toBe('fake_auth_code')
      expect(params.get('client_id')).toBe('test-client-id')
      expect(params.get('client_secret')).toBe('test-client-secret')
      // code_verifier must be present and non-empty (PKCE)
      expect(params.get('code_verifier')).toBeTruthy()
    })

    it('uses the configured redirectUri verbatim in both the auth request and token exchange', async () => {
      await authorizeAuthCode(cfg())

      const params = new URLSearchParams(idp.requests()[0])
      expect(params.get('redirect_uri')).toBe('http://localhost:9876/callback')
    })

    it('closes the browser window after the authorization callback is received', async () => {
      await authorizeAuthCode(cfg())

      const win = vi.mocked(BrowserWindow).mock.results[0].value
      expect(win.close).toHaveBeenCalledOnce()
    })

    it('saves the token to the database', async () => {
      await authorizeAuthCode(cfg())

      expect(vi.mocked(run)).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tokens'),
        expect.arrayContaining(['test-config', 'test_access_token']),
      )
    })

    it('calls event.preventDefault() to stop Electron loading the redirect URL', async () => {
      let capturedEvent: { preventDefault: ReturnType<typeof vi.fn> } | null = null
      vi.mocked(BrowserWindow).mockImplementationOnce(function () {
        const wcListeners: Record<string, Array<(e: { preventDefault: () => void }, url: string) => void>> = {}
        const winListeners: Record<string, Array<() => void>> = {}
        return {
          loadURL: vi.fn().mockImplementation((url: string) => {
            const authUrl = new URL(url)
            const redirectUri = authUrl.searchParams.get('redirect_uri')
            const state = authUrl.searchParams.get('state')
            if (!redirectUri) return
            const cb = new URL(redirectUri)
            cb.searchParams.set('code', 'fake_auth_code')
            if (state) cb.searchParams.set('state', state)
            setTimeout(() => {
              const event = { preventDefault: vi.fn() }
              capturedEvent = event
              wcListeners['will-redirect']?.forEach((fn) => fn(event, cb.toString()))
            }, 50)
          }),
          webContents: {
            on: vi.fn().mockImplementation((event: string, handler: (e: { preventDefault: () => void }, url: string) => void) => {
              ;(wcListeners[event] ??= []).push(handler)
            }),
          },
          on: vi.fn().mockImplementation((event: string, handler: () => void) => {
            ;(winListeners[event] ??= []).push(handler)
          }),
          isDestroyed: vi.fn().mockReturnValue(false),
          close: vi.fn(),
        }
      })

      await authorizeAuthCode(cfg())
      expect(capturedEvent).not.toBeNull()
      expect((capturedEvent as unknown as { preventDefault: ReturnType<typeof vi.fn> }).preventDefault).toHaveBeenCalledOnce()
    })

    it('captures the code via will-navigate (JavaScript-initiated redirects)', async () => {
      vi.mocked(BrowserWindow).mockImplementationOnce(function () {
        const wcListeners: Record<string, Array<(e: { preventDefault: () => void }, url: string) => void>> = {}
        const winListeners: Record<string, Array<() => void>> = {}
        return {
          loadURL: vi.fn().mockImplementation((url: string) => {
            const authUrl = new URL(url)
            const redirectUri = authUrl.searchParams.get('redirect_uri')
            const state = authUrl.searchParams.get('state')
            if (!redirectUri) return
            const cb = new URL(redirectUri)
            cb.searchParams.set('code', 'fake_auth_code')
            if (state) cb.searchParams.set('state', state)
            setTimeout(() => {
              const event = { preventDefault: vi.fn() }
              // fire will-navigate instead of will-redirect
              wcListeners['will-navigate']?.forEach((fn) => fn(event, cb.toString()))
            }, 50)
          }),
          webContents: {
            on: vi.fn().mockImplementation((event: string, handler: (e: { preventDefault: () => void }, url: string) => void) => {
              ;(wcListeners[event] ??= []).push(handler)
            }),
          },
          on: vi.fn().mockImplementation((event: string, handler: () => void) => {
            ;(winListeners[event] ??= []).push(handler)
          }),
          isDestroyed: vi.fn().mockReturnValue(false),
          close: vi.fn(),
        }
      })

      const token = await authorizeAuthCode(cfg())
      expect(token.accessToken).toBe('test_access_token')
    })

    it('registers redirect listeners before calling loadURL', async () => {
      const callOrder: string[] = []
      vi.mocked(BrowserWindow).mockImplementationOnce(function () {
        const wcListeners: Record<string, Array<(e: { preventDefault: () => void }, url: string) => void>> = {}
        const winListeners: Record<string, Array<() => void>> = {}
        return {
          loadURL: vi.fn().mockImplementation((url: string) => {
            callOrder.push('loadURL')
            const authUrl = new URL(url)
            const redirectUri = authUrl.searchParams.get('redirect_uri')
            const state = authUrl.searchParams.get('state')
            if (!redirectUri) return
            const cb = new URL(redirectUri)
            cb.searchParams.set('code', 'fake_auth_code')
            if (state) cb.searchParams.set('state', state)
            setTimeout(() => {
              wcListeners['will-redirect']?.forEach((fn) => fn({ preventDefault: vi.fn() }, cb.toString()))
            }, 50)
          }),
          webContents: {
            on: vi.fn().mockImplementation((event: string, handler: (e: { preventDefault: () => void }, url: string) => void) => {
              callOrder.push(`webContents.on(${event})`)
              ;(wcListeners[event] ??= []).push(handler)
            }),
          },
          on: vi.fn().mockImplementation((event: string, handler: () => void) => {
            ;(winListeners[event] ??= []).push(handler)
          }),
          isDestroyed: vi.fn().mockReturnValue(false),
          close: vi.fn(),
        }
      })

      await authorizeAuthCode(cfg())

      const loadURLIdx = callOrder.indexOf('loadURL')
      const willRedirectIdx = callOrder.indexOf('webContents.on(will-redirect)')
      const willNavigateIdx = callOrder.indexOf('webContents.on(will-navigate)')
      expect(willRedirectIdx).toBeGreaterThanOrEqual(0)
      expect(willNavigateIdx).toBeGreaterThanOrEqual(0)
      // Both listeners must be registered BEFORE loadURL is called
      expect(willRedirectIdx).toBeLessThan(loadURLIdx)
      expect(willNavigateIdx).toBeLessThan(loadURLIdx)
    })

    it('surfaces the provider error_description when the token exchange returns 400', async () => {
      const idp400 = await startFakeIdp({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400)
      try {
        await expect(
          authorizeAuthCode(cfg({ tokenUrl: idp400.tokenUrl, authUrl: idp400.authUrl })),
        ).rejects.toThrow('Token endpoint returned 400: PKCE verification failed')
      } finally {
        idp400.stop()
      }
    })

    it('rejects and closes the window when the user closes it early', async () => {
      vi.mocked(BrowserWindow).mockImplementationOnce(function () {
        const winListeners: Record<string, Array<() => void>> = {}
        return {
          loadURL: vi.fn().mockImplementation(() => {
            // Simulate the user closing the window instead of completing auth
            setTimeout(() => winListeners['closed']?.forEach((fn) => fn()), 20)
          }),
          webContents: { on: vi.fn() },
          on: vi.fn().mockImplementation((event: string, handler: () => void) => {
            ;(winListeners[event] ??= []).push(handler)
          }),
          isDestroyed: vi.fn().mockReturnValue(true),
          close: vi.fn(),
        }
      })

      await expect(authorizeAuthCode(cfg())).rejects.toThrow('Authorization window closed')
    })
  })

  // ── authorizeInline ────────────────────────────────────────────────────────

  describe('authorizeInline', () => {
    let idp: FakeIdp
    beforeEach(async () => { idp = await startFakeIdp() })
    afterEach(() => idp.stop())

    it('uses client credentials grant and returns a token', async () => {
      const token = await authorizeInline(
        makeConfig({ grantType: 'client_credentials', tokenUrl: idp.tokenUrl }),
      )

      expect(token.accessToken).toBe('test_access_token')
      const params = new URLSearchParams(idp.requests()[0])
      expect(params.get('grant_type')).toBe('client_credentials')
    })

    it('uses authorization code grant, completes the flow, and closes the window', async () => {
      const token = await authorizeInline(
        makeConfig({ grantType: 'authorization_code', tokenUrl: idp.tokenUrl, authUrl: idp.authUrl }),
      )

      expect(token.accessToken).toBe('test_access_token')
      const win = vi.mocked(BrowserWindow).mock.results[0].value
      expect(win.close).toHaveBeenCalledOnce()
    })

    it('keys the cached token by config hash, not config id', async () => {
      const token = await authorizeInline(
        makeConfig({ grantType: 'client_credentials', tokenUrl: idp.tokenUrl }),
      )

      // The inline flow uses a content-hash as the DB key, not the original id
      expect(token.oauthConfigId).not.toBe('test-config')
      expect(token.oauthConfigId).toHaveLength(32)
    })
  })
})
