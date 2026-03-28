import { ipcMain } from 'electron'
import { queryAll, queryOne, run } from '../database'

const DEFAULTS = {
  general: { theme: 'dark', defaultTimeout: 30000, followRedirects: true, sslVerification: true },
  backstage: { baseUrl: '', token: '', autoSync: false },
  github: { token: '', orgs: [] as string[] },
  gitlab: { baseUrl: 'https://gitlab.com', token: '', groups: [] as string[] }
}

export function registerSettingsHandlers(): void {
  ipcMain.handle('postly:settings:get', async (_, args: { key: string }) => {
    try {
      const row = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', [args.key])
      return { data: row ? JSON.parse(row.value) : null }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:settings:set', async (_, args: { key: string; value: unknown }) => {
    try {
      run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [args.key, JSON.stringify(args.value)])
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:settings:get-all', async () => {
    try {
      const parsed: Record<string, unknown> = {}
      for (const row of queryAll<{ key: string; value: string }>('SELECT key, value FROM settings')) {
        try { parsed[row.key] = JSON.parse(row.value) } catch { parsed[row.key] = row.value }
      }
      return {
        data: {
          general: { ...DEFAULTS.general, ...(parsed['general'] as object ?? {}) },
          backstage: { ...DEFAULTS.backstage, ...(parsed['backstage'] as object ?? {}) },
          github: { ...DEFAULTS.github, ...(parsed['github'] as object ?? {}) },
          gitlab: { ...DEFAULTS.gitlab, ...(parsed['gitlab'] as object ?? {}) }
        }
      }
    } catch (err) { return { error: String(err) } }
  })
}
