import { ipcMain } from 'electron'
import crypto from 'crypto'
import { queryAll, queryOne, run } from '../database'
import * as gitLocal from '../services/git-local'

interface FolderRow {
  id: string
  parent_id: string | null
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

interface FolderCreateArgs {
  parentId?: string
  name: string
  source?: string
  integrationId?: string
}

interface FolderUpdateArgs {
  id: string
  name?: string
  description?: string
  authType?: string
  authConfig?: Record<string, string>
  sslVerification?: string
  collapsed?: boolean
  parentId?: string | null
  sortOrder?: number
  hidden?: boolean
  source?: string
  sourceMeta?: Record<string, string>
  integrationId?: string | null
}

function listFolders() {
  return queryAll('SELECT * FROM folders ORDER BY sort_order ASC, created_at ASC')
}

function createFolder(args: FolderCreateArgs) {
  const id = crypto.randomUUID()
  const now = Date.now()
  run(
    `INSERT INTO folders
      (id, parent_id, name, source, source_meta, integration_id, auth_type, auth_config,
       ssl_verification, hidden, collapsed, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, ?, 'none', '{}', 'inherit', 0, 0, 0, ?, ?)`,
    [id, args.parentId ?? null, args.name, args.source ?? 'local', args.integrationId ?? null, now, now]
  )
  return queryOne('SELECT * FROM folders WHERE id = ?', [id])
}

async function deleteFolder(args: { id: string; commitMessage?: string }) {
  const folder = queryOne<FolderRow>('SELECT * FROM folders WHERE id = ?', [args.id])
  if (!folder) return true

  if (!folder.parent_id && ['git', 'github', 'gitlab'].includes(folder.source) && folder.integration_id) {
    try {
      let meta: { fileName?: string } = {}
      try { meta = JSON.parse(folder.source_meta ?? '{}') } catch { /* ignore */ }
      const integration = queryOne<IntegrationRow>(
        'SELECT id, repo, branch FROM integrations WHERE id = ?',
        [folder.integration_id]
      )
      if (integration && meta.fileName) {
        await gitLocal.deleteCollectionFile(
          integration.id,
          meta.fileName,
          integration.branch ?? 'main',
          args.commitMessage ?? `Remove collection: ${folder.name}`
        )
      }
    } catch {
      /* git failure should not block DB deletion */
    }
  }

  run('DELETE FROM folders WHERE id = ?', [args.id])
  return true
}

function updateFolder(args: FolderUpdateArgs) {
  const fields: string[] = []
  const values: unknown[] = []

  if (args.name !== undefined) { fields.push('name = ?'); values.push(args.name) }
  if (args.description !== undefined) { fields.push('description = ?'); values.push(args.description) }
  if (args.authType !== undefined) { fields.push('auth_type = ?'); values.push(args.authType) }
  if (args.authConfig !== undefined) { fields.push('auth_config = ?'); values.push(JSON.stringify(args.authConfig)) }
  if (args.sslVerification !== undefined) { fields.push('ssl_verification = ?'); values.push(args.sslVerification) }
  if (args.collapsed !== undefined) { fields.push('collapsed = ?'); values.push(args.collapsed ? 1 : 0) }
  if (args.parentId !== undefined) { fields.push('parent_id = ?'); values.push(args.parentId ?? null) }
  if (args.sortOrder !== undefined) { fields.push('sort_order = ?'); values.push(args.sortOrder) }
  if (args.hidden !== undefined) { fields.push('hidden = ?'); values.push(args.hidden ? 1 : 0) }
  if (args.source !== undefined) { fields.push('source = ?'); values.push(args.source) }
  if (args.sourceMeta !== undefined) { fields.push('source_meta = ?'); values.push(JSON.stringify(args.sourceMeta)) }
  if (args.integrationId !== undefined) { fields.push('integration_id = ?'); values.push(args.integrationId ?? null) }
  if (fields.length === 0) return true

  fields.push('updated_at = ?')
  values.push(Date.now(), args.id)
  run(`UPDATE folders SET ${fields.join(', ')} WHERE id = ?`, values)
  return true
}

export function registerCollectionHandlers(): void {
  const handleList = async () => {
    try {
      return { data: listFolders() }
    } catch (err) {
      return { error: String(err) }
    }
  }

  const handleCreate = async (_: unknown, args: FolderCreateArgs) => {
    try {
      return { data: createFolder(args) }
    } catch (err) {
      return { error: String(err) }
    }
  }

  const handleDelete = async (_: unknown, args: { id: string; commitMessage?: string }) => {
    try {
      return { data: await deleteFolder(args) }
    } catch (err) {
      return { error: String(err) }
    }
  }

  const handleRename = async (_: unknown, args: { id: string; name: string }) => {
    try {
      run('UPDATE folders SET name = ?, updated_at = ? WHERE id = ?', [args.name, Date.now(), args.id])
      return { data: true }
    } catch (err) {
      return { error: String(err) }
    }
  }

  const handleUpdate = async (_: unknown, args: FolderUpdateArgs) => {
    try {
      return { data: updateFolder(args) }
    } catch (err) {
      return { error: String(err) }
    }
  }

  const handleReorder = async (_: unknown, args: {
    type: 'request' | 'folder' | 'group'
    updates: Array<{ id: string; sortOrder: number; newParentId?: string | null }>
  }) => {
    try {
      const now = Date.now()
      for (const update of args.updates) {
        if (args.type === 'request') {
          const fields = ['sort_order = ?', 'updated_at = ?']
          const values: unknown[] = [update.sortOrder, now]
          if (update.newParentId !== undefined) {
            fields.unshift('folder_id = ?')
            values.unshift(update.newParentId)
          }
          run(`UPDATE requests SET ${fields.join(', ')} WHERE id = ?`, [...values, update.id])
        } else {
          const fields = ['sort_order = ?', 'updated_at = ?']
          const values: unknown[] = [update.sortOrder, now]
          if (update.newParentId !== undefined) {
            fields.unshift('parent_id = ?')
            values.unshift(update.newParentId)
          }
          run(`UPDATE folders SET ${fields.join(', ')} WHERE id = ?`, [...values, update.id])
        }
      }
      return { data: true }
    } catch (err) {
      return { error: String(err) }
    }
  }

  const handleMoveSource = async (_: unknown, args: { id: string; source: string }) => {
    try {
      run('UPDATE folders SET source = ?, updated_at = ? WHERE id = ?', [args.source, Date.now(), args.id])
      return { data: true }
    } catch (err) {
      return { error: String(err) }
    }
  }

  ipcMain.handle('postly:folders:list', handleList)
  ipcMain.handle('postly:folders:create', handleCreate)
  ipcMain.handle('postly:folders:delete', handleDelete)
  ipcMain.handle('postly:folders:rename', handleRename)
  ipcMain.handle('postly:folders:update', handleUpdate)
  ipcMain.handle('postly:folders:move-source', handleMoveSource)
  ipcMain.handle('postly:reorder', handleReorder)

  ipcMain.handle('postly:collections:list', handleList)
  ipcMain.handle('postly:collections:create', handleCreate)
  ipcMain.handle('postly:collections:delete', handleDelete)
  ipcMain.handle('postly:collections:rename', handleRename)
  ipcMain.handle('postly:collections:update', handleUpdate)
  ipcMain.handle('postly:collections:move-source', handleMoveSource)

  ipcMain.handle('postly:groups:create', async (_event, args: { collectionId?: string; parentId?: string; name: string; description?: string }) => {
    try {
      return {
        data: createFolder({
          parentId: args.parentId ?? args.collectionId,
          name: args.name,
          source: 'local',
        }),
      }
    } catch (err) {
      return { error: String(err) }
    }
  })
  ipcMain.handle('postly:groups:delete', async (_event, args: { id: string }) => {
    try {
      return { data: await deleteFolder({ id: args.id }) }
    } catch (err) {
      return { error: String(err) }
    }
  })
  ipcMain.handle('postly:groups:update', async (_event, args: {
    id: string
    collapsed?: boolean
    hidden?: boolean
    name?: string
    description?: string
    authType?: string
    authConfig?: Record<string, string>
    sslVerification?: string
    sortOrder?: number
    collectionId?: string
    parentId?: string | null
  }) => {
    try {
      return {
        data: updateFolder({
          ...args,
          parentId: args.parentId ?? args.collectionId,
        }),
      }
    } catch (err) {
      return { error: String(err) }
    }
  })
}
