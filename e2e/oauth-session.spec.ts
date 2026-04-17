/**
 * OAuth session persistence E2E tests
 *
 * Verifies that the browser session (cookies, IDP state) used during an OAuth
 * authorization_code flow is preserved between auth attempts so the user is not
 * re-prompted to log in every time a token needs refreshing.
 *
 * Architecture:
 *  - Mockly handles the token endpoint (POST /oauth2/token) — real HTTP server,
 *    call counts, scenario support.
 *  - A minimal inline Node.js server handles the authorization endpoint. It
 *    echoes back the `state` query param and sets an IDP session cookie, which
 *    is what we need to test persistence. Mockly can't do this because it has
 *    no query-param template syntax.
 *
 * Requires a built app (`npm run build` before `npm run test:e2e`).
 * The Mockly binary is downloaded automatically by `npm run test:e2e`
 * via `node scripts/download-mockly.mjs`.  If the binary is missing when
 * tests run directly with `playwright test`, all tests in this file are
 * skipped with a descriptive message.
 */
import { test, expect } from './fixtures'
import http from 'http'
import { existsSync } from 'fs'
import { resolve } from 'path'
import type { AddressInfo } from 'net'
import { MocklyServer } from '../src/main/services/__tests__/helpers/mockly'

// ─── Binary guard ─────────────────────────────────────────────────────────────
// Skip the entire suite with a clear message when the Mockly binary is absent.
// In normal usage `npm run test:e2e` downloads it automatically via
// `node scripts/download-mockly.mjs` before Playwright runs.

const binName = process.platform === 'win32' ? 'mockly.exe' : 'mockly'
const mocklyBinPath = resolve(__dirname, '..', 'bin', binName)
const mocklyAvailable = existsSync(mocklyBinPath)

// ─── Auth server ─────────────────────────────────────────────────────────────

interface AuthServer {
  /** Full URL of the /authorize endpoint. */
  url: string
  /** Origin (scheme + host + port) — used to scope cookie lookups. */
  origin: string
  stop: () => void
}

/**
 * Starts a minimal HTTP server that acts as an IDP authorization endpoint.
 * On every GET it:
 *  1. Reads `redirect_uri` and `state` from the query params.
 *  2. Sets an `idp-session` cookie (simulating the IDP creating a server-side session).
 *  3. Responds with 302 → redirect_uri?code=e2e-auth-code&state=<original-state>.
 *
 * Mockly handles everything else (token endpoint); this server exists solely
 * because Mockly has no query-param template to echo `state` back in a redirect.
 */
function startAuthServer(): Promise<AuthServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url!, 'http://127.0.0.1')
        const redirectUri = url.searchParams.get('redirect_uri') ?? ''
        const state      = url.searchParams.get('state') ?? ''
        const callback   = new URL(redirectUri)
        callback.searchParams.set('code', 'e2e-auth-code')
        callback.searchParams.set('state', state)
        res.writeHead(302, {
          Location:   callback.toString(),
          // Cookie that simulates the IDP maintaining a server-side session.
          // This is what must survive across auth attempts with the persist: partition fix.
          'Set-Cookie': 'idp-session=active; Path=/',
        })
      } catch {
        res.writeHead(500)
      }
      res.end()
    })

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        url:    `http://127.0.0.1:${port}/authorize`,
        origin: `http://127.0.0.1:${port}`,
        stop:   () => server.close(),
      })
    })
  })
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let mockly:     MocklyServer
let authServer: AuthServer

const REDIRECT_URI = 'http://localhost:19999/callback'
const MOCK_TOKEN_ID = 'oauth2-token'

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('OAuth session persistence', () => {
  test.beforeEach(() => {
    test.skip(
      !mocklyAvailable,
      `Mockly binary not found at bin/${binName} — run: node scripts/download-mockly.mjs`,
    )
  })

  test.beforeAll(async () => {
    // Start Mockly for the token endpoint.
    mockly = await MocklyServer.create()
    await mockly.addMock({
      id: MOCK_TOKEN_ID,
      request: { method: 'POST', path: '/oauth2/token' },
      response: {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token:  'e2e-access-token',
          token_type:    'Bearer',
          expires_in:    3600,
          refresh_token: 'e2e-refresh-token',
          scope:         'read',
        }),
      },
    })

    authServer = await startAuthServer()
  })

  test.afterAll(async () => {
    authServer.stop()
    await mockly.stop()
  })

  // Reset Mockly call counters and clear test partitions before each test so
  // counts and cookies from a previous test don't carry over.
  test.beforeEach(async ({ electronApp }) => {
    await fetch(`${mockly.apiBase}/api/calls/http/${MOCK_TOKEN_ID}`, { method: 'DELETE' })
    await electronApp.evaluate(async ({ session }) => {
      // Clear any leftover cookies from the e2e test partitions.
      const prefixes = ['persist:oauth-e2e-', 'persist:oauth-ssl-disabled-e2e-']
      const allSessions = [
        'persist:oauth-e2e-ssl-a',
        'persist:oauth-e2e-ssl-b',
        'persist:oauth-e2e-config-a',
        'persist:oauth-e2e-config-b',
      ]
      await Promise.all(allSessions.map((p) => session.fromPartition(p).clearStorageData()))
      void prefixes // referenced to avoid TS unused-var warning
    })
  })

  // ── Full flow ────────────────────────────────────────────────────────────

  test('completes the authorization_code flow end-to-end via Mockly IDP', async ({ window }) => {
    const configId = await window.evaluate(
      async (args: { name: string; grantType: string; clientId: string; tokenUrl: string; authUrl: string; redirectUri: string; scopes: string }) => {
        const res = await window.api.oauth.configs.create(args)
        return (res as { data: { id: string } }).data.id
      },
      {
        name: 'E2E Full Flow', grantType: 'authorization_code', clientId: 'e2e-client',
        tokenUrl: `${mockly.httpBase}/oauth2/token`, authUrl: authServer.url,
        redirectUri: REDIRECT_URI, scopes: 'read',
      }
    )

    const result = await window.evaluate(async (id: string) => {
      return window.api.oauth.authorize({ configId: id })
    }, configId)

    expect((result as { data: { accessToken: string; tokenType: string } }).data.accessToken).toBe('e2e-access-token')
    expect((result as { data: { accessToken: string; tokenType: string } }).data.tokenType).toBe('Bearer')

    // Confirm Mockly received exactly one token exchange.
    const calls = await fetch(`${mockly.apiBase}/api/calls/http/${MOCK_TOKEN_ID}`).then((r) => r.json())
    expect(calls.count).toBe(1)

    await window.evaluate(async (id: string) => { await window.api.oauth.configs.delete({ id }) }, configId)
  })

  // ── Session persistence ───────────────────────────────────────────────────

  test('IDP session cookie set during first auth is present before second auth', async ({ window, electronApp }) => {
    // The auth server sets `idp-session=active` on every authorize redirect.
    // After auth #1 the cookie must be in the persist: partition.
    // After auth #2 it must still be there — proving the session was reused,
    // not discarded.  Before the fix each auth got a fresh ephemeral session
    // and the cookie was lost.

    const configId = await window.evaluate(
      async (args: { name: string; grantType: string; clientId: string; tokenUrl: string; authUrl: string; redirectUri: string; scopes: string }) => {
        const res = await window.api.oauth.configs.create(args)
        return (res as { data: { id: string } }).data.id
      },
      {
        name: 'E2E Persistence', grantType: 'authorization_code', clientId: 'e2e-client',
        tokenUrl: `${mockly.httpBase}/oauth2/token`, authUrl: authServer.url,
        redirectUri: REDIRECT_URI, scopes: 'read',
      }
    )

    // Auth attempt #1.
    await window.evaluate(async (id: string) => { await window.api.oauth.authorize({ configId: id }) }, configId)

    // Cookie must be in the session partition after the first auth.
    const cookiesAfterFirst = await electronApp.evaluate(
      async ({ session }, id: string) => session.fromPartition(`persist:oauth-${id}`).cookies.get({ name: 'idp-session' }),
      configId
    )
    expect(cookiesAfterFirst).toHaveLength(1)
    expect(cookiesAfterFirst[0].value).toBe('active')

    // Auth attempt #2 — reuses the same partition.
    await window.evaluate(async (id: string) => { await window.api.oauth.authorize({ configId: id }) }, configId)

    // Cookie must still be present — not wiped by the second auth.
    const cookiesAfterSecond = await electronApp.evaluate(
      async ({ session }, id: string) => session.fromPartition(`persist:oauth-${id}`).cookies.get({ name: 'idp-session' }),
      configId
    )
    expect(cookiesAfterSecond).toHaveLength(1)
    expect(cookiesAfterSecond[0].value).toBe('active')

    // Token endpoint was called twice — once per auth attempt.
    const calls = await fetch(`${mockly.apiBase}/api/calls/http/${MOCK_TOKEN_ID}`).then((r) => r.json())
    expect(calls.count).toBe(2)

    await window.evaluate(async (id: string) => {
      await window.api.oauth.clearToken({ configId: id })
      await window.api.oauth.configs.delete({ id })
    }, configId)
  })

  // ── Mockly scenarios ─────────────────────────────────────────────────────

  test('surfaces the provider error when the token endpoint returns 503', async ({ window }) => {
    // Register a separate mock for the "down" path so it does not interfere with
    // the main oauth2-token mock used by other tests.
    await mockly.addMock({
      id: 'oauth2-token-down',
      request: { method: 'POST', path: '/oauth2/token-down' },
      response: {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'temporarily_unavailable', error_description: 'Auth server down' }),
      },
    })

    const configId = await window.evaluate(
      async (args: { name: string; grantType: string; clientId: string; tokenUrl: string; authUrl: string; redirectUri: string; scopes: string }) => {
        const res = await window.api.oauth.configs.create(args)
        return (res as { data: { id: string } }).data.id
      },
      {
        name: 'E2E Error Test', grantType: 'authorization_code', clientId: 'e2e-client',
        tokenUrl: `${mockly.httpBase}/oauth2/token-down`, authUrl: authServer.url,
        redirectUri: REDIRECT_URI, scopes: 'read',
      }
    )

    const result = await window.evaluate(async (id: string) => {
      return window.api.oauth.authorize({ configId: id })
    }, configId)

    expect((result as { error: string }).error).toContain('503')

    await mockly.deleteMock('oauth2-token-down')
    await window.evaluate(async (id: string) => { await window.api.oauth.configs.delete({ id }) }, configId)
  })

  // ── Session isolation ─────────────────────────────────────────────────────

  test('SSL-disabled config session is isolated from the SSL-enabled session', async ({ electronApp }) => {
    const id = 'e2e-ssl-a'
    const { enabledCookies, disabledCookies } = await electronApp.evaluate(
      async ({ session }, id: string) => {
        await session.fromPartition(`persist:oauth-${id}`).cookies.set({
          url: 'https://idp.example.com', name: 'sid', value: 'ssl-on',
        })
        return {
          enabledCookies:  await session.fromPartition(`persist:oauth-${id}`).cookies.get({ name: 'sid' }),
          disabledCookies: await session.fromPartition(`persist:oauth-ssl-disabled-${id}`).cookies.get({ name: 'sid' }),
        }
      },
      id
    )

    expect(enabledCookies).toHaveLength(1)
    expect(disabledCookies).toHaveLength(0)
  })

  test('different OAuth configs have completely isolated sessions', async ({ electronApp }) => {
    const { cookiesA, cookiesB } = await electronApp.evaluate(async ({ session }) => {
      await session.fromPartition('persist:oauth-e2e-config-a').cookies.set({
        url: 'https://idp.example.com', name: 'sid', value: 'config-a',
      })
      return {
        cookiesA: await session.fromPartition('persist:oauth-e2e-config-a').cookies.get({ name: 'sid' }),
        cookiesB: await session.fromPartition('persist:oauth-e2e-config-b').cookies.get({ name: 'sid' }),
      }
    })

    expect(cookiesA).toHaveLength(1)
    expect(cookiesA[0].value).toBe('config-a')
    expect(cookiesB).toHaveLength(0)
  })
})
