import { ipcMain } from 'electron'
import { queryAll, queryOne } from '../database'
import { executeRequest, HttpRequest } from '../services/http-executor'

function interpolateEnvVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => vars[key.trim()] ?? `{{${key}}}`)
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

      const interpolatedReq: HttpRequest = {
        ...req,
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

      return { data: await executeRequest(interpolatedReq, { sslVerification, followRedirects, timeout }) }
    } catch (err) {
      return { error: String(err) }
    }
  })
}
