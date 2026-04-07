import { ipcMain } from 'electron'
import { queryAll, queryOne } from '../database'
import { executeRequest, HttpRequest, LogEntry } from '../services/http-executor'
import { getValidTokenForConfig, authorizeInline } from '../services/oauth'
import { getGeneralSettings } from './settings-utils'

type LogLevel = 'info' | 'warn' | 'error'

function interpolateEnvVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => vars[key.trim()] ?? `{{${key}}}`)
}

function countInterpolations(text: string, vars: Record<string, string>): number {
  let n = 0
  text.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => { if (vars[key.trim()] !== undefined) n++; return '' })
  return n
}

function safeParseJSON<T>(value: unknown, fallback: T): T {
  if (typeof value === 'string') {
    try { return JSON.parse(value) as T } catch { return fallback }
  }
  if (value != null) return value as T
  return fallback
}

function formatExpiry(expiresAt: number | undefined): string {
  if (!expiresAt) return 'no expiry info'
  const diffMs = expiresAt - Date.now()
  if (diffMs <= 0) return 'expired'
  const mins = Math.floor(diffMs / 60000)
  if (mins < 60) return `expires in ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `expires in ${hours}h ${mins % 60}m`
  return `expires in ${Math.floor(hours / 24)}d`
}

export function registerHttpHandlers(): void {
  ipcMain.handle('postly:http:execute', async (_, req: HttpRequest) => {
    const logs: LogEntry[] = []
    const log = (level: LogLevel, message: string, detail?: string) => logs.push({ level, message, detail })

    try {
      // ── Environment ──────────────────────────────────────────────────────────
      const activeEnv = queryOne<{ id: string; name: string }>(
        'SELECT id, name FROM environments WHERE is_active = 1 LIMIT 1'
      )
      const envVars: Record<string, string> = {}
      if (activeEnv) {
        for (const v of queryAll<{ key: string; value: string }>(
          'SELECT key, value FROM env_vars WHERE env_id = ?', [activeEnv.id]
        )) {
          envVars[v.key] = v.value
        }
        const count = Object.keys(envVars).length
        log('info', `Environment: "${activeEnv.name}" (${count} variable${count !== 1 ? 's' : ''})`)
      } else {
        log('info', 'No active environment')
      }

      // ── Eager group/collection fetch ─────────────────────────────────────────
      // Fetch once when a groupId is present; reused for both auth and SSL
      // resolution below to avoid redundant DB round-trips.
      const groupRow = req.groupId
        ? queryOne<Record<string, unknown>>('SELECT * FROM groups WHERE id = ?', [req.groupId])
        : null
      const collectionRow = groupRow?.collection_id
        ? queryOne<Record<string, unknown>>('SELECT * FROM collections WHERE id = ?', [groupRow.collection_id])
        : null

      // ── Auth resolution ───────────────────────────────────────────────────────
      let resolvedAuthType = req.authType
      let resolvedAuthConfig = req.authConfig
      let authSource = 'request'

      const shouldInherit = (t: string) => t === 'inherit' || !t

      if (shouldInherit(resolvedAuthType) && groupRow) {
        if (groupRow?.auth_type && !shouldInherit(groupRow.auth_type as string)) {
          resolvedAuthType = groupRow.auth_type as string
          resolvedAuthConfig = safeParseJSON(groupRow.auth_config as string, {})
          authSource = `group "${groupRow.name as string}"`
        } else {
          if (collectionRow?.auth_type && !shouldInherit(collectionRow.auth_type as string)) {
            resolvedAuthType = collectionRow.auth_type as string
            resolvedAuthConfig = safeParseJSON(collectionRow.auth_config as string, {})
            authSource = `collection "${collectionRow.name as string}"`
          } else if (collectionRow?.integration_id) {
            const integration = queryOne<Record<string, unknown>>('SELECT * FROM integrations WHERE id = ?', [collectionRow.integration_id])
            if (integration?.token) {
              resolvedAuthType = 'bearer'
              resolvedAuthConfig = { token: integration.token as string }
              authSource = `integration "${integration.name as string}"`
            }
          }
        }
      }

      if (shouldInherit(resolvedAuthType)) {
        resolvedAuthType = 'none'
        resolvedAuthConfig = {}
        log('info', 'Auth: none')
      } else if (authSource === 'request') {
        log('info', `Auth: ${resolvedAuthType}`)
      } else {
        log('info', `Auth: ${resolvedAuthType} (inherited from ${authSource})`)
      }

      // ── Settings ─────────────────────────────────────────────────────────────
      const generalSettings = getGeneralSettings()
      let sslVerification = generalSettings.sslVerification
      const followRedirects = generalSettings.followRedirects
      const timeout = generalSettings.defaultTimeout

      // ── SSL resolution ────────────────────────────────────────────────────────
      const shouldInheritSsl = (v: string | undefined) => !v || v === 'inherit'
      let resolvedSsl: string | undefined = req.sslVerification
      let sslSource = 'global setting'
      if (shouldInheritSsl(resolvedSsl) && groupRow) {
        if (groupRow?.ssl_verification && !shouldInheritSsl(groupRow.ssl_verification as string)) {
          resolvedSsl = groupRow.ssl_verification as string
          sslSource = `group "${groupRow.name as string}"`
        } else if (collectionRow?.ssl_verification && !shouldInheritSsl(collectionRow.ssl_verification as string)) {
          resolvedSsl = collectionRow.ssl_verification as string
          sslSource = `collection "${collectionRow.name as string}"`
        }
      }
      if (resolvedSsl === 'enabled') sslVerification = true
      else if (resolvedSsl === 'disabled') { sslVerification = false; sslSource = resolvedSsl === req.sslVerification ? 'request' : sslSource }

      if (!sslVerification) log('warn', `SSL verification disabled (${sslSource})`)
      if (!followRedirects) log('info', 'Following redirects: disabled')

      // ── OAuth 2.0 token resolution ────────────────────────────────────────────
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
          redirectUri: resolvedAuthConfig.redirectUri ?? '',
        }
        if (!cfg.clientId || !cfg.tokenUrl) {
          log('error', 'OAuth 2.0: clientId and tokenUrl are required')
          return { error: 'OAuth 2.0: clientId and tokenUrl are required.', logs }
        }
        if (cfg.grantType === 'authorization_code' && !cfg.redirectUri) {
          log('error', 'OAuth 2.0: redirectUri is required for authorization_code flow')
          return { error: 'OAuth 2.0: redirectUri is required for authorization_code flow.', logs }
        }
        let token = await getValidTokenForConfig(cfg, sslVerification)
        if (token) {
          log('info', `OAuth: using cached token (${formatExpiry(token.expiresAt ?? undefined)})`)
        } else {
          log('info', 'OAuth: no cached token — starting authorization flow')
          try { token = await authorizeInline(cfg, sslVerification) } catch (e) {
            log('error', `OAuth authorization failed: ${String(e)}`)
            return { error: `OAuth authorization failed: ${String(e)}`, logs }
          }
          if (token) log('info', `OAuth: new token obtained (${formatExpiry(token.expiresAt ?? undefined)})`)
        }
        if (token) {
          resolvedAuthType = 'bearer'
          resolvedAuthConfig = { token: token.accessToken }
        } else {
          log('error', 'OAuth: no valid token — please authorize in the Auth tab')
          return { error: 'OAuth: no valid token. Please authorize in the Auth tab.', logs }
        }
      }

      // ── Environment variable interpolation ───────────────────────────────────
      const urlCount = countInterpolations(req.url, envVars)
      const headerCount = Object.values(req.headers).reduce((s, v) => s + countInterpolations(v, envVars), 0)
      const totalCount = urlCount + headerCount
      if (totalCount > 0) {
        log('info', `Interpolated ${totalCount} environment variable${totalCount !== 1 ? 's' : ''}`)
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

      // ── Execute ───────────────────────────────────────────────────────────────
      const response = await executeRequest(interpolatedReq, {
        sslVerification, followRedirects, timeout,
        onLog: (entry) => log(entry.level, entry.message, entry.detail)
      })
      return { data: { ...response, logs } }
    } catch (err) {
      log('error', `Unexpected error: ${String(err)}`)
      return { error: String(err), logs }
    }
  })
}
