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

  const authUrl = new URL(config.authUrl!)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('client_id', config.clientId)
  authUrl.searchParams.set('redirect_uri', config.redirectUri)
  authUrl.searchParams.set('scope', config.scopes)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('code_challenge', challenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, 'http://localhost:9876')
      const returnedCode = url.searchParams.get('code')
      const returnedState = url.searchParams.get('state')

      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body><h2>Authorization complete. You can close this window.</h2></body></html>')

      server.close()

      if (returnedState !== state) {
        reject(new Error('OAuth state mismatch'))
        return
      }
      if (!returnedCode) {
        reject(new Error('No authorization code received'))
        return
      }
      resolve(returnedCode)
    })

    server.listen(9876, () => {
      const win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
      })
      win.loadURL(authUrl.toString())
      win.on('closed', () => {
        server.close()
        reject(new Error('Authorization window closed'))
      })
    })

    server.on('error', reject)
  })

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
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
    refresh_token: token.refreshToken!,
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

