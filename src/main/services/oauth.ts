import { BrowserWindow, session } from 'electron'
import crypto from 'crypto'
import https from 'https'
import axios from 'axios'
import { queryOne, runTransaction } from '../database'

const OAUTH_AUTHORIZATION_TIMEOUT_MS = 5 * 60 * 1000
const TOKEN_EXPIRY_BUFFER_MS = 60_000

type DbTokenRow = {
  id: string
  oauth_config_id: string
  access_token: string
  refresh_token: string | null
  token_type: string
  expires_at: number | null
  scope: string | null
  created_at: number
}

export interface OAuthConfig {
  id: string
  name: string
  grantType: string
  clientId: string
  clientSecret?: string
  authUrl?: string
  tokenUrl: string
  scopes: string
  redirectUri: string
  /** Extra parameters appended to every token request body — for providers that require non-standard fields (e.g. `audience`, `resource`). */
  extraParams?: Record<string, string>
}

export interface Token {
  id: string
  oauthConfigId: string
  accessToken: string
  refreshToken?: string
  tokenType: string
  expiresAt?: number
  scope?: string
  createdAt: number
}

/**
 * Waits for the OAuth provider to redirect the BrowserWindow back to the
 * registered redirect URI, intercepting the navigation event before Electron
 * tries to load the URL. This works for any URI scheme (http, https, custom)
 * without requiring a local HTTP server.
 *
 * Only resolves when both the `code` and the `state` in the redirect URL match
 * the expected values. This prevents a class of state-mismatch errors on
 * Windows where intermediate navigations from the same origin (e.g. IDP form
 * submissions) fire `will-navigate` with a `code` param but no matching state.
 */
async function waitForRedirect(
  redirectUri: string,
  expectedState: string,
  win: BrowserWindow,
): Promise<{ code: string; state: string }> {
  const { origin: expectedOrigin } = new URL(redirectUri)

  return new Promise((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      if (!win.isDestroyed()) {
        win.webContents.off('will-redirect', tryCapture)
        win.webContents.off('will-navigate', tryCapture)
      }
      win.off('closed', onClosed)
      clearTimeout(timer)
    }

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }

    const tryCapture = (event: Electron.Event, url: string) => {
      try {
        const { origin, searchParams } = new URL(url)
        if (origin !== expectedOrigin) return
        const code = searchParams.get('code')
        if (!code) return
        // Ignore redirects that don't carry the expected state — they are
        // intermediate navigations within the IDP flow, not the final callback.
        if (searchParams.get('state') !== expectedState) return
        event.preventDefault()
        settle(() => resolve({ code, state: expectedState }))
      } catch { /* ignore unparseable URLs */ }
    }

    const onClosed = () => settle(() => reject(new Error('Authorization window closed')))
    const timer = setTimeout(
      () => settle(() => reject(new Error('OAuth authorization timed out'))),
      OAUTH_AUTHORIZATION_TIMEOUT_MS
    )

    win.webContents.on('will-redirect', tryCapture)
    win.webContents.on('will-navigate', tryCapture)
    win.on('closed', onClosed)
  })
}

export function generateCodeVerifier(): string {
  return crypto.randomBytes(96).toString('base64url').slice(0, 128)
}

export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

/**
 * POSTs to a token endpoint and returns the parsed response body.
 * Re-throws with the provider's error_description included so callers can
 * surface a meaningful message instead of the generic AxiosError string.
 */
async function postTokenRequest(
  url: string,
  params: URLSearchParams,
  sslVerification = true,
  extraParams?: Record<string, string>,
): Promise<Record<string, unknown>> {
  try {
    new URL(url)
  } catch {
    throw new Error(`Invalid token URL: "${url}". Enter a valid absolute URL (e.g. https://auth.example.com/token).`)
  }

  if (extraParams) {
    for (const [k, v] of Object.entries(extraParams)) {
      if (k) params.set(k, v)
    }
  }

  try {
    // codeql[js/disabling-certificate-validation] -- intentional: user-controlled dev setting
    const httpsAgent = sslVerification ? undefined : new https.Agent({ rejectUnauthorized: false })
    const response = await axios.post(url, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      httpsAgent,
      timeout: 30_000,
    })
    return response.data as Record<string, unknown>
  } catch (err) {
    if (axios.isAxiosError(err)) {
      if (err.response) {
        const body = err.response.data as Record<string, string> | null
        const detail = body?.error_description ?? body?.error ?? JSON.stringify(body)
        throw new Error(`Token endpoint returned ${err.response.status}: ${detail}`, { cause: err })
      }
      if (err.code === 'ECONNREFUSED') {
        throw new Error(`Cannot connect to token endpoint — connection refused. Check the URL and ensure the server is running.`, { cause: err })
      }
      if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
        throw new Error(`Cannot reach token endpoint — host not found. Check the URL for typos.`, { cause: err })
      }
      if (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED') {
        throw new Error(`Token endpoint timed out after 30s. Check network connectivity or increase your timeout.`, { cause: err })
      }
      throw new Error(`Token request failed: ${err.message}`, { cause: err })
    }
    throw err
  }
}

export async function authorizeAuthCode(config: OAuthConfig, sslVerification = true): Promise<Token> {
  if (!config.redirectUri) {
    throw new Error('OAuth authorization_code flow requires a redirect URI.')
  }
  if (!config.authUrl) {
    throw new Error('OAuth authorization_code flow requires an Auth URL.')
  }
  const verifier = generateCodeVerifier()
  const challenge = generateCodeChallenge(verifier)
  const state = crypto.randomBytes(16).toString('hex')
  const redirectUri = config.redirectUri

  const authUrl = new URL(config.authUrl ?? '')
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', config.clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('scope', config.scopes)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')

  // Use a persistent named partition per config so the IDP session (cookies) is
  // preserved between auth attempts — the user won't be prompted to log in again
  // as long as their IDP session is still valid.
  // SSL-disabled configs use a separate namespace so cert policy stays isolated.
  const partitionName = sslVerification
    ? `persist:oauth-${config.id}`
    : `persist:oauth-ssl-disabled-${config.id}`
  const s = session.fromPartition(partitionName)
  if (!sslVerification) {
    s.setCertificateVerifyProc((_req, callback) => callback(0))
  }

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, partition: partitionName }
  })
  // Register listener BEFORE loadURL so the redirect is caught even if
  // Keycloak completes it instantly (e.g. an existing session).
  const redirectPromise = waitForRedirect(redirectUri, state, win)
  win.loadURL(authUrl.toString())

  let code: string
  try {
    const result = await redirectPromise
    if (result.state !== state) throw new Error('OAuth state mismatch')
    code = result.code
  } finally {
    // Flush cookies to disk before closing so the IDP session survives app restarts.
    await s.cookies.flushStore().catch(() => {})
    if (!win.isDestroyed()) win.close()
  }

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: config.clientId,
    code_verifier: verifier
  })
  if (config.clientSecret) params.set('client_secret', config.clientSecret)

  return saveToken(config.id, await postTokenRequest(config.tokenUrl, params, sslVerification, config.extraParams))
}

export async function clientCredentials(config: OAuthConfig, sslVerification = true): Promise<Token> {
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    scope: config.scopes
  })
  if (config.clientSecret) params.set('client_secret', config.clientSecret)

  return saveToken(config.id, await postTokenRequest(config.tokenUrl, params, sslVerification, config.extraParams))
}

export async function refreshTokenGrant(token: Token, config: OAuthConfig, sslVerification = true): Promise<Token> {
  if (!token.refreshToken) {
    throw new Error('Cannot perform refresh token grant: missing refresh token on provided token record.')
  }
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: token.refreshToken,
    client_id: config.clientId
  })
  if (config.clientSecret) params.set('client_secret', config.clientSecret)

  return saveToken(config.id, await postTokenRequest(config.tokenUrl, params, sslVerification, config.extraParams))
}

async function saveToken(oauthConfigId: string, data: Record<string, unknown>): Promise<Token> {
  if (!data['access_token']) {
    throw new Error('Token endpoint response missing required field: access_token')
  }
  const id = crypto.randomUUID()
  const now = Date.now()
  const expiresAt = data['expires_in'] ? now + Number(data['expires_in']) * 1000 : undefined

  runTransaction([
    { sql: 'DELETE FROM tokens WHERE oauth_config_id = ?', params: [oauthConfigId] },
    {
      sql: `INSERT INTO tokens (id, oauth_config_id, access_token, refresh_token, token_type, expires_at, scope, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        oauthConfigId,
        String(data['access_token'] ?? ''),
        data['refresh_token'] ? String(data['refresh_token']) : null,
        String(data['token_type'] ?? 'Bearer'),
        expiresAt ?? null,
        data['scope'] ? String(data['scope']) : null,
        now
      ]
    }
  ])

  return {
    id,
    oauthConfigId,
    accessToken: String(data['access_token'] ?? ''),
    refreshToken: data['refresh_token'] ? String(data['refresh_token']) : undefined,
    tokenType: String(data['token_type'] ?? 'Bearer'),
    expiresAt,
    scope: data['scope'] ? String(data['scope']) : undefined,
    createdAt: now
  }
}

export async function getValidToken(oauthConfigId: string, sslVerification = true): Promise<Token | null> {
  const row = queryOne<DbTokenRow>(
    'SELECT * FROM tokens WHERE oauth_config_id = ? ORDER BY created_at DESC LIMIT 1',
    [oauthConfigId]
  )

  if (!row) return null

  const token: Token = {
    id: row.id,
    oauthConfigId: row.oauth_config_id,
    accessToken: row.access_token,
    refreshToken: row.refresh_token ?? undefined,
    tokenType: row.token_type,
    expiresAt: row.expires_at ?? undefined,
    scope: row.scope ?? undefined,
    createdAt: row.created_at
  }

  if (token.expiresAt && token.expiresAt < Date.now() + TOKEN_EXPIRY_BUFFER_MS) {
    if (token.refreshToken) {
      const configRow = queryOne<OAuthConfigRow>('SELECT * FROM oauth_configs WHERE id = ?', [oauthConfigId])
      if (configRow) {
        return await refreshTokenGrant(token, rowToOAuthConfig(configRow), sslVerification)
      }
    }
    return null
  }

  return token
}

type OAuthConfigRow = { id: string; name: string; grant_type: string; client_id: string; client_secret: string | null; auth_url: string | null; token_url: string; scopes: string; redirect_uri: string }

function rowToOAuthConfig(row: OAuthConfigRow): OAuthConfig {
  return {
    id: row.id,
    name: row.name,
    grantType: row.grant_type,
    clientId: row.client_id,
    clientSecret: row.client_secret ?? undefined,
    authUrl: row.auth_url ?? undefined,
    tokenUrl: row.token_url,
    scopes: row.scopes ?? '',
    redirectUri: row.redirect_uri
  }
}

/** Derives a stable token-cache key from inline OAuth config fields.
 *
 * Includes grantType and clientSecret (as well as clientId/tokenUrl/scopes)
 * so that configs sharing the same endpoint but with different credentials or
 * grant types get isolated token buckets.
 */
export function configHashKey(config: Pick<OAuthConfig, 'clientId' | 'tokenUrl' | 'scopes' | 'grantType' | 'clientSecret'>): string {
  return crypto.createHash('sha256')
    .update([config.clientId, config.tokenUrl, config.scopes, config.grantType, config.clientSecret ?? ''].join('|'))
    .digest('hex')
    .slice(0, 32)
}

/**
 * Like getValidToken but works with an inline config (no oauth_configs table row needed).
 * Looks up the token by a hash key and refreshes using the provided config if needed.
 */
export async function getValidTokenForConfig(config: OAuthConfig, sslVerification = true): Promise<Token | null> {
  const key = configHashKey(config)
  const row = queryOne<DbTokenRow>(
    'SELECT * FROM tokens WHERE oauth_config_id = ? ORDER BY created_at DESC LIMIT 1',
    [key]
  )
  if (!row) return null

  const token: Token = {
    id: row.id,
    oauthConfigId: row.oauth_config_id,
    accessToken: row.access_token,
    refreshToken: row.refresh_token ?? undefined,
    tokenType: row.token_type,
    expiresAt: row.expires_at ?? undefined,
    scope: row.scope ?? undefined,
    createdAt: row.created_at
  }

  if (token.expiresAt && token.expiresAt < Date.now() + TOKEN_EXPIRY_BUFFER_MS) {
    if (token.refreshToken) {
      return await refreshTokenGrant(token, { ...config, id: key }, sslVerification)
    }
    return null
  }

  return token
}

/** Authorize using inline config and cache token by config hash. */
export async function authorizeInline(config: OAuthConfig, sslVerification = true): Promise<Token> {
  const key = configHashKey(config)
  const cfg = { ...config, id: key }
  return config.grantType === 'client_credentials'
    ? await clientCredentials(cfg, sslVerification)
    : await authorizeAuthCode(cfg, sslVerification)
}
