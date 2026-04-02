import { ipcMain } from 'electron'
import crypto from 'crypto'
import { queryAll, queryOne, run } from '../database'
import * as gitLocal from '../services/git-local'

interface CollectionRow {
  id: string
  name: string
  source: string
  source_meta: string | null
  integration_id: string | null
}

interface IntegrationRow {
  id: string
  repo: string
  branch: string | null
}

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

  ipcMain.handle('postly:collections:create', async (_, args: { name: string; source?: string; integrationId?: string }) => {
    try {
      const id = crypto.randomUUID()
      const now = Date.now()
      const source = args.source ?? 'local'
      run(
        'INSERT INTO collections (id, name, source, integration_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, args.name, source, args.integrationId ?? null, now, now]
      )
      return { data: queryOne('SELECT * FROM collections WHERE id = ?', [id]) }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('postly:collections:delete', async (_, args: { id: string; commitMessage?: string }) => {
    try {
      const collection = queryOne<CollectionRow>('SELECT * FROM collections WHERE id = ?', [args.id])
      if (collection?.source === 'git' && collection.integration_id) {
        try {
          let meta: { fileName?: string } = {}
          try { meta = JSON.parse(collection.source_meta ?? '{}') } catch { /* ignore */ }
          const integration = queryOne<IntegrationRow>(
            'SELECT id, repo, branch FROM integrations WHERE id = ?',
            [collection.integration_id]
          )
          if (integration && meta.fileName) {
            await gitLocal.deleteCollectionFile(
              integration.id,
              meta.fileName,
              integration.branch ?? 'main',
              args.commitMessage ?? `Remove collection: ${collection.name}`
            )
          }
        } catch { /* git failure should not block DB deletion */ }
      }
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
    'postly:collections:update',
    async (_, args: { id: string; name?: string; description?: string; authType?: string; authConfig?: Record<string, string>; sslVerification?: string; collapsed?: boolean }) => {
      try {
        const fields: string[] = []
        const values: unknown[] = []

        if (args.name !== undefined) { fields.push('name = ?'); values.push(args.name) }
        if (args.description !== undefined) { fields.push('description = ?'); values.push(args.description) }
        if (args.authType !== undefined) { fields.push('auth_type = ?'); values.push(args.authType) }
        if (args.authConfig !== undefined) { fields.push('auth_config = ?'); values.push(JSON.stringify(args.authConfig)) }
        if (args.sslVerification !== undefined) { fields.push('ssl_verification = ?'); values.push(args.sslVerification) }
        if (args.collapsed !== undefined) { fields.push('collapsed = ?'); values.push(args.collapsed ? 1 : 0) }
        if (fields.length === 0) return { data: true }

        fields.push('updated_at = ?')
        values.push(Date.now(), args.id)

        run(`UPDATE collections SET ${fields.join(', ')} WHERE id = ?`, values)
        return { data: true }
      } catch (err) {
        return { error: String(err) }
      }
    }
  )

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
    async (_, args: { id: string; collapsed?: boolean; hidden?: boolean; name?: string; description?: string; authType?: string; authConfig?: Record<string, string>; sslVerification?: string; sortOrder?: number; collectionId?: string }) => {
      try {
        const fields: string[] = []
        const values: unknown[] = []

        if (args.name !== undefined) { fields.push('name = ?'); values.push(args.name) }
        if (args.collapsed !== undefined) { fields.push('collapsed = ?'); values.push(args.collapsed ? 1 : 0) }
        if (args.hidden !== undefined) { fields.push('hidden = ?'); values.push(args.hidden ? 1 : 0) }
        if (args.description !== undefined) { fields.push('description = ?'); values.push(args.description) }
        if (args.authType !== undefined) { fields.push('auth_type = ?'); values.push(args.authType) }
        if (args.authConfig !== undefined) { fields.push('auth_config = ?'); values.push(JSON.stringify(args.authConfig)) }
        if (args.sslVerification !== undefined) { fields.push('ssl_verification = ?'); values.push(args.sslVerification) }
        if (args.sortOrder !== undefined) { fields.push('sort_order = ?'); values.push(args.sortOrder) }
        if (args.collectionId !== undefined) { fields.push('collection_id = ?'); values.push(args.collectionId) }
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

  ipcMain.handle('postly:reorder', async (_, args: {
    type: 'request' | 'group'
    updates: Array<{ id: string; sortOrder: number; newParentId?: string }>
  }) => {
    try {
      const now = Date.now()
      for (const u of args.updates) {
        if (args.type === 'request') {
          const fields = ['sort_order = ?', 'updated_at = ?']
          const vals: unknown[] = [u.sortOrder, now]
          if (u.newParentId !== undefined) { fields.unshift('group_id = ?'); vals.unshift(u.newParentId) }
          run(`UPDATE requests SET ${fields.join(', ')} WHERE id = ?`, [...vals, u.id])
        } else {
          const fields = ['sort_order = ?', 'updated_at = ?']
          const vals: unknown[] = [u.sortOrder, now]
          if (u.newParentId !== undefined) { fields.unshift('collection_id = ?'); vals.unshift(u.newParentId) }
          run(`UPDATE groups SET ${fields.join(', ')} WHERE id = ?`, [...vals, u.id])
        }
      }
      return { data: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('postly:collections:move-source', async (_, args: { id: string; source: string }) => {
    try {
      run('UPDATE collections SET source = ?, updated_at = ? WHERE id = ?', [args.source, Date.now(), args.id])
      return { data: true }
    } catch (err) {
      return { error: String(err) }
    }
  })
}
