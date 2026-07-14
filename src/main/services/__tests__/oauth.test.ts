import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import type { AddressInfo } from 'net'
import http from 'http'
import https from 'https'
import { generate as generateCert } from 'selfsigned'

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../../database', () => ({
  queryOne: vi.fn(),
  run: vi.fn(),
  runTransaction: vi.fn(),
}))

// Expose session mock references so SSL tests can assert on them.
const mockSetCertVerifyProc = vi.hoisted(() => vi.fn())
const mockFromPartition = vi.hoisted(() => vi.fn().mockReturnValue({ setCertificateVerifyProc: mockSetCertVerifyProc }))

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
    const removeListener = <T>(listeners: Record<string, Array<T>>, event: string, handler: T) => {
      const list = listeners[event]
      if (!list) return
      const index = list.indexOf(handler)
      if (index !== -1) {
        list.splice(index, 1)
      }
    }
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
        off: vi.fn().mockImplementation(
          (event: string, handler: (evt: { preventDefault: () => void }, url: string) => void) => {
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

import { authorizeAuthCode, clientCredentials, authorizeInline, getValidToken, getValidTokenForConfig, configHashKey, type OAuthConfig } from '../oauth'
import { queryOne, runTransaction } from '../../database'
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

/**
 * Like startFakeIdp but serves over HTTPS with a self-signed certificate.
 * Used to test SSL verification behaviour.
 */
function startFakeIdpHttps(
  pems: { private: string; cert: string },
  tokenResponse?: Record<string, unknown>,
  statusCode = 200,
): Promise<FakeIdp> {
  const capturedBodies: string[] = []

  return new Promise((resolve, reject) => {
    const server = https.createServer({ key: pems.private, cert: pems.cert }, (req, res) => {
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
      const base = `https://127.0.0.1:${port}`
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

      expect(vi.mocked(runTransaction)).toHaveBeenCalledOnce()
      const [statements] = vi.mocked(runTransaction).mock.calls[0]
      expect(statements.some((s) => s.sql.includes('DELETE FROM tokens'))).toBe(true)
      expect(statements.some((s) => s.sql.includes('INSERT INTO tokens'))).toBe(true)
      const insertStmt = statements.find((s) => s.sql.includes('INSERT INTO tokens'))
      expect(insertStmt?.params).toEqual(expect.arrayContaining(['test-config', 'test_access_token', 'Bearer']))
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

      expect(vi.mocked(runTransaction)).toHaveBeenCalledOnce()
      const [statements] = vi.mocked(runTransaction).mock.calls[0]
      expect(statements.some((s) => s.sql.includes('INSERT INTO tokens'))).toBe(true)
      const insertStmt = statements.find((s) => s.sql.includes('INSERT INTO tokens'))
      expect(insertStmt?.params).toEqual(expect.arrayContaining(['test-config', 'test_access_token']))
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
            off: vi.fn(),
          },
          on: vi.fn().mockImplementation((event: string, handler: () => void) => {
            ;(winListeners[event] ??= []).push(handler)
          }),
          off: vi.fn(),
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
            off: vi.fn(),
          },
          on: vi.fn().mockImplementation((event: string, handler: () => void) => {
            ;(winListeners[event] ??= []).push(handler)
          }),
          off: vi.fn(),
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
            off: vi.fn(),
          },
          on: vi.fn().mockImplementation((event: string, handler: () => void) => {
            ;(winListeners[event] ??= []).push(handler)
          }),
          off: vi.fn(),
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
          webContents: { on: vi.fn(), off: vi.fn() },
          on: vi.fn().mockImplementation((event: string, handler: () => void) => {
            ;(winListeners[event] ??= []).push(handler)
          }),
          off: vi.fn(),
          isDestroyed: vi.fn().mockReturnValue(true),
          close: vi.fn(),
        }
      })

      await expect(authorizeAuthCode(cfg())).rejects.toThrow('Authorization window closed')
    })

    // ── state validation (issue #134 — OAuth state mismatch on Windows 11) ──
    //
    // waitForRedirect must skip any navigation event that carries a `code` from
    // the expected origin but a wrong or absent `state`. Only the event whose
    // `state` matches the generated value should resolve the promise.

    it('ignores a will-redirect from the same origin that has a code but wrong state', async () => {
      vi.mocked(BrowserWindow).mockImplementationOnce(function () {
        const wcListeners: Record<string, Array<(e: { preventDefault: () => void }, url: string) => void>> = {}
        const winListeners: Record<string, Array<() => void>> = {}
        return {
          loadURL: vi.fn().mockImplementation((url: string) => {
            const authUrl = new URL(url)
            const redirectUri = authUrl.searchParams.get('redirect_uri')
            const correctState = authUrl.searchParams.get('state')
            if (!redirectUri) return
            const origin = new URL(redirectUri).origin

            // Decoy: same origin, has code, but wrong state
            setTimeout(() => {
              const decoy = `${origin}/callback?code=decoy_code&state=totally-wrong-state`
              wcListeners['will-redirect']?.forEach((fn) => fn({ preventDefault: vi.fn() }, decoy))
            }, 20)

            // Real callback: correct code and state
            setTimeout(() => {
              const cb = new URL(redirectUri)
              cb.searchParams.set('code', 'fake_auth_code')
              if (correctState) cb.searchParams.set('state', correctState)
              wcListeners['will-redirect']?.forEach((fn) => fn({ preventDefault: vi.fn() }, cb.toString()))
            }, 60)
          }),
          webContents: {
            on: vi.fn().mockImplementation((event: string, handler: (e: { preventDefault: () => void }, url: string) => void) => {
              ;(wcListeners[event] ??= []).push(handler)
            }),
            off: vi.fn(),
          },
          on: vi.fn().mockImplementation((event: string, handler: () => void) => {
            ;(winListeners[event] ??= []).push(handler)
          }),
          off: vi.fn(),
          isDestroyed: vi.fn().mockReturnValue(false),
          close: vi.fn(),
        }
      })

      const token = await authorizeAuthCode(cfg())
      expect(token.accessToken).toBe('test_access_token')
    })

    it('ignores a will-redirect with no state param and resolves on the correct callback', async () => {
      vi.mocked(BrowserWindow).mockImplementationOnce(function () {
        const wcListeners: Record<string, Array<(e: { preventDefault: () => void }, url: string) => void>> = {}
        const winListeners: Record<string, Array<() => void>> = {}
        return {
          loadURL: vi.fn().mockImplementation((url: string) => {
            const authUrl = new URL(url)
            const redirectUri = authUrl.searchParams.get('redirect_uri')
            const correctState = authUrl.searchParams.get('state')
            if (!redirectUri) return
            const origin = new URL(redirectUri).origin

            // Decoy: same origin, has code, NO state param at all
            setTimeout(() => {
              const decoy = `${origin}/callback?code=stateless_code`
              wcListeners['will-redirect']?.forEach((fn) => fn({ preventDefault: vi.fn() }, decoy))
            }, 20)

            // Real callback
            setTimeout(() => {
              const cb = new URL(redirectUri)
              cb.searchParams.set('code', 'fake_auth_code')
              if (correctState) cb.searchParams.set('state', correctState)
              wcListeners['will-redirect']?.forEach((fn) => fn({ preventDefault: vi.fn() }, cb.toString()))
            }, 60)
          }),
          webContents: {
            on: vi.fn().mockImplementation((event: string, handler: (e: { preventDefault: () => void }, url: string) => void) => {
              ;(wcListeners[event] ??= []).push(handler)
            }),
            off: vi.fn(),
          },
          on: vi.fn().mockImplementation((event: string, handler: () => void) => {
            ;(winListeners[event] ??= []).push(handler)
          }),
          off: vi.fn(),
          isDestroyed: vi.fn().mockReturnValue(false),
          close: vi.fn(),
        }
      })

      const token = await authorizeAuthCode(cfg())
      expect(token.accessToken).toBe('test_access_token')
    })

    it('ignores a will-navigate with wrong state and resolves when correct will-navigate fires', async () => {
      vi.mocked(BrowserWindow).mockImplementationOnce(function () {
        const wcListeners: Record<string, Array<(e: { preventDefault: () => void }, url: string) => void>> = {}
        const winListeners: Record<string, Array<() => void>> = {}
        return {
          loadURL: vi.fn().mockImplementation((url: string) => {
            const authUrl = new URL(url)
            const redirectUri = authUrl.searchParams.get('redirect_uri')
            const correctState = authUrl.searchParams.get('state')
            if (!redirectUri) return
            const origin = new URL(redirectUri).origin

            // Decoy via will-navigate: same origin, code present, bad state
            setTimeout(() => {
              const decoy = `${origin}/callback?code=nav_decoy&state=stale-state-from-old-session`
              wcListeners['will-navigate']?.forEach((fn) => fn({ preventDefault: vi.fn() }, decoy))
            }, 20)

            // Real callback via will-navigate
            setTimeout(() => {
              const cb = new URL(redirectUri)
              cb.searchParams.set('code', 'fake_auth_code')
              if (correctState) cb.searchParams.set('state', correctState)
              wcListeners['will-navigate']?.forEach((fn) => fn({ preventDefault: vi.fn() }, cb.toString()))
            }, 60)
          }),
          webContents: {
            on: vi.fn().mockImplementation((event: string, handler: (e: { preventDefault: () => void }, url: string) => void) => {
              ;(wcListeners[event] ??= []).push(handler)
            }),
            off: vi.fn(),
          },
          on: vi.fn().mockImplementation((event: string, handler: () => void) => {
            ;(winListeners[event] ??= []).push(handler)
          }),
          off: vi.fn(),
          isDestroyed: vi.fn().mockReturnValue(false),
          close: vi.fn(),
        }
      })

      const token = await authorizeAuthCode(cfg())
      expect(token.accessToken).toBe('test_access_token')
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

  // ── SSL verification ───────────────────────────────────────────────────────

  describe('SSL verification', () => {
    let pems: { private: string; cert: string }

    // Generate a self-signed cert once for the entire suite — it's slow (~200ms).
    beforeAll(async () => {
      pems = await generateCert()
    })

    describe('clientCredentials against a self-signed HTTPS endpoint', () => {
      let idp: FakeIdp
      beforeEach(async () => { idp = await startFakeIdpHttps(pems) })
      afterEach(() => idp.stop())

      it('fails with a certificate error when sslVerification is true (default)', async () => {
        await expect(
          clientCredentials(makeConfig({ tokenUrl: idp.tokenUrl }))
        ).rejects.toThrow()
        // No request should have reached the server
        expect(idp.requests()).toHaveLength(0)
      })

      it('succeeds and returns a token when sslVerification is false', async () => {
        const token = await clientCredentials(makeConfig({ tokenUrl: idp.tokenUrl }), false)
        expect(token.accessToken).toBe('test_access_token')
        expect(idp.requests()).toHaveLength(1)
      })
    })

    describe('authorizeAuthCode token exchange against a self-signed HTTPS endpoint', () => {
      let idp: FakeIdp
      beforeEach(async () => { idp = await startFakeIdpHttps(pems) })
      afterEach(() => idp.stop())

      it('fails the token exchange when sslVerification is true (default)', async () => {
        // authUrl uses HTTP so the mocked BrowserWindow works; only the token
        // exchange POST hits the HTTPS server and must be rejected.
        await expect(
          authorizeAuthCode(makeConfig({ tokenUrl: idp.tokenUrl }))
        ).rejects.toThrow()
        expect(idp.requests()).toHaveLength(0)
      })

      it('completes the flow and returns a token when sslVerification is false', async () => {
        const token = await authorizeAuthCode(makeConfig({ tokenUrl: idp.tokenUrl }), false)
        expect(token.accessToken).toBe('test_access_token')
        expect(idp.requests()).toHaveLength(1)
      })

      it('creates a persistent partition namespaced to the config and bypasses cert verification when sslVerification is false', async () => {
        await authorizeAuthCode(makeConfig({ tokenUrl: idp.tokenUrl }), false)

        expect(mockFromPartition).toHaveBeenCalledWith('persist:oauth-ssl-disabled-test-config')
        // The cert verify proc must be called with a callback — pass 0 = OK
        expect(mockSetCertVerifyProc).toHaveBeenCalledWith(expect.any(Function))
        const proc = mockSetCertVerifyProc.mock.calls[0][0] as (req: unknown, cb: (result: number) => void) => void
        const callback = vi.fn()
        proc({}, callback)
        expect(callback).toHaveBeenCalledWith(0)
      })

      it('uses a persistent partition keyed to the config id when sslVerification is true (default)', async () => {
        // Use HTTP idp so the request actually completes cleanly
        const httpIdp = await startFakeIdp()
        try {
          await authorizeAuthCode(makeConfig({ tokenUrl: httpIdp.tokenUrl, authUrl: httpIdp.authUrl }))
          expect(mockFromPartition).toHaveBeenCalledWith('persist:oauth-test-config')
          expect(mockSetCertVerifyProc).not.toHaveBeenCalled()
        } finally {
          httpIdp.stop()
        }
      })
    })
  })
})

// ─── getValidToken ────────────────────────────────────────────────────────────

describe('getValidToken', () => {
  const mockQueryOne = vi.mocked(queryOne)
  const mockRunTransaction = vi.mocked(runTransaction)

  const tokenRow = {
    id: 'tok-1',
    oauth_config_id: 'cfg-1',
    access_token: 'cached-access',
    refresh_token: 'cached-refresh',
    token_type: 'Bearer',
    expires_at: Date.now() + 3_600_000,
    scope: 'read',
    created_at: Date.now(),
  }

  const configRow = {
    id: 'cfg-1',
    name: 'Test',
    grant_type: 'client_credentials',
    client_id: 'cid',
    client_secret: null,
    auth_url: null,
    token_url: 'http://will-be-overridden',
    scopes: 'read',
    redirect_uri: 'http://localhost/cb',
  }

  beforeEach(() => {
    mockQueryOne.mockReset()
    mockRunTransaction.mockReset()
  })

  it('returns null when no token row exists', async () => {
    mockQueryOne.mockReturnValueOnce(null)
    expect(await getValidToken('cfg-1')).toBeNull()
  })

  it('returns the cached token when it is not expired', async () => {
    mockQueryOne.mockReturnValueOnce(tokenRow)
    const token = await getValidToken('cfg-1')
    expect(token?.accessToken).toBe('cached-access')
  })

  it('returns null when token is expired and has no refresh token', async () => {
    mockQueryOne.mockReturnValueOnce({
      ...tokenRow,
      refresh_token: null,
      expires_at: Date.now() - 1000,
    })
    expect(await getValidToken('cfg-1')).toBeNull()
  })

  it('returns null when token is expired and no config row is found', async () => {
    mockQueryOne
      .mockReturnValueOnce({ ...tokenRow, expires_at: Date.now() - 1000 })
      .mockReturnValueOnce(null)
    expect(await getValidToken('cfg-1')).toBeNull()
  })

  it('propagates the refresh error instead of silently returning null', async () => {
    let idp: FakeIdp | undefined
    try {
      idp = await startFakeIdp({ error: 'invalid_grant', error_description: 'Refresh token expired' }, 400)
      mockQueryOne
        .mockReturnValueOnce({ ...tokenRow, expires_at: Date.now() - 1000 })
        .mockReturnValueOnce({ ...configRow, token_url: idp.tokenUrl })

      await expect(getValidToken('cfg-1')).rejects.toThrow('Refresh token expired')
    } finally {
      idp?.stop()
    }
  })

  it('returns the new token when refresh succeeds', async () => {
    let idp: FakeIdp | undefined
    try {
      idp = await startFakeIdp()
      mockQueryOne
        .mockReturnValueOnce({ ...tokenRow, expires_at: Date.now() - 1000 })
        .mockReturnValueOnce({ ...configRow, token_url: idp.tokenUrl })

      const token = await getValidToken('cfg-1')
      expect(token?.accessToken).toBe('test_access_token')
    } finally {
      idp?.stop()
    }
  })
})

// ─── getValidTokenForConfig ───────────────────────────────────────────────────

describe('getValidTokenForConfig', () => {
  const mockQueryOne = vi.mocked(queryOne)
  const mockRunTransaction = vi.mocked(runTransaction)

  const baseConfig: OAuthConfig = {
    id: 'inline-cfg',
    name: 'Inline',
    grantType: 'client_credentials',
    clientId: 'cid',
    tokenUrl: 'http://will-be-overridden',
    scopes: 'read',
    redirectUri: 'http://localhost/cb',
  }

  const tokenRow = {
    id: 'tok-2',
    oauth_config_id: 'hash-key',
    access_token: 'cached-inline',
    refresh_token: 'inline-refresh',
    token_type: 'Bearer',
    expires_at: Date.now() + 3_600_000,
    scope: 'read',
    created_at: Date.now(),
  }

  beforeEach(() => {
    mockQueryOne.mockReset()
    mockRunTransaction.mockReset()
  })

  it('returns null when no token row exists for the config hash', async () => {
    mockQueryOne.mockReturnValueOnce(null)
    expect(await getValidTokenForConfig(baseConfig)).toBeNull()
  })

  it('returns the cached token when it is not expired', async () => {
    mockQueryOne.mockReturnValueOnce(tokenRow)
    const token = await getValidTokenForConfig(baseConfig)
    expect(token?.accessToken).toBe('cached-inline')
  })

  it('returns null when token is expired and has no refresh token', async () => {
    mockQueryOne.mockReturnValueOnce({
      ...tokenRow,
      refresh_token: null,
      expires_at: Date.now() - 1000,
    })
    expect(await getValidTokenForConfig(baseConfig)).toBeNull()
  })

  it('propagates the refresh error instead of silently returning null', async () => {
    let idp: FakeIdp | undefined
    try {
      idp = await startFakeIdp({ error: 'invalid_grant', error_description: 'Token has been revoked' }, 400)
      mockQueryOne.mockReturnValueOnce({ ...tokenRow, expires_at: Date.now() - 1000 })

      await expect(
        getValidTokenForConfig({ ...baseConfig, tokenUrl: idp.tokenUrl }),
      ).rejects.toThrow('Token has been revoked')
    } finally {
      idp?.stop()
    }
  })

  it('returns the new token when refresh succeeds', async () => {
    let idp: FakeIdp | undefined
    try {
      idp = await startFakeIdp()
      mockQueryOne.mockReturnValueOnce({ ...tokenRow, expires_at: Date.now() - 1000 })

      const token = await getValidTokenForConfig({ ...baseConfig, tokenUrl: idp.tokenUrl })
      expect(token?.accessToken).toBe('test_access_token')
    } finally {
      idp?.stop()
    }
  })
})

// ─── saveToken (via clientCredentials) ───────────────────────────────────────

describe('saveToken — validation', () => {
  it('throws when the token endpoint response is missing access_token', async () => {
    let idp: FakeIdp | undefined
    try {
      idp = await startFakeIdp({ token_type: 'Bearer' }) // no access_token field
      const config = makeConfig({ tokenUrl: idp.tokenUrl })
      await expect(clientCredentials(config)).rejects.toThrow('access_token')
    } finally {
      idp?.stop()
    }
  })
})

// ─── postTokenRequest — error handling & features ────────────────────────────

describe('postTokenRequest — error handling', () => {
  it('throws a friendly error when the token URL is empty', async () => {
    await expect(clientCredentials(makeConfig({ tokenUrl: '' }))).rejects.toThrow('Invalid token URL')
  })

  it('throws a friendly error when the token URL is malformed', async () => {
    await expect(clientCredentials(makeConfig({ tokenUrl: 'not-a-url' }))).rejects.toThrow('Invalid token URL')
  })

  it('throws a friendly error when the token endpoint is unreachable (ECONNREFUSED)', async () => {
    // Port 1 is privileged/unusable — guaranteed connection refused
    await expect(
      clientCredentials(makeConfig({ tokenUrl: 'http://127.0.0.1:1/token' })),
    ).rejects.toThrow('Cannot connect to token endpoint')
  })

  it('throws a friendly error when the token hostname cannot be resolved (ENOTFOUND)', async () => {
    await expect(
      clientCredentials(makeConfig({ tokenUrl: 'http://this-host-does-not-exist.invalid/token' })),
    ).rejects.toThrow(/host not found|Cannot connect|Token request failed/)
  })

  it('appends extraParams to the token request body', async () => {
    let idp: FakeIdp | undefined
    try {
      idp = await startFakeIdp()
      const config = makeConfig({
        tokenUrl: idp.tokenUrl,
        grantType: 'client_credentials',
        extraParams: { audience: 'https://api.example.com', resource: 'my-resource' },
      })
      await clientCredentials(config)

      const body = Object.fromEntries(new URLSearchParams(idp.requests()[0]))
      expect(body['audience']).toBe('https://api.example.com')
      expect(body['resource']).toBe('my-resource')
    } finally {
      idp?.stop()
    }
  })
})

// ─── authorizeAuthCode — pre-flight validation ────────────────────────────────

describe('authorizeAuthCode — pre-flight validation', () => {
  it('throws a friendly error when authUrl is blank', async () => {
    await expect(
      authorizeAuthCode(makeConfig({ authUrl: '' })),
    ).rejects.toThrow('Auth URL')
  })

  it('throws a friendly error when authUrl is undefined', async () => {
    await expect(
      authorizeAuthCode(makeConfig({ authUrl: undefined })),
    ).rejects.toThrow('Auth URL')
  })
})

// ─── configHashKey — collision prevention ────────────────────────────────────

describe('configHashKey', () => {
  const base = { clientId: 'cid', tokenUrl: 'https://token', scopes: 'read', grantType: 'client_credentials', clientSecret: undefined }

  it('returns the same key for identical configs', () => {
    expect(configHashKey(base)).toBe(configHashKey(base))
  })

  it('returns different keys for different clientSecrets', () => {
    expect(configHashKey({ ...base, clientSecret: 'secret-a' }))
      .not.toBe(configHashKey({ ...base, clientSecret: 'secret-b' }))
  })

  it('returns different keys for different grantTypes', () => {
    expect(configHashKey({ ...base, grantType: 'client_credentials' }))
      .not.toBe(configHashKey({ ...base, grantType: 'authorization_code' }))
  })

  it('returns different keys when clientSecret is present vs absent', () => {
    expect(configHashKey({ ...base, clientSecret: 'secret' }))
      .not.toBe(configHashKey({ ...base, clientSecret: undefined }))
  })
})
