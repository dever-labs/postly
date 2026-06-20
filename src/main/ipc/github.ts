import { ipcMain } from 'electron'
import { queryOne, run } from '../database'
import {
  discoverApis,
  getFileSha,
  commitFile,
  listBranches,
  createBranch,
  getFileContent,
  GitHubSettings
} from '../services/github'
import { startGitHubOAuth } from '../services/scm-oauth'

function getGitHubSettings(): GitHubSettings {
  const row = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['github'])
  if (!row) throw new Error('GitHub settings not configured')
  return JSON.parse(row.value) as GitHubSettings
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

export function registerGitHubHandlers(): void {
  ipcMain.handle('postly:github:sync', async () => {
    try { await discoverApis(getGitHubSettings()); return { data: true } }
    catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:github:branches:list', async (_, args: { owner: string; repo: string }) => {
    try {
      const settings = getGitHubSettings()
      return { data: await listBranches(settings.token, args.owner, args.repo) }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:github:branch:create', async (_, args: { owner: string; repo: string; newBranch: string; fromBranch: string }) => {
    try {
      const settings = getGitHubSettings()
      await createBranch(settings.token, args.owner, args.repo, args.newBranch, args.fromBranch)
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:github:commit', async (_, args: { requestId: string; source: string; commitMessage: string; branch: string; content: string }) => {
    try {
      const settings = getGitHubSettings()
      const request = queryOne<Record<string, unknown>>('SELECT * FROM requests WHERE id = ?', [args.requestId])
      if (!request) return { error: 'Request not found' }

      const scmPath = String(request['scm_path'] ?? '')
      if (!scmPath) return { error: 'Request has no scm_path' }

      const [owner, repo] = args.source.split('/')
      const latestSha = await getFileSha(settings.token, owner, repo, scmPath, args.branch)
      await commitFile(settings.token, owner, repo, scmPath, args.content, latestSha, args.commitMessage, args.branch)
      run('UPDATE requests SET scm_sha = ?, is_dirty = 0, updated_at = ? WHERE id = ?', [latestSha, Date.now(), args.requestId])
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:github:diff', async (_, args: { requestId: string }) => {
    try {
      const settings = getGitHubSettings()
      const request = queryOne<Record<string, unknown>>('SELECT * FROM requests WHERE id = ?', [args.requestId])
      if (!request) return { error: 'Request not found' }

      const scmPath = String(request['scm_path'] ?? '')
      const localContent = String(request['body_content'] ?? '')
      const sourceMeta = getRootSourceMeta(String(request['folder_id']))
      const [owner, repo] = (sourceMeta.repo ?? '/').split('/')

      const remoteContent = await getFileContent(settings.token, owner, repo, scmPath, 'main')
      return { data: { localContent, remoteContent, hasChanges: localContent !== remoteContent } }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:github:oauth', async (_, args: { baseUrl: string; clientId: string; clientSecret: string }) => {
    try {
      const result = await startGitHubOAuth(args)
      const existing = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['github'])
      const current = existing ? JSON.parse(existing.value) : {}
      run('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
        ['github', JSON.stringify({ ...current, ...args, token: result.token, connectedUser: result.user }), Date.now()])
      return { data: { user: result.user } }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:github:disconnect', async () => {
    try {
      const existing = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['github'])
      const current = existing ? JSON.parse(existing.value) : {}
      run('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
        ['github', JSON.stringify({ ...current, token: '', connectedUser: undefined }), Date.now()])
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })
}
