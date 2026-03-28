import { ipcMain } from 'electron'
import crypto from 'crypto'
import { queryAll, queryOne, run } from '../database'

export function registerEnvironmentHandlers(): void {
  ipcMain.handle('postly:environments:list', async () => {
    try {
      return { data: {
        environments: queryAll('SELECT * FROM environments ORDER BY created_at ASC'),
        vars: queryAll('SELECT * FROM env_vars')
      }}
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:environments:create', async (_, args: { name: string }) => {
    try {
      const id = crypto.randomUUID(); const now = Date.now()
      run('INSERT INTO environments (id, name, is_active, created_at, updated_at) VALUES (?, ?, 0, ?, ?)',
        [id, args.name, now, now])
      return { data: queryOne('SELECT * FROM environments WHERE id = ?', [id]) }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:environments:rename', async (_, args: { id: string; name: string }) => {
    try {
      run('UPDATE environments SET name = ?, updated_at = ? WHERE id = ?', [args.name, Date.now(), args.id])
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:environments:delete', async (_, args: { id: string }) => {
    try {
      run('DELETE FROM environments WHERE id = ?', [args.id])
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:environments:set-active', async (_, args: { id: string }) => {
    try {
      run('UPDATE environments SET is_active = 0')
      run('UPDATE environments SET is_active = 1, updated_at = ? WHERE id = ?', [Date.now(), args.id])
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:env-vars:list', async (_, args: { envId: string }) => {
    try {
      return { data: queryAll('SELECT * FROM env_vars WHERE env_id = ?', [args.envId]) }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle(
    'postly:env-vars:upsert',
    async (_, args: { envId: string; key: string; value: string; isSecret?: boolean; id?: string }) => {
      try {
        const id = args.id ?? crypto.randomUUID()
        run('INSERT OR REPLACE INTO env_vars (id, env_id, key, value, is_secret) VALUES (?, ?, ?, ?, ?)',
          [id, args.envId, args.key, args.value, args.isSecret ? 1 : 0])
        return { data: queryOne('SELECT * FROM env_vars WHERE id = ?', [id]) }
      } catch (err) { return { error: String(err) } }
    }
  )

  ipcMain.handle('postly:env-vars:delete', async (_, args: { id: string }) => {
    try {
      run('DELETE FROM env_vars WHERE id = ?', [args.id])
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })
}
