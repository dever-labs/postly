import { ipcMain } from 'electron'
import { queryOne, run } from '../database'
import {
  discoverApis,
  getFileSha,
  commitFile,
  listBranches,
  createBranch,
  getFileContent,
  GitLabSettings
} from '../services/gitlab'
import { startGitLabOAuth } from '../services/scm-oauth'

function getGitLabSettings(): GitLabSettings {
  const row = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['gitlab'])
  if (!row) throw new Error('GitLab settings not configured')
  return JSON.parse(row.value) as GitLabSettings
}

function getRootSourceMeta(folderId: string): Record<string, string> {
  const row = queryOne<{ source_meta: string | null }>(
    `WITH RECURSIVE lineage AS (
       SELECT id, parent_id, source_meta FROM folders WHERE id = ?
       UNION ALL
       SELECT f.id, f.parent_id, f.source_meta
       FROM folders f
       JOIN lineage l ON l.parent_id = f.id
     )
     SELECT source_meta FROM lineage WHERE parent_id IS NULL LIMIT 1`,
    [folderId]
  )
  return row?.source_meta ? JSON.parse(row.source_meta) : {}
}

export function registerGitLabHandlers(): void {
  ipcMain.handle('postly:gitlab:sync', async () => {
    try { await discoverApis(getGitLabSettings()); return { data: true } }
    catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:gitlab:branches:list', async (_, args: { projectId: string }) => {
    try {
      const settings = getGitLabSettings()
      return { data: await listBranches(settings.token, settings.baseUrl, args.projectId) }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:gitlab:branch:create', async (_, args: { projectId: string; newBranch: string; fromBranch: string }) => {
    try {
      const settings = getGitLabSettings()
      await createBranch(settings.token, settings.baseUrl, args.projectId, args.newBranch, args.fromBranch)
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:gitlab:commit', async (_, args: { requestId: string; projectId: string; commitMessage: string; branch: string; content: string }) => {
    try {
      const settings = getGitLabSettings()
      const request = queryOne<Record<string, unknown>>('SELECT * FROM requests WHERE id = ?', [args.requestId])
      if (!request) return { error: 'Request not found' }

      const scmPath = String(request['scm_path'] ?? '')
      if (!scmPath) return { error: 'Request has no scm_path' }

      const latestSha = await getFileSha(settings.token, settings.baseUrl, args.projectId, scmPath, args.branch)
      await commitFile(settings.token, settings.baseUrl, args.projectId, scmPath, args.content, latestSha, args.commitMessage, args.branch)
      run('UPDATE requests SET scm_sha = ?, is_dirty = 0, updated_at = ? WHERE id = ?', [latestSha, Date.now(), args.requestId])
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:gitlab:diff', async (_, args: { requestId: string }) => {
    try {
      const settings = getGitLabSettings()
      const request = queryOne<Record<string, unknown>>('SELECT * FROM requests WHERE id = ?', [args.requestId])
      if (!request) return { error: 'Request not found' }

      const scmPath = String(request['scm_path'] ?? '')
      const localContent = String(request['body_content'] ?? '')
      const sourceMeta = getRootSourceMeta(String(request['folder_id']))
      const projectId = String(sourceMeta.projectId ?? '')

      const remoteContent = await getFileContent(settings.token, settings.baseUrl, projectId, scmPath, 'main')
      return { data: { localContent, remoteContent, hasChanges: localContent !== remoteContent } }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:gitlab:oauth', async (_, args: { baseUrl: string; clientId: string }) => {
    try {
      const result = await startGitLabOAuth(args)
      const existing = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['gitlab'])
      const current = existing ? JSON.parse(existing.value) : {}
      run('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
        ['gitlab', JSON.stringify({ ...current, ...args, token: result.token, connectedUser: result.user }), Date.now()])
      return { data: { user: result.user } }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:gitlab:disconnect', async () => {
    try {
      const existing = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['gitlab'])
      const current = existing ? JSON.parse(existing.value) : {}
      run('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
        ['gitlab', JSON.stringify({ ...current, token: '', connectedUser: undefined }), Date.now()])
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })
}
