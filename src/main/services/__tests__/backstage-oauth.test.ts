/**
 * Backstage OAuth sign-in against a real local HTTP server that behaves like
 * Backstage's auth-backend OAuth server (CIMD client, PKCE S256, rotating
 * refresh tokens), plus the pure helpers.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'http'
import crypto from 'crypto'
import axios from 'axios'
import type { AddressInfo } from 'net'
import {
  POSTLY_OAUTH_CLIENT_ID, OAUTH_CALLBACK_PATH, OAUTH_SCOPE,
  generatePkce, pkceChallenge, generateState, discoveryUrls, parseAuthorizationServerMetadata,
  discoverAuthorizationServer, buildAuthorizationUrl, startLoopbackCallback, parseTokenResponse,
  refreshAccessToken, revokeToken, userFromAccessToken,
  signInWithBackstageOAuth, isUnauthorizedError,
} from '../backstage-oauth'

const fakeJwt = (claims: Record<string, unknown>) =>
  `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`

// ─── Fake Backstage auth backend ─────────────────────────────────────────────

interface Session { redirectUri: string; challenge: string; state: string; scope: string }

let server: http.Server
let base = ''
const fake = {
  /** Which discovery location answers: 'root' | 'auth-oidc' | 'none' | 'spa'. */
  discovery: 'auth-oidc' as 'root' | 'auth-oidc' | 'none' | 'spa',
  sessions: new Map<string, Session>(),
  refreshTokens: new Set<string>(),
  tokenRequests: [] as Record<string, string>[],
  revoked: [] as Record<string, string>[],
}

function metadata() {
  return {
    issuer: `${base}/api/auth`,
    authorization_endpoint: `${base}/api/auth/v1/authorize`,
    token_endpoint: `${base}/api/auth/v1/token`,
    revocation_endpoint: `${base}/api/auth/v1/revoke`,
    code_challenge_methods_supported: ['S256', 'plain'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    client_id_metadata_document_supported: true,
  }
}

function readBody(req: http.IncomingMessage): Promise<Record<string, string>> {
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (c) => { raw += c })
    req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(raw))))
  })
}

const json = (res: http.ServerResponse, status: number, body: unknown) =>
  res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))

function issueTokens(rotate = true) {
  const refresh = crypto.randomBytes(8).toString('hex')
  if (rotate) fake.refreshTokens.add(refresh)
  return {
    access_token: fakeJwt({ sub: 'user:default/jane.doe', exp: Math.floor(Date.now() / 1000) + 3600 }),
    token_type: 'Bearer',
    expires_in: 3600,
    ...(rotate && { refresh_token: refresh }),
  }
}

beforeAll(async () => {
  server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', base)
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      if (fake.discovery === 'root') return json(res, 200, metadata())
      if (fake.discovery === 'spa') return res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html>app</html>')
      return json(res, 404, { error: 'not found' })
    }
    if (url.pathname === '/api/auth/.well-known/openid-configuration' && fake.discovery === 'auth-oidc') return json(res, 200, metadata())
    if (url.pathname === '/api/auth/v1/authorize') {
      // Mirrors Backstage: CIMD client, PKCE required, loopback redirect; then "user approves".
      const q = url.searchParams
      if (q.get('client_id') !== POSTLY_OAUTH_CLIENT_ID) return json(res, 400, { error: 'invalid_client' })
      if (q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge')) return json(res, 400, { error: 'invalid_request' })
      const code = crypto.randomBytes(8).toString('hex')
      fake.sessions.set(code, { redirectUri: q.get('redirect_uri') ?? '', challenge: q.get('code_challenge') ?? '', state: q.get('state') ?? '', scope: q.get('scope') ?? '' })
      const redirect = new URL(q.get('redirect_uri') ?? '')
      redirect.searchParams.set('code', code)
      redirect.searchParams.set('state', q.get('state') ?? '')
      return res.writeHead(302, { Location: redirect.toString() }).end()
    }
    if (url.pathname === '/api/auth/v1/token' && req.method === 'POST') {
      const body = await readBody(req)
      fake.tokenRequests.push(body)
      if (body.grant_type === 'authorization_code') {
        const s = fake.sessions.get(body.code)
        fake.sessions.delete(body.code)
        if (!s || s.redirectUri !== body.redirect_uri) return json(res, 400, { error: 'invalid_grant', error_description: 'Redirect URI mismatch' })
        if (crypto.createHash('sha256').update(body.code_verifier ?? '').digest('base64url') !== s.challenge) {
          return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid code verifier' })
        }
        return json(res, 200, issueTokens(s.scope.split(' ').includes('offline_access')))
      }
      if (body.grant_type === 'refresh_token') {
        if (!fake.refreshTokens.delete(body.refresh_token)) return json(res, 400, { error: 'invalid_grant', error_description: 'Invalid refresh token' })
        return json(res, 200, issueTokens())
      }
      return json(res, 400, { error: 'unsupported_grant_type' })
    }
    if (url.pathname === '/api/auth/v1/revoke' && req.method === 'POST') {
      fake.revoked.push(await readBody(req))
      return res.writeHead(200).end()
    }
    return json(res, 404, { error: 'not found' })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((r) => server.close(() => r())))

beforeEach(() => {
  fake.discovery = 'auth-oidc'
  fake.sessions.clear()
  fake.refreshTokens.clear()
  fake.tokenRequests = []
  fake.revoked = []
})

/** Plays the browser: follows the authorize redirect to the loopback callback. */
async function browser(authorizeUrl: string, mutate?: (callback: URL) => void): Promise<number> {
  const res = await axios.get(authorizeUrl, { maxRedirects: 0, validateStatus: () => true })
  const callback = new URL(res.headers.location as string)
  mutate?.(callback)
  return (await axios.get(callback.toString(), { validateStatus: () => true })).status
}

// ─── PKCE / state ────────────────────────────────────────────────────────────

describe('PKCE and state', () => {
  it('generates an RFC 7636 verifier and its S256 challenge', () => {
    const { verifier, challenge } = generatePkce()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
    expect(challenge).toBe(crypto.createHash('sha256').update(verifier).digest('base64url'))
    expect(challenge).not.toContain('=')
    expect(pkceChallenge(verifier)).toBe(challenge)
  })

  it('never repeats verifiers or states', () => {
    const verifiers = new Set(Array.from({ length: 50 }, () => generatePkce().verifier))
    const states = new Set(Array.from({ length: 50 }, generateState))
    expect(verifiers.size).toBe(50)
    expect(states.size).toBe(50)
    for (const s of states) expect(s).toMatch(/^[A-Za-z0-9_-]{32}$/)
  })
})

// ─── Discovery ───────────────────────────────────────────────────────────────

describe('authorization server discovery', () => {
  it('tries RFC 8414 at the root, under the auth backend, then the OpenID configuration', () => {
    expect(discoveryUrls('https://hub.dever.dk/')).toEqual([
      'https://hub.dever.dk/.well-known/oauth-authorization-server',
      'https://hub.dever.dk/api/auth/.well-known/oauth-authorization-server',
      'https://hub.dever.dk/api/auth/.well-known/openid-configuration',
    ])
  })

  it('finds the auth backend OpenID configuration when the root document is missing', async () => {
    const meta = await discoverAuthorizationServer(base)
    expect(meta.authorization_endpoint).toBe(`${base}/api/auth/v1/authorize`)
    expect(meta.token_endpoint).toBe(`${base}/api/auth/v1/token`)
    expect(meta.revocation_endpoint).toBe(`${base}/api/auth/v1/revoke`)
  })

  it('uses the root RFC 8414 document when present', async () => {
    fake.discovery = 'root'
    expect((await discoverAuthorizationServer(`${base}/`)).token_endpoint).toBe(`${base}/api/auth/v1/token`)
  })

  it('skips an SPA that answers every path with HTML and fails with a helpful error', async () => {
    fake.discovery = 'spa'
    await expect(discoverAuthorizationServer(base)).rejects.toThrow(/does not advertise an OAuth authorization server/)
  })

  it('rejects metadata without S256 PKCE, without endpoints, or downgrading https to http', () => {
    const ok = { authorization_endpoint: 'https://b.example/a', token_endpoint: 'https://b.example/t' }
    expect(parseAuthorizationServerMetadata(ok, 'https://b.example')).toMatchObject(ok)
    expect(parseAuthorizationServerMetadata({ ...ok, code_challenge_methods_supported: ['plain'] }, 'https://b.example')).toBeNull()
    expect(parseAuthorizationServerMetadata({ token_endpoint: ok.token_endpoint }, 'https://b.example')).toBeNull()
    expect(parseAuthorizationServerMetadata({ ...ok, token_endpoint: 'http://b.example/t' }, 'https://b.example')).toBeNull()
    expect(parseAuthorizationServerMetadata({ ...ok, authorization_endpoint: 'javascript:alert(1)' }, 'https://b.example')).toBeNull()
    expect(parseAuthorizationServerMetadata('<html>', 'https://b.example')).toBeNull()
  })

  it('refuses non-http(s) base URLs', async () => {
    await expect(discoverAuthorizationServer('file:///etc')).rejects.toThrow(/http/)
  })
})

// ─── Authorization request ───────────────────────────────────────────────────

describe('buildAuthorizationUrl', () => {
  it('sends the CIMD client id, loopback redirect, PKCE S256, state and offline_access', () => {
    const url = new URL(buildAuthorizationUrl(
      { authorization_endpoint: 'https://b.example/api/auth/v1/authorize', token_endpoint: 'https://b.example/t' },
      { clientId: POSTLY_OAUTH_CLIENT_ID, redirectUri: 'http://127.0.0.1:5000/callback', state: 'st', codeChallenge: 'ch' },
    ))
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'https://raw.githubusercontent.com/dever-labs/postly/main/oauth/client.json',
      redirect_uri: 'http://127.0.0.1:5000/callback',
      scope: 'openid offline_access',
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
    })
    expect(OAUTH_SCOPE).toContain('offline_access')
  })
})

// ─── Loopback callback ───────────────────────────────────────────────────────

describe('startLoopbackCallback', () => {
  it('listens on 127.0.0.1 with an ephemeral port and resolves the code when state matches', async () => {
    const cb = await startLoopbackCallback('the-state')
    expect(cb.redirectUri).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:\\d+${OAUTH_CALLBACK_PATH}$`))
    const res = await axios.get(`${cb.redirectUri}?code=abc&state=the-state`, { validateStatus: () => true })
    expect(res.status).toBe(200)
    await expect(cb.code).resolves.toBe('abc')
  })

  it('rejects a callback whose state does not match', async () => {
    const cb = await startLoopbackCallback('expected')
    const res = await axios.get(`${cb.redirectUri}?code=abc&state=forged`, { validateStatus: () => true })
    expect(res.status).toBe(400)
    await expect(cb.code).rejects.toThrow(/state mismatch/)
  })

  it('rejects a callback without state', async () => {
    const cb = await startLoopbackCallback('expected')
    await axios.get(`${cb.redirectUri}?code=abc`, { validateStatus: () => true })
    await expect(cb.code).rejects.toThrow(/state mismatch/)
  })

  it('surfaces an authorization error from the server (e.g. the user denied)', async () => {
    const cb = await startLoopbackCallback('s')
    await axios.get(`${cb.redirectUri}?error=access_denied&error_description=User%20denied&state=s`, { validateStatus: () => true })
    await expect(cb.code).rejects.toThrow(/access_denied — User denied/)
  })

  it('ignores other paths (favicon etc.) and stops after the first callback', async () => {
    const cb = await startLoopbackCallback('s')
    expect((await axios.get(cb.redirectUri.replace('/callback', '/favicon.ico'), { validateStatus: () => true })).status).toBe(404)
    await axios.get(`${cb.redirectUri}?code=one&state=s`, { validateStatus: () => true })
    await expect(cb.code).resolves.toBe('one')
    await expect(axios.get(`${cb.redirectUri}?code=two&state=s`, { timeout: 1000 })).rejects.toBeDefined()
  })

  it('times out and can be cancelled', async () => {
    const slow = await startLoopbackCallback('s', 20)
    await expect(slow.code).rejects.toThrow(/timed out/)
    const cancelled = await startLoopbackCallback('s')
    cancelled.close()
    await expect(cancelled.code).rejects.toThrow(/cancelled/)
  })
})

// ─── Token endpoint ──────────────────────────────────────────────────────────

describe('token responses', () => {
  it('computes expiry from expires_in, falling back to the JWT exp', () => {
    expect(parseTokenResponse({ access_token: 'a', expires_in: 60 }, 1000).expiresAt).toBe(61_000)
    expect(parseTokenResponse({ access_token: fakeJwt({ exp: 2000 }) }).expiresAt).toBe(2_000_000)
    expect(parseTokenResponse({ access_token: 'opaque' }).expiresAt).toBe(0)
  })

  it('rejects responses without an access token or with a non-bearer type', () => {
    expect(() => parseTokenResponse({})).toThrow(/access token/)
    expect(() => parseTokenResponse({ access_token: 'a', token_type: 'mac' })).toThrow(/token type/)
  })

  it('reads the user from the Backstage token subject', () => {
    expect(userFromAccessToken(fakeJwt({ sub: 'user:default/jane.doe' }))).toEqual({ name: 'jane.doe', entityRef: 'user:default/jane.doe' })
    expect(userFromAccessToken('opaque').name).toBe('Backstage user')
  })

  it('detects 401s', () => {
    expect(isUnauthorizedError({ response: { status: 401 } })).toBe(true)
    expect(isUnauthorizedError({ response: { status: 403 } })).toBe(false)
    expect(isUnauthorizedError(new Error('x'))).toBe(false)
  })
})

describe('token refresh', () => {
  it('exchanges a refresh token as a public client and keeps the rotated one', async () => {
    const meta = await discoverAuthorizationServer(base)
    fake.refreshTokens.add('r1')
    const tokens = await refreshAccessToken(meta, 'r1')
    expect(fake.tokenRequests.at(-1)).toEqual({ grant_type: 'refresh_token', refresh_token: 'r1', client_id: POSTLY_OAUTH_CLIENT_ID })
    expect(tokens.refreshToken).toBeTruthy()
    expect(tokens.refreshToken).not.toBe('r1')
    expect(tokens.expiresAt).toBeGreaterThan(Date.now())
    // The old refresh token was rotated out.
    await expect(refreshAccessToken(meta, 'r1')).rejects.toMatchObject({ message: /invalid_grant: Invalid refresh token/, oauthError: 'invalid_grant' })
  })

  it('keeps the current refresh token when the server does not rotate', async () => {
    const srv = http.createServer((_req, res) => json(res, 200, { access_token: 'new', token_type: 'Bearer', expires_in: 10 }))
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/token`
    try {
      const tokens = await refreshAccessToken({ authorization_endpoint: url, token_endpoint: url }, 'keep-me')
      expect(tokens).toMatchObject({ accessToken: 'new', refreshToken: 'keep-me' })
    } finally { srv.close() }
  })

  it('revokes refresh tokens on sign-out', async () => {
    const meta = await discoverAuthorizationServer(base)
    await revokeToken(meta, 'r9')
    expect(fake.revoked).toEqual([{ token: 'r9', token_type_hint: 'refresh_token', client_id: POSTLY_OAUTH_CLIENT_ID }])
  })
})

// ─── Whole flow ──────────────────────────────────────────────────────────────

describe('signInWithBackstageOAuth', () => {
  it('runs discovery → browser → loopback → code exchange with PKCE', async () => {
    let opened = ''
    const result = await signInWithBackstageOAuth(base, {
      openExternal: async (url) => { opened = url; await browser(url) },
    })
    expect(new URL(opened).origin + new URL(opened).pathname).toBe(`${base}/api/auth/v1/authorize`)
    expect(result.user).toEqual({ name: 'jane.doe', entityRef: 'user:default/jane.doe' })
    expect(result.tokens.accessToken).toBeTruthy()
    expect(result.tokens.refreshToken).toBeTruthy()
    const exchange = fake.tokenRequests.find((r) => r.grant_type === 'authorization_code')
    expect(exchange).toMatchObject({ client_id: POSTLY_OAUTH_CLIENT_ID, redirect_uri: new URL(opened).searchParams.get('redirect_uri') })
    expect(exchange?.code_verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('fails when the callback state was tampered with, without exchanging the code', async () => {
    await expect(signInWithBackstageOAuth(base, {
      openExternal: async (url) => { await browser(url, (cb) => cb.searchParams.set('state', 'forged')) },
    })).rejects.toThrow(/state mismatch/)
    expect(fake.tokenRequests).toHaveLength(0)
  })
})
