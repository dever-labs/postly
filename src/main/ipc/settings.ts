import { ipcMain } from 'electron'
import { queryAll, queryOne, run } from '../database'
import { parseProxySettings, toPublicProxySettings } from '../services/proxy'

const DEFAULTS = {
  general: { theme: 'dark', defaultTimeout: 30000, followRedirects: true, sslVerification: true, autoUpdate: true, historyEnabled: true, historyLimit: 500, cookiesEnabled: true },
  backstage: { baseUrl: '', token: '', autoSync: false },
  github: { token: '', orgs: [] as string[] },
  gitlab: { baseUrl: 'https://gitlab.com', token: '', groups: [] as string[] },
  ai: { provider: 'openai', apiKey: '', model: '' }
}

const SECRET_FIELDS: Record<string, string[]> = {
  backstage: ['token'],
  github: ['token', 'clientSecret'],
  gitlab: ['token'],
}

function flagName(field: string): string {
  return `has${field[0].toUpperCase()}${field.slice(1)}`
}

function toPublicSettings(key: string, value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  const fields = SECRET_FIELDS[key]
  if (!fields) return value

  const out = { ...(value as Record<string, unknown>) }
  for (const field of fields) {
    out[flagName(field)] = typeof out[field] === 'string' && out[field] !== ''
    out[field] = ''
  }
  return out
}

function mergeSecretSettings(key: string, incoming: unknown, existingRaw: string | undefined): unknown {
  if (!incoming || typeof incoming !== 'object') return incoming
  const fields = SECRET_FIELDS[key]
  if (!fields) return incoming

  const next = { ...(incoming as Record<string, unknown>) }
  const existing = existingRaw ? JSON.parse(existingRaw) as Record<string, unknown> : {}
  for (const field of fields) {
    const hasFlag = next[flagName(field)] === true
    const clearFlag = next[flagName(field)] === false
    const newValue = next[field]

    if (typeof newValue === 'string' && newValue !== '') {
      // explicit replacement
    } else if (clearFlag) {
      next[field] = ''
    } else if (hasFlag || newValue === '' || newValue === undefined) {
      next[field] = typeof existing[field] === 'string' ? existing[field] : ''
    }

    delete next[flagName(field)]
  }
  return next
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('postly:settings:get', async (_, args: { key: string }) => {
    try {
      const row = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', [args.key])
      if (args.key === 'proxy') return { data: row ? toPublicProxySettings(parseProxySettings(row.value)) : null }
      return { data: row ? toPublicSettings(args.key, JSON.parse(row.value)) : null }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:settings:set', async (_, args: { key: string; value: unknown }) => {
    try {
      if (args.key === 'proxy') return { error: 'Use postly:proxy:set for proxy settings' }
      const existing = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', [args.key])
      run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [args.key, JSON.stringify(mergeSecretSettings(args.key, args.value, existing?.value))])
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:settings:get-all', async () => {
    try {
      const parsed: Record<string, unknown> = {}
      for (const row of queryAll<{ key: string; value: string }>('SELECT key, value FROM settings')) {
        if (row.key === 'proxy') { parsed[row.key] = toPublicProxySettings(parseProxySettings(row.value)); continue }
        try { parsed[row.key] = toPublicSettings(row.key, JSON.parse(row.value)) } catch { parsed[row.key] = row.value }
      }
      return {
        data: {
          general: { ...DEFAULTS.general, ...(parsed['general'] as object ?? {}) },
          backstage: { ...DEFAULTS.backstage, ...(parsed['backstage'] as object ?? {}) },
          github: { ...DEFAULTS.github, ...(parsed['github'] as object ?? {}) },
          gitlab: { ...DEFAULTS.gitlab, ...(parsed['gitlab'] as object ?? {}) },
          ai: { ...DEFAULTS.ai, ...(parsed['ai'] as object ?? {}) }
        }
      }
    } catch (err) { return { error: String(err) } }
  })
}
