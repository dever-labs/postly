import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { queryAll, queryOne } from '../database'
import { executeRequest, HttpRequest, LogEntry } from '../services/http-executor'
import { getValidTokenForConfig, authorizeInline } from '../services/oauth'
import { getGeneralSettings } from './settings-utils'

type LogLevel = 'info' | 'warn' | 'error'

type FolderLineageRow = {
  id: string
  name: string
  parent_id: string | null
  auth_type: string | null
  auth_config: string | null
  ssl_verification: string | null
  integration_id: string | null
}

let currentAbortController: AbortController | null = null

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

/** Returns all folders from the given folder up to the root, ordered nearest-first (depth ASC). */
function getFolderLineage(folderId?: string): FolderLineageRow[] {
  if (!folderId) return []
  return queryAll<FolderLineageRow>(
    `WITH RECURSIVE lineage AS (
       SELECT id, parent_id, name, auth_type, auth_config, ssl_verification, integration_id, 0 AS depth
       FROM folders
       WHERE id = ?
       UNION ALL
       SELECT f.id, f.parent_id, f.name, f.auth_type, f.auth_config, f.ssl_verification, f.integration_id, lineage.depth + 1
       FROM folders f
       JOIN lineage ON lineage.parent_id = f.id
     )
     SELECT id, parent_id, name, auth_type, auth_config, ssl_verification, integration_id
     FROM lineage
     ORDER BY depth ASC`,
    [folderId]
  )
}

export function registerHttpHandlers(): void {
  ipcMain.handle('postly:http:cancel', () => {
    currentAbortController?.abort()
    currentAbortController = null
  })

  ipcMain.handle('postly:http:execute', async (_: IpcMainInvokeEvent, req: HttpRequest) => {
    const logs: LogEntry[] = []
    const log = (level: LogLevel, message: string, detail?: string) => logs.push({ level, message, detail })

    try {
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

      const lineage = getFolderLineage(req.folderId)
      const rootFolder = lineage.find((f) => !f.parent_id)

      let resolvedAuthType = req.authType
      let resolvedAuthConfig = req.authConfig
      let authSource = 'request'

      const shouldInherit = (t: string) => t === 'inherit' || !t

      if (shouldInherit(resolvedAuthType) && lineage.length > 0) {
        // Walk up from the direct folder to the root — use the nearest ancestor with explicit auth
        const inheritedIdx = lineage.findIndex((f) => f.auth_type && !shouldInherit(f.auth_type))
        const inherited = inheritedIdx >= 0 ? lineage[inheritedIdx] : null
        if (inherited) {
          resolvedAuthType = inherited.auth_type ?? 'none'
          resolvedAuthConfig = safeParseJSON(inherited.auth_config, {})
          // depth 0 = direct folder of the request; root ancestors (parent_id IS NULL, depth > 0) = "collection"
          const isDirectFolder = inheritedIdx === 0
          authSource = (isDirectFolder || inherited.parent_id) ? `folder "${inherited.name}"` : `collection "${inherited.name}"`
        } else if (rootFolder?.integration_id) {
          const integration = queryOne<Record<string, unknown>>('SELECT * FROM integrations WHERE id = ?', [rootFolder.integration_id])
          if (integration?.token) {
            resolvedAuthType = 'bearer'
            resolvedAuthConfig = { token: integration.token as string }
            authSource = `integration "${integration.name as string}"`
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

      const generalSettings = getGeneralSettings()
      let sslVerification = generalSettings.sslVerification
      const followRedirects = generalSettings.followRedirects
      const timeout = generalSettings.defaultTimeout

      const shouldInheritSsl = (v: string | undefined) => !v || v === 'inherit'
      let resolvedSsl: string | undefined = req.sslVerification
      let sslSource = 'global setting'
      if (shouldInheritSsl(resolvedSsl) && lineage.length > 0) {
        // Walk up from the direct folder to the root — use the nearest ancestor with explicit ssl
        const inheritedSsl = lineage.find((f) => f.ssl_verification && !shouldInheritSsl(f.ssl_verification))
        if (inheritedSsl) {
          resolvedSsl = inheritedSsl.ssl_verification ?? undefined
          sslSource = inheritedSsl.parent_id ? `folder "${inheritedSsl.name}"` : `collection "${inheritedSsl.name}"`
        }
      }
      if (resolvedSsl === 'enabled') sslVerification = true
      else if (resolvedSsl === 'disabled') { sslVerification = false; sslSource = resolvedSsl === req.sslVerification ? 'request' : sslSource }

      if (!sslVerification) log('warn', `SSL verification disabled (${sslSource})`)
      if (!followRedirects) log('info', 'Following redirects: disabled')

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
          extraParams: resolvedAuthConfig.extraParams
            ? (() => { try { return JSON.parse(resolvedAuthConfig.extraParams) as Record<string, string> } catch { return undefined } })()
            : undefined,
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

      const urlCount = countInterpolations(req.url, envVars)
      const headerCount = Object.values(req.headers).reduce((sum, value) => sum + countInterpolations(value, envVars), 0)
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
          Object.entries(req.headers).map(([key, value]) => [key, interpolateEnvVars(value, envVars)])
        )
      }

      const controller = new AbortController()
      currentAbortController = controller
      const response = await executeRequest(interpolatedReq, {
        sslVerification, followRedirects, timeout,
        signal: controller.signal,
        onLog: (entry) => log(entry.level, entry.message, entry.detail)
      })
      currentAbortController = null
      return { data: { ...response, logs } }
    } catch (err) {
      currentAbortController = null
      log('error', `Unexpected error: ${String(err)}`)
      return { error: String(err), logs }
    }
  })
}
