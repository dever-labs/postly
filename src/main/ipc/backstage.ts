import { ipcMain } from 'electron'
import { queryOne } from '../database'
import { syncCatalog, BackstageSettings } from '../services/backstage'

export function registerBackstageHandlers(): void {
  ipcMain.handle('postly:backstage:sync', async () => {
    try {
      const row = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['backstage'])
      if (!row) return { error: 'Backstage settings not configured' }
      await syncCatalog(JSON.parse(row.value) as BackstageSettings)
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })
}
