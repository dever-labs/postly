import { ipcMain } from 'electron'
import crypto from 'crypto'
import { queryAll, queryOne, run } from '../database'
import {
  authorizeAuthCode,
  clientCredentials,
  getValidToken,
  getValidTokenForConfig,
  authorizeInline,
  configHashKey,
  OAuthConfig
} from '../services/oauth'

function rowToConfig(row: Record<string, unknown>): OAuthConfig {
  return {
    id: String(row['id']),
    name: String(row['name']),
    grantType: String(row['grant_type']),
    clientId: String(row['client_id']),
    clientSecret: row['client_secret'] ? String(row['client_secret']) : undefined,
    authUrl: row['auth_url'] ? String(row['auth_url']) : undefined,
    tokenUrl: String(row['token_url']),
    scopes: String(row['scopes'] ?? ''),
    redirectUri: String(row['redirect_uri'] ?? 'http://localhost:9876/callback')
  }
}

export function registerOAuthHandlers(): void {
  ipcMain.handle('postly:oauth:configs:list', async () => {
    try {
      return { data: queryAll<Record<string, unknown>>('SELECT * FROM oauth_configs ORDER BY created_at ASC').map(rowToConfig) }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:oauth:configs:create', async (_, args: { name: string; grantType: string; clientId: string; clientSecret?: string; authUrl?: string; tokenUrl: string; scopes?: string; redirectUri?: string }) => {
    try {
      const id = crypto.randomUUID(); const now = Date.now()
      run(
        `INSERT INTO oauth_configs (id, name, grant_type, client_id, client_secret, auth_url, token_url, scopes, redirect_uri, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, args.name, args.grantType, args.clientId, args.clientSecret ?? null, args.authUrl ?? null,
         args.tokenUrl, args.scopes ?? '', args.redirectUri ?? 'http://localhost:9876/callback', now, now]
      )
      const row = queryOne<Record<string, unknown>>('SELECT * FROM oauth_configs WHERE id = ?', [id])
      return { data: row ? rowToConfig(row) : null }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:oauth:configs:delete', async (_, args: { id: string }) => {
    try { run('DELETE FROM oauth_configs WHERE id = ?', [args.id]); return { data: true } }
    catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:oauth:authorize', async (_, args: { configId: string }) => {
    try {
      const row = queryOne<Record<string, unknown>>('SELECT * FROM oauth_configs WHERE id = ?', [args.configId])
      if (!row) return { error: 'OAuth config not found' }
      const config = rowToConfig(row)
      const token = config.grantType === 'authorization_code'
        ? await authorizeAuthCode(config)
        : await clientCredentials(config)
      return { data: token }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:oauth:token:get', async (_, args: { configId: string }) => {
    try { return { data: await getValidToken(args.configId) } }
    catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:oauth:token:clear', async (_, args: { configId: string }) => {
    try { run('DELETE FROM tokens WHERE oauth_config_id = ?', [args.configId]); return { data: true } }
    catch (err) { return { error: String(err) } }
  })

  // ── Inline config handlers (config stored directly on entity, no oauth_configs row) ──

  ipcMain.handle('postly:oauth:inline:authorize', async (_, config: OAuthConfig) => {
    try { return { data: await authorizeInline(config) } }
    catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:oauth:inline:token:get', async (_, config: OAuthConfig) => {
    try { return { data: await getValidTokenForConfig(config) } }
    catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:oauth:inline:token:clear', async (_, config: OAuthConfig) => {
    try {
      const key = configHashKey(config)
      run('DELETE FROM tokens WHERE oauth_config_id = ?', [key])
      return { data: true }
    }
    catch (err) { return { error: String(err) } }
  })
}
