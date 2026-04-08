import { ipcMain } from 'electron'
import { queryOne, run } from '../database'
import { syncCatalog, authenticateWithBackstage, BackstageSettings } from '../services/backstage'

export function registerBackstageHandlers(): void {
  ipcMain.handle('postly:backstage:sync', async () => {
    try {
      const row = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['backstage'])
      if (!row) return { error: 'Backstage settings not configured' }
      const result = await syncCatalog(JSON.parse(row.value) as BackstageSettings)
      return { data: result }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:backstage:auth', async (_, args: { baseUrl: string; provider: string }) => {
    try {
      const result = await authenticateWithBackstage(args.baseUrl, args.provider)
      const existing = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['backstage'])
      const current: BackstageSettings = existing ? JSON.parse(existing.value) : { baseUrl: args.baseUrl, token: '', autoSync: false }
      run(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
        ['backstage', JSON.stringify({ ...current, baseUrl: args.baseUrl, authProvider: args.provider, token: result.token, connectedUser: result.user })]
      )
      return { data: { user: result.user } }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:backstage:disconnect', async () => {
    try {
      const existing = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['backstage'])
      const current: BackstageSettings = existing ? JSON.parse(existing.value) : { baseUrl: '', token: '', autoSync: false }
      run(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
        ['backstage', JSON.stringify({ ...current, token: '', connectedUser: undefined })]
      )
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })
}
