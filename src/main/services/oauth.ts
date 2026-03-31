import { BrowserWindow } from 'electron'
import http from 'http'
import crypto from 'crypto'
import axios from 'axios'
import { queryOne, run } from '../database'

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

async function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = http.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as { port: number }
      srv.close(() => resolve(addr.port))
    })
  })
}

async function waitForCallback(port: number, win: BrowserWindow): Promise<{ code: string; state: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`)
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body><h2>Authorization complete. You can close this window.</h2></body></html>')
      server.close()
      if (code) resolve({ code, state: state ?? '' })
      else reject(new Error('No authorization code in callback'))
    })
    server.listen(port, '127.0.0.1')
    server.on('error', reject)
    win.on('closed', () => { server.close(); reject(new Error('Authorization window closed')) })
    setTimeout(() => { server.close(); reject(new Error('OAuth authorization timed out')) }, 5 * 60 * 1000)
  })
}

export function generateCodeVerifier(): string {
  return crypto.randomBytes(96).toString('base64url').slice(0, 128)
}

export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url')
}

export async function authorizeAuthCode(config: OAuthConfig): Promise<Token> {
  const verifier = generateCodeVerifier()
  const challenge = generateCodeChallenge(verifier)
  const state = crypto.randomBytes(16).toString('hex')

  // Use the registered redirectUri verbatim so the provider accepts the request.
  // Derive the listening port from it; fall back to a free port if none is set.
  const redirectUri = config.redirectUri
  const uriPort = new URL(redirectUri).port
  const port = uriPort ? parseInt(uriPort, 10) : await getFreePort()

  const authUrl = new URL(config.authUrl ?? '')
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', config.clientId)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('scope', config.scopes)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  })
  win.loadURL(authUrl.toString())

  let code: string
  try {
    const result = await waitForCallback(port, win)
    if (result.state !== state) throw new Error('OAuth state mismatch')
    code = result.code
  } finally {
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

  const response = await axios.post(config.tokenUrl, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  })

  return saveToken(config.id, response.data)
}

export async function clientCredentials(config: OAuthConfig): Promise<Token> {
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    scope: config.scopes
  })
  if (config.clientSecret) params.set('client_secret', config.clientSecret)

  const response = await axios.post(config.tokenUrl, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  })

  return saveToken(config.id, response.data)
}

export async function refreshTokenGrant(token: Token, config: OAuthConfig): Promise<Token> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: token.refreshToken ?? '',
    client_id: config.clientId
  })
  if (config.clientSecret) params.set('client_secret', config.clientSecret)

  const response = await axios.post(config.tokenUrl, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  })

  run('DELETE FROM tokens WHERE oauth_config_id = ?', [config.id])
  return saveToken(config.id, response.data)
}

function saveToken(oauthConfigId: string, data: Record<string, unknown>): Token {
  const id = crypto.randomUUID()
  const now = Date.now()
  const expiresAt = data['expires_in'] ? now + Number(data['expires_in']) * 1000 : undefined

  run('DELETE FROM tokens WHERE oauth_config_id = ?', [oauthConfigId])
  run(
    `INSERT INTO tokens (id, oauth_config_id, access_token, refresh_token, token_type, expires_at, scope, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      oauthConfigId,
      String(data['access_token'] ?? ''),
      data['refresh_token'] ? String(data['refresh_token']) : null,
      String(data['token_type'] ?? 'Bearer'),
      expiresAt ?? null,
      data['scope'] ? String(data['scope']) : null,
      now
    ]
  )

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

export async function getValidToken(oauthConfigId: string): Promise<Token | null> {
  type TokenRow = { id: string; oauth_config_id: string; access_token: string; refresh_token: string | null; token_type: string; expires_at: number | null; scope: string | null; created_at: number }
  const row = queryOne<TokenRow>(
    'SELECT * FROM tokens WHERE oauth_config_id = ? ORDER BY created_at DESC LIMIT 1',
    [oauthConfigId]
  )

  if (!row) return null

  const token: Token = {
    id: row.id,
    oauthConfigId: row.oauth_config_id,
    accessToken: row.access_token,
    refreshToken: row.refresh_token ?? undefined,
    tokenType: row.token_type ?? 'Bearer',
    expiresAt: row.expires_at ?? undefined,
    scope: row.scope ?? undefined,
    createdAt: row.created_at
  }

  if (token.expiresAt && token.expiresAt < Date.now() + 60_000) {
    if (token.refreshToken) {
      type ConfigRow = { id: string; name: string; grant_type: string; client_id: string; client_secret: string | null; auth_url: string | null; token_url: string; scopes: string; redirect_uri: string }
      const configRow = queryOne<ConfigRow>('SELECT * FROM oauth_configs WHERE id = ?', [oauthConfigId])
      if (configRow) {
        try {
          return await refreshTokenGrant(token, rowToOAuthConfig(configRow))
        } catch {
          return null
        }
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
    redirectUri: row.redirect_uri ?? 'http://localhost:9876/callback'
  }
}

/** Derives a stable token-cache key from inline OAuth config fields. */
export function configHashKey(config: Pick<OAuthConfig, 'clientId' | 'tokenUrl' | 'scopes'>): string {
  return crypto.createHash('sha256')
    .update([config.clientId, config.tokenUrl, config.scopes].join('|'))
    .digest('hex')
    .slice(0, 32)
}

/**
 * Like getValidToken but works with an inline config (no oauth_configs table row needed).
 * Looks up the token by a hash key and refreshes using the provided config if needed.
 */
export async function getValidTokenForConfig(config: OAuthConfig): Promise<Token | null> {
  const key = configHashKey(config)
  type TokenRow = { id: string; oauth_config_id: string; access_token: string; refresh_token: string | null; token_type: string; expires_at: number | null; scope: string | null; created_at: number }
  const row = queryOne<TokenRow>(
    'SELECT * FROM tokens WHERE oauth_config_id = ? ORDER BY created_at DESC LIMIT 1',
    [key]
  )
  if (!row) return null

  const token: Token = {
    id: row.id,
    oauthConfigId: row.oauth_config_id,
    accessToken: row.access_token,
    refreshToken: row.refresh_token ?? undefined,
    tokenType: row.token_type ?? 'Bearer',
    expiresAt: row.expires_at ?? undefined,
    scope: row.scope ?? undefined,
    createdAt: row.created_at
  }

  if (token.expiresAt && token.expiresAt < Date.now() + 60_000) {
    if (token.refreshToken) {
      try {
        // Temporarily assign key as id for saveToken to use correct bucket
        return await refreshTokenGrant(token, { ...config, id: key })
      } catch {
        return null
      }
    }
    return null
  }

  return token
}

/** Authorize using inline config and cache token by config hash. */
export async function authorizeInline(config: OAuthConfig): Promise<Token> {
  const key = configHashKey(config)
  const cfg = { ...config, id: key }
  return config.grantType === 'client_credentials'
    ? await clientCredentials(cfg)
    : await authorizeAuthCode(cfg)
}
