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

function getGitLabSettings(): GitLabSettings {
  const row = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['gitlab'])
  if (!row) throw new Error('GitLab settings not configured')
  return JSON.parse(row.value) as GitLabSettings
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

      const group = queryOne<{ collection_id: string }>('SELECT collection_id FROM groups WHERE id = ?', [String(request['group_id'])])
      const collection = group ? queryOne<{ source_meta: string }>('SELECT source_meta FROM collections WHERE id = ?', [group.collection_id]) : undefined
      const sourceMeta = collection?.source_meta ? JSON.parse(collection.source_meta) : {}
      const projectId = String(sourceMeta.projectId ?? '')

      const remoteContent = await getFileContent(settings.token, settings.baseUrl, projectId, scmPath, 'main')
      return { data: { localContent, remoteContent, hasChanges: localContent !== remoteContent } }
    } catch (err) { return { error: String(err) } }
  })
}
