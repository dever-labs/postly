import { ipcMain } from 'electron'
import crypto from 'crypto'
import { queryAll, queryOne, run } from '../database'

export function registerCollectionHandlers(): void {
  ipcMain.handle('postly:collections:list', async () => {
    try {
      const collections = queryAll('SELECT * FROM collections ORDER BY created_at ASC')
      const groups = queryAll('SELECT * FROM groups ORDER BY sort_order ASC')
      return { data: { collections, groups } }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('postly:collections:create', async (_, args: { name: string; source?: string }) => {
    try {
      const id = crypto.randomUUID()
      const now = Date.now()
      const source = args.source ?? 'local'
      run('INSERT INTO collections (id, name, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        [id, args.name, source, now, now])
      return { data: queryOne('SELECT * FROM collections WHERE id = ?', [id]) }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('postly:collections:delete', async (_, args: { id: string }) => {
    try {
      run('DELETE FROM collections WHERE id = ?', [args.id])
      return { data: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('postly:collections:rename', async (_, args: { id: string; name: string }) => {
    try {
      run('UPDATE collections SET name = ?, updated_at = ? WHERE id = ?', [args.name, Date.now(), args.id])
      return { data: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle(
    'postly:groups:create',
    async (_, args: { collectionId: string; name: string; description?: string }) => {
      try {
        const id = crypto.randomUUID()
        const now = Date.now()
        run(
          `INSERT INTO groups (id, collection_id, name, description, collapsed, hidden, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?)`,
          [id, args.collectionId, args.name, args.description ?? null, now, now]
        )
        return { data: queryOne('SELECT * FROM groups WHERE id = ?', [id]) }
      } catch (err) {
        return { error: String(err) }
      }
    }
  )

  ipcMain.handle('postly:groups:delete', async (_, args: { id: string }) => {
    try {
      run('DELETE FROM groups WHERE id = ?', [args.id])
      return { data: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle(
    'postly:groups:update',
    async (_, args: { id: string; collapsed?: boolean; hidden?: boolean; name?: string }) => {
      try {
        const fields: string[] = []
        const values: unknown[] = []

        if (args.name !== undefined) { fields.push('name = ?'); values.push(args.name) }
        if (args.collapsed !== undefined) { fields.push('collapsed = ?'); values.push(args.collapsed ? 1 : 0) }
        if (args.hidden !== undefined) { fields.push('hidden = ?'); values.push(args.hidden ? 1 : 0) }
        if (fields.length === 0) return { data: true }

        fields.push('updated_at = ?')
        values.push(Date.now(), args.id)

        run(`UPDATE groups SET ${fields.join(', ')} WHERE id = ?`, values)
        return { data: true }
      } catch (err) {
        return { error: String(err) }
      }
    }
  )
}
