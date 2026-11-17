/**
 * "Sign in with OAuth" for Backstage: authorization code + PKCE against
 * Backstage's own OAuth 2.0 authorization server (auth-backend), with Postly
 * identified by a Client ID Metadata Document (CIMD,
 * draft-ietf-oauth-client-id-metadata-document) instead of a registered client.
 *
 * The browser part runs in the user's system browser (RFC 8252 native-app
 * flow); the authorization code comes back to a one-shot loopback server on
 * 127.0.0.1 with an ephemeral port. Backstage matches loopback redirect URIs
 * on scheme, host and path and ignores the port, so the metadata document
 * lists `http://127.0.0.1/callback` and any free port works.
 */
import http from 'http'
import https from 'https'
import crypto from 'crypto'
import axios, { type AxiosError } from 'axios'

/** Postly's client_id: the HTTPS URL of its metadata document (oauth/client.json in this repo). */
export const POSTLY_OAUTH_CLIENT_ID = 'https://raw.githubusercontent.com/dever-labs/postly/main/oauth/client.json'
export const OAUTH_CALLBACK_PATH = '/callback'
/** `offline_access` makes Backstage issue a refresh token (when refresh tokens are enabled). */
export const OAUTH_SCOPE = 'openid offline_access'
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000

export interface AuthorizationServerMetadata {
  issuer?: string
  authorization_endpoint: string
  token_endpoint: string
  revocation_endpoint?: string
  code_challenge_methods_supported?: string[]
  client_id_metadata_document_supported?: boolean
}

export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  /** Epoch ms; 0 when unknown. */
  expiresAt: number
}

export interface OAuthUser {
  name: string
  /** Backstage user entity ref (JWT `sub`), e.g. `user:default/jane`. */
  entityRef?: string
}

interface RequestOptions {
  sslVerification?: boolean
}

function agentFor(options: RequestOptions): https.Agent | undefined {
  return options.sslVerification === false
    ? new https.Agent({ rejectUnauthorized: false }) // codeql[js/disabling-certificate-validation] -- intentional: user-controlled setting (Skip SSL verification toggle)
    : undefined
}

// ─── PKCE / state ─────────────────────────────────────────────────────────────

/** RFC 7636 code verifier (43 chars of base64url) and its S256 challenge. */
export function generatePkce(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString('base64url')
  return { verifier, challenge: pkceChallenge(verifier) }
}

export function pkceChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

export function generateState(): string {
  return crypto.randomBytes(24).toString('base64url')
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}

// ─── Discovery ────────────────────────────────────────────────────────────────

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

/**
 * Where to look for the authorization server metadata, in order:
 * RFC 8414 at the root (Backstage's MCP actions plugin serves it there),
 * the same document under the auth backend, then the auth backend's OpenID
 * configuration, which every Backstage with the OAuth server enabled serves.
 */
export function discoveryUrls(baseUrl: string): string[] {
  const base = normalizeBaseUrl(baseUrl)
  return [
    `${base}/.well-known/oauth-authorization-server`,
    `${base}/api/auth/.well-known/oauth-authorization-server`,
    `${base}/api/auth/.well-known/openid-configuration`,
  ]
}

function isEndpointAllowed(raw: unknown, base: URL): raw is string {
  if (typeof raw !== 'string') return false
  try {
    const url = new URL(raw)
    if (url.username || url.password) return false
    // Plain http is only acceptable when the Backstage instance itself is plain http (local dev).
    return url.protocol === 'https:' || (url.protocol === 'http:' && base.protocol === 'http:')
  } catch {
    return false
  }
}

/** Validates a metadata document; returns null when it is not usable for this flow. */
export function parseAuthorizationServerMetadata(doc: unknown, baseUrl: string): AuthorizationServerMetadata | null {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null
  const d = doc as Record<string, unknown>
  const base = new URL(normalizeBaseUrl(baseUrl))
  if (!isEndpointAllowed(d.authorization_endpoint, base) || !isEndpointAllowed(d.token_endpoint, base)) return null
  const methods = Array.isArray(d.code_challenge_methods_supported)
    ? d.code_challenge_methods_supported.filter((m): m is string => typeof m === 'string')
    : undefined
  if (methods && !methods.includes('S256')) return null
  return {
    issuer: typeof d.issuer === 'string' ? d.issuer : undefined,
    authorization_endpoint: d.authorization_endpoint,
    token_endpoint: d.token_endpoint,
    revocation_endpoint: isEndpointAllowed(d.revocation_endpoint, base) ? d.revocation_endpoint : undefined,
    code_challenge_methods_supported: methods,
    client_id_metadata_document_supported: d.client_id_metadata_document_supported === true,
  }
}

export async function discoverAuthorizationServer(baseUrl: string, options: RequestOptions = {}): Promise<AuthorizationServerMetadata> {
  const parsed = new URL(normalizeBaseUrl(baseUrl))
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Backstage base URL must use http:// or https://')
  const httpsAgent = agentFor(options)
  for (const url of discoveryUrls(baseUrl)) {
    try {
      const res = await axios.get(url, { headers: { Accept: 'application/json' }, httpsAgent, timeout: 15_000, maxRedirects: 0 })
      const meta = parseAuthorizationServerMetadata(res.data, baseUrl)
      if (meta) return meta
    } catch { /* try the next location */ }
  }
  throw new Error(
    `${normalizeBaseUrl(baseUrl)} does not advertise an OAuth authorization server. ` +
    'Enable auth.clientIdMetadataDocuments in its app-config and allow Postly\'s client ID (see docs/integrations.md).'
  )
}

// ─── Authorization request ────────────────────────────────────────────────────

export function buildAuthorizationUrl(meta: AuthorizationServerMetadata, args: {
  clientId: string; redirectUri: string; state: string; codeChallenge: string; scope?: string
}): string {
  const url = new URL(meta.authorization_endpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', args.clientId)
  url.searchParams.set('redirect_uri', args.redirectUri)
  url.searchParams.set('scope', args.scope ?? OAUTH_SCOPE)
  url.searchParams.set('state', args.state)
  url.searchParams.set('code_challenge', args.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

// ─── Loopback callback ────────────────────────────────────────────────────────

const PAGE = (title: string, detail: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Postly</title></head>` +
  `<body style="font-family:system-ui,sans-serif;padding:3rem;text-align:center">` +
  `<h2>${title}</h2><p>${detail}</p></body></html>`

export interface LoopbackCallback {
  redirectUri: string
  /** Resolves with the authorization code; rejects on error, state mismatch, timeout or close(). */
  code: Promise<string>
  close: () => void
}

/**
 * Starts a one-shot HTTP server on 127.0.0.1 (ephemeral port) that accepts a
 * single redirect to {@link OAUTH_CALLBACK_PATH}. A callback whose `state`
 * does not match is refused and fails the sign-in.
 */
export async function startLoopbackCallback(expectedState: string, timeoutMs = SIGN_IN_TIMEOUT_MS): Promise<LoopbackCallback> {
  let resolveCode!: (code: string) => void
  let rejectCode!: (err: Error) => void
  const code = new Promise<string>((resolve, reject) => { resolveCode = resolve; rejectCode = reject })
  // Callers may close() before awaiting; never leave an unhandled rejection behind.
  code.catch(() => {})

  let settled = false
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (req.method !== 'GET' || url.pathname !== OAUTH_CALLBACK_PATH || settled) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
      return
    }
    const state = url.searchParams.get('state') ?? ''
    const error = url.searchParams.get('error')
    const authCode = url.searchParams.get('code')
    const send = (status: number, title: string, detail: string) => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(PAGE(title, detail))
    }
    if (!safeEqual(state, expectedState)) {
      send(400, 'Sign-in failed', 'The response did not match the sign-in Postly started. Try again from Postly.')
      finish(() => rejectCode(new Error('OAuth state mismatch — the sign-in response was not for this request')))
    } else if (error) {
      const description = url.searchParams.get('error_description')
      send(400, 'Sign-in was not completed', 'You can close this tab and return to Postly.')
      finish(() => rejectCode(new Error(`Authorization failed: ${error}${description ? ` — ${description}` : ''}`)))
    } else if (!authCode) {
      send(400, 'Sign-in failed', 'No authorization code was returned.')
      finish(() => rejectCode(new Error('No authorization code in the callback')))
    } else {
      send(200, 'Signed in to Postly', 'You can close this tab and return to Postly.')
      finish(() => resolveCode(authCode))
    }
  })

  const timer = setTimeout(() => finish(() => rejectCode(new Error('Sign-in timed out'))), timeoutMs)
  function finish(fn: () => void) {
    if (settled) return
    settled = true
    clearTimeout(timer)
    server.close()
    fn()
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  server.on('error', (err) => finish(() => rejectCode(err)))
  const { port } = server.address() as { port: number }

  return {
    redirectUri: `http://127.0.0.1:${port}${OAUTH_CALLBACK_PATH}`,
    code,
    close: () => finish(() => rejectCode(new Error('Sign-in cancelled'))),
  }
}

// ─── Token endpoint ───────────────────────────────────────────────────────────

/** Reads `exp` from a JWT without verifying it (Backstage verifies; this only schedules refresh). */
function jwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1]
  if (!part) return null
  try {
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as unknown
    return payload && typeof payload === 'object' ? payload as Record<string, unknown> : null
  } catch {
    return null
  }
}

export function parseTokenResponse(data: unknown, now = Date.now()): OAuthTokens {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const accessToken = typeof d.access_token === 'string' ? d.access_token : ''
  if (!accessToken) throw new Error('Token response did not include an access token')
  const tokenType = typeof d.token_type === 'string' ? d.token_type : 'Bearer'
  if (tokenType.toLowerCase() !== 'bearer') throw new Error(`Unsupported token type: ${tokenType}`)
  let expiresAt = 0
  const expiresIn = Number(d.expires_in)
  if (Number.isFinite(expiresIn) && expiresIn > 0) expiresAt = now + expiresIn * 1000
  else {
    const exp = Number(jwtPayload(accessToken)?.exp)
    if (Number.isFinite(exp) && exp > 0) expiresAt = exp * 1000
  }
  return {
    accessToken,
    refreshToken: typeof d.refresh_token === 'string' && d.refresh_token ? d.refresh_token : undefined,
    expiresAt,
  }
}

function describeTokenError(err: unknown): Error {
  const ax = err as AxiosError<{ error?: string; error_description?: string }>
  const body = ax?.response?.data
  if (body && typeof body === 'object' && body.error) {
    const e = new Error(`${body.error}${body.error_description ? `: ${body.error_description}` : ''}`)
    ;(e as Error & { oauthError?: string }).oauthError = body.error
    return e
  }
  return err instanceof Error ? err : new Error(String(err))
}

async function postToken(tokenEndpoint: string, params: Record<string, string>, options: RequestOptions): Promise<OAuthTokens> {
  try {
    const res = await axios.post(tokenEndpoint, new URLSearchParams(params).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      httpsAgent: agentFor(options),
      timeout: 30_000,
      maxRedirects: 0,
    })
    return parseTokenResponse(res.data)
  } catch (err) {
    throw describeTokenError(err)
  }
}

export function exchangeAuthorizationCode(meta: AuthorizationServerMetadata, args: {
  code: string; codeVerifier: string; redirectUri: string; clientId?: string
}, options: RequestOptions = {}): Promise<OAuthTokens> {
  return postToken(meta.token_endpoint, {
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
    code_verifier: args.codeVerifier,
    client_id: args.clientId ?? POSTLY_OAUTH_CLIENT_ID,
  }, options)
}

/** Refresh tokens rotate: callers must persist the returned refresh token. */
export async function refreshAccessToken(meta: AuthorizationServerMetadata, refreshToken: string, options: RequestOptions = {}): Promise<OAuthTokens> {
  const tokens = await postToken(meta.token_endpoint, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: POSTLY_OAUTH_CLIENT_ID,
  }, options)
  // Servers that don't rotate omit refresh_token; keep using the current one.
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken }
}

/** Best-effort RFC 7009 revocation of a refresh token (sign-out). */
export async function revokeToken(meta: AuthorizationServerMetadata, token: string, options: RequestOptions = {}): Promise<void> {
  if (!meta.revocation_endpoint || !token) return
  await axios.post(meta.revocation_endpoint, new URLSearchParams({
    token, token_type_hint: 'refresh_token', client_id: POSTLY_OAUTH_CLIENT_ID,
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    httpsAgent: agentFor(options),
    timeout: 15_000,
    maxRedirects: 0,
  })
}

export function userFromAccessToken(accessToken: string): OAuthUser {
  const sub = jwtPayload(accessToken)?.sub
  if (typeof sub !== 'string' || !sub) return { name: 'Backstage user' }
  return { name: sub.replace(/^[^:]+:/, '').split('/').pop() || sub, entityRef: sub }
}

// ─── Whole flow ───────────────────────────────────────────────────────────────

export async function signInWithBackstageOAuth(baseUrl: string, options: RequestOptions & {
  openExternal: (url: string) => void | Promise<void>
  timeoutMs?: number
}): Promise<{ tokens: OAuthTokens; user: OAuthUser }> {
  const meta = await discoverAuthorizationServer(baseUrl, options)
  const { verifier, challenge } = generatePkce()
  const state = generateState()
  const callback = await startLoopbackCallback(state, options.timeoutMs)
  try {
    await options.openExternal(buildAuthorizationUrl(meta, {
      clientId: POSTLY_OAUTH_CLIENT_ID,
      redirectUri: callback.redirectUri,
      state,
      codeChallenge: challenge,
    }))
    const code = await callback.code
    const tokens = await exchangeAuthorizationCode(meta, { code, codeVerifier: verifier, redirectUri: callback.redirectUri }, options)
    return { tokens, user: userFromAccessToken(tokens.accessToken) }
  } finally {
    callback.close()
  }
}

/** True for an HTTP 401 from axios — the access token was rejected. */
export function isUnauthorizedError(err: unknown): boolean {
  return (err as AxiosError)?.response?.status === 401
}
