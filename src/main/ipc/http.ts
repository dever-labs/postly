import { ipcMain } from 'electron'
import { queryAll, queryOne } from '../database'
import { executeRequest, HttpRequest } from '../services/http-executor'
import { getValidTokenForConfig, authorizeInline } from '../services/oauth'

function interpolateEnvVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => vars[key.trim()] ?? `{{${key}}}`)
}

function safeParseJSON<T>(value: unknown, fallback: T): T {
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T } catch { return fallback }
  }
  if (value != null) return value as T
  return fallback
}

export function registerHttpHandlers(): void {
  ipcMain.handle('postly:http:execute', async (_, req: HttpRequest) => {
    try {
      const activeEnv = queryOne<{ id: string }>('SELECT id FROM environments WHERE is_active = 1 LIMIT 1')
      const envVars: Record<string, string> = {}
      if (activeEnv) {
        for (const v of queryAll<{ key: string; value: string }>('SELECT key, value FROM env_vars WHERE env_id = ?', [activeEnv.id])) {
          envVars[v.key] = v.value
        }
      }

      // Resolve auth inheritance — treat 'inherit' and 'none' at request level as "walk up"
      let resolvedAuthType = req.authType
      let resolvedAuthConfig = req.authConfig

      const shouldInherit = (t: string) => t === 'inherit' || !t

      if (shouldInherit(resolvedAuthType) && req.groupId) {
        const group = queryOne<Record<string, unknown>>('SELECT * FROM groups WHERE id = ?', [req.groupId])
        if (group?.auth_type && !shouldInherit(group.auth_type as string)) {
          resolvedAuthType = group.auth_type as string
          resolvedAuthConfig = safeParseJSON(group.auth_config as string, {})
        } else {
          const collection = group?.collection_id
            ? queryOne<Record<string, unknown>>('SELECT * FROM collections WHERE id = ?', [group.collection_id])
            : null
          if (collection?.auth_type && !shouldInherit(collection.auth_type as string)) {
            resolvedAuthType = collection.auth_type as string
            resolvedAuthConfig = safeParseJSON(collection.auth_config as string, {})
          } else if (collection?.integration_id) {
            const integration = queryOne<Record<string, unknown>>('SELECT * FROM integrations WHERE id = ?', [collection.integration_id])
            if (integration?.token) {
              resolvedAuthType = 'bearer'
              resolvedAuthConfig = { token: integration.token as string }
            }
          }
        }
      }

      // Fallback: if still inherit/none after walking, send unauthenticated
      if (shouldInherit(resolvedAuthType)) {
        resolvedAuthType = 'none'
        resolvedAuthConfig = {}
      }

      // OAuth 2.0 — resolve token automatically from inline config
      if (resolvedAuthType === 'oauth2') {
        const cfg = {
          id: '',
          name: 'inline',
          grantType: resolvedAuthConfig.grantType ?? 'authorization_code',
          clientId: resolvedAuthConfig.clientId ?? '',
          clientSecret: resolvedAuthConfig.clientSecret || undefined,
          authUrl: resolvedAuthConfig.authUrl || undefined,
          tokenUrl: resolvedAuthConfig.tokenUrl ?? '',
          scopes: resolvedAuthConfig.scopes ?? '',
          redirectUri: resolvedAuthConfig.redirectUri || 'http://localhost:9876/callback',
        }
        if (!cfg.clientId || !cfg.tokenUrl) {
          return { error: 'OAuth 2.0: clientId and tokenUrl are required.' }
        }
        let token = await getValidTokenForConfig(cfg)
        if (!token) {
          try { token = await authorizeInline(cfg) }
          catch (e) { return { error: `OAuth authorization failed: ${String(e)}` } }
        }
        if (token) {
          resolvedAuthType = 'bearer'
          resolvedAuthConfig = { token: token.accessToken }
        } else {
          return { error: 'OAuth: no valid token. Please authorize in the Auth tab.' }
        }
      }

      const interpolatedReq: HttpRequest = {
        ...req,
        authType: resolvedAuthType,
        authConfig: resolvedAuthConfig,
        url: interpolateEnvVars(req.url, envVars),
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([k, v]) => [k, interpolateEnvVars(v, envVars)])
        )
      }

      const settingsRow = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['general'])
      let sslVerification = true, followRedirects = true, timeout = 30000
      if (settingsRow) {
        try {
          const parsed = JSON.parse(settingsRow.value) as Record<string, unknown>
          if (typeof parsed['sslVerification'] === 'boolean') sslVerification = parsed['sslVerification']
          if (typeof parsed['followRedirects'] === 'boolean') followRedirects = parsed['followRedirects']
          if (typeof parsed['defaultTimeout'] === 'number') timeout = parsed['defaultTimeout']
        } catch { /* use defaults */ }
      }

      // Resolve SSL verification inheritance — walk request → group → collection, then fall back to global setting
      const shouldInheritSsl = (v: string | undefined) => !v || v === 'inherit'
      let resolvedSsl: string | undefined = req.sslVerification
      if (shouldInheritSsl(resolvedSsl) && req.groupId) {
        const group = queryOne<Record<string, unknown>>('SELECT * FROM groups WHERE id = ?', [req.groupId])
        if (group?.ssl_verification && !shouldInheritSsl(group.ssl_verification as string)) {
          resolvedSsl = group.ssl_verification as string
        } else {
          const collection = group?.collection_id
            ? queryOne<Record<string, unknown>>('SELECT * FROM collections WHERE id = ?', [group.collection_id])
            : null
          if (collection?.ssl_verification && !shouldInheritSsl(collection.ssl_verification as string)) {
            resolvedSsl = collection.ssl_verification as string
          }
        }
      }
      // If resolved to an explicit value, override the global setting
      if (resolvedSsl === 'enabled') sslVerification = true
      else if (resolvedSsl === 'disabled') sslVerification = false

      return { data: await executeRequest(interpolatedReq, { sslVerification, followRedirects, timeout }) }
    } catch (err) {
      return { error: String(err) }
    }
  })
}
