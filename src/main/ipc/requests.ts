import { ipcMain } from 'electron'
import crypto from 'crypto'
import { queryAll, queryOne, run } from '../database'
import * as gitLocal from '../services/git-local'
import { buildExport } from './export-import'

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
  groupId: 'group_id',
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

  ipcMain.handle('postly:requests:delete', async (_, args: { id: string; commitMessage?: string; branch?: string }) => {
    try {
      const request = queryOne<{ group_id: string }>('SELECT group_id FROM requests WHERE id = ?', [args.id])
      if (!request) return { data: true }

      const group = request ? queryOne<{ collection_id: string }>('SELECT collection_id FROM groups WHERE id = ?', [request.group_id]) : null
      const collection = group ? queryOne<{ id: string; source: string; source_meta: string | null; integration_id: string | null }>(
        'SELECT id, source, source_meta, integration_id FROM collections WHERE id = ?', [group.collection_id]
      ) : null

      run('DELETE FROM requests WHERE id = ?', [args.id])

      if (collection?.source === 'git' && args.commitMessage && args.branch) {
        try {
          const meta: { integrationId?: string; fileName?: string } = collection.source_meta ? JSON.parse(collection.source_meta) : {}
          const integrationId = collection.integration_id ?? meta.integrationId
          const integration = integrationId
            ? queryOne<{ id: string; repo: string; branch: string | null }>('SELECT id, repo, branch FROM integrations WHERE id = ?', [integrationId])
            : null
          if (integration) {
            const exportData = buildExport([collection.id])
            const col = exportData.collections[0]
            const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'collection'
            const fileName = meta.fileName ?? `${slug(col?.name ?? 'collection')}.postly.json`
            const fileContent = JSON.stringify(
              { $schema: 'postly/v1', exportedAt: new Date().toISOString(), collections: col ? [col] : [] },
              null, 2
            )
            await gitLocal.commitAndPush(integration.id, fileName, fileContent, args.commitMessage, args.branch)
          }
        } catch { /* git failure should not block the delete */ }
      }

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
