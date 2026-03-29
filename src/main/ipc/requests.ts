import { ipcMain } from 'electron'
import crypto from 'crypto'
import { queryAll, queryOne, run } from '../database'

const CAMEL_TO_SNAKE: Record<string, string> = {
  name: 'name',
  method: 'method',
  url: 'url',
  params: 'params',
  headers: 'headers',
  bodyType: 'body_type',
  bodyContent: 'body_content',
  authType: 'auth_type',
  authConfig: 'auth_config',
  description: 'description',
  scmPath: 'scm_path',
  scmSha: 'scm_sha',
  isDirty: 'is_dirty',
  sortOrder: 'sort_order',
  sslVerification: 'ssl_verification',
  protocol: 'protocol',
  protocolConfig: 'protocol_config',
}

export function registerRequestHandlers(): void {
  ipcMain.handle('postly:requests:list', async (_, args: { groupId: string }) => {
    try {
      return { data: queryAll('SELECT * FROM requests WHERE group_id = ? ORDER BY sort_order ASC', [args.groupId]) }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:requests:get', async (_, args: { id: string }) => {
    try {
      return { data: queryOne('SELECT * FROM requests WHERE id = ?', [args.id]) }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle(
    'postly:requests:create',
    async (_, args: { groupId: string; name?: string; method?: string }) => {
      try {
        const id = crypto.randomUUID()
        const now = Date.now()
        run(
          `INSERT INTO requests (id, group_id, name, method, url, params, headers, body_type, body_content, auth_type, auth_config, is_dirty, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, '', '[]', '[]', 'none', '', 'none', '{}', 0, 0, ?, ?)`,
          [id, args.groupId, args.name ?? 'New Request', args.method ?? 'GET', now, now]
        )
        return { data: queryOne('SELECT * FROM requests WHERE id = ?', [id]) }
      } catch (err) { return { error: String(err) } }
    }
  )

  ipcMain.handle('postly:requests:update', async (_, args: Record<string, unknown>) => {
    try {
      const id = args['id'] as string
      const fields: string[] = []
      const values: unknown[] = []

      for (const [camel, snake] of Object.entries(CAMEL_TO_SNAKE)) {
        if (args[camel] !== undefined) { fields.push(`${snake} = ?`); values.push(args[camel]) }
      }
      if (fields.length === 0) return { data: true }

      fields.push('updated_at = ?')
      values.push(Date.now(), id)
      run(`UPDATE requests SET ${fields.join(', ')} WHERE id = ?`, values)
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:requests:delete', async (_, args: { id: string }) => {
    try {
      run('DELETE FROM requests WHERE id = ?', [args.id])
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:requests:mark-dirty', async (_, args: { id: string; isDirty: boolean }) => {
    try {
      run('UPDATE requests SET is_dirty = ?, updated_at = ? WHERE id = ?',
        [args.isDirty ? 1 : 0, Date.now(), args.id])
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })
}
