import { ipcMain } from 'electron'
import { queryOne, queryAll, run } from '../database'
import * as github from '../services/github'
import * as gitlab from '../services/gitlab'

interface IntegrationRow {
  id: string
  type: string
  base_url: string
  token: string
  repo: string
  branch: string
}

interface RequestRow {
  id: string
  group_id: string
  scm_path: string
  scm_sha: string
  body_content: string
  is_dirty: number
}

interface GroupRow {
  collection_id: string
}

interface CollectionRow {
  source_meta: string
  source: string
}

function getIntegration(id: string): IntegrationRow {
  const row = queryOne<IntegrationRow>('SELECT * FROM integrations WHERE id = ?', [id])
  if (!row) throw new Error('Integration not found')
  return row
}

function getSourceMetaForRequest(requestId: string): {
  source: string
  sourceMeta: Record<string, string>
  integration: IntegrationRow | null
} {
  const request = queryOne<RequestRow>('SELECT * FROM requests WHERE id = ?', [requestId])
  if (!request) throw new Error('Request not found')

  const group = queryOne<GroupRow>('SELECT collection_id FROM groups WHERE id = ?', [request.group_id])
  const collection = group
    ? queryOne<CollectionRow>('SELECT source, source_meta FROM collections WHERE id = ?', [group.collection_id])
    : undefined
  const sourceMeta: Record<string, string> = collection?.source_meta
    ? JSON.parse(collection.source_meta)
    : {}
  const source = collection?.source ?? ''

  // Try to find matching integration via integrationId on collection or by source type
  const colFull = group
    ? queryOne<{ integration_id?: string }>('SELECT integration_id FROM collections WHERE id = ?', [group.collection_id])
    : undefined
  const integration = colFull?.integration_id
    ? queryOne<IntegrationRow>('SELECT * FROM integrations WHERE id = ?', [colFull.integration_id])
    : source === 'github' || source === 'gitlab'
    ? queryOne<IntegrationRow>(
        `SELECT * FROM integrations WHERE type = ? ORDER BY updated_at DESC LIMIT 1`,
        [source]
      )
    : null

  return { source, sourceMeta, integration }
}

export function registerGitHandlers(): void {
  // ── List branches ────────────────────────────────────────────────────────────

  ipcMain.handle('postly:git:branches:list', async (_, args: { integrationId: string }) => {
    try {
      const integration = getIntegration(args.integrationId)
      if (integration.type === 'github') {
        const [owner, repo] = integration.repo.split('/')
        return { data: await github.listBranches(integration.token, owner, repo) }
      } else if (integration.type === 'gitlab') {
        // repo field holds "projectId" for GitLab integrations
        return { data: await gitlab.listBranches(integration.token, integration.base_url, integration.repo) }
      }
      return { data: [] }
    } catch (err) { return { error: String(err) } }
  })

  // ── Create branch ────────────────────────────────────────────────────────────

  ipcMain.handle('postly:git:branch:create', async (_, args: {
    integrationId: string; newBranch: string; fromBranch: string
  }) => {
    try {
      const integration = getIntegration(args.integrationId)
      if (integration.type === 'github') {
        const [owner, repo] = integration.repo.split('/')
        await github.createBranch(integration.token, owner, repo, args.newBranch, args.fromBranch)
      } else if (integration.type === 'gitlab') {
        await gitlab.createBranch(integration.token, integration.base_url, integration.repo, args.newBranch, args.fromBranch)
      }
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  // ── Switch branch (persists on integration row) ──────────────────────────────

  ipcMain.handle('postly:git:branch:switch', async (_, args: { integrationId: string; branch: string }) => {
    try {
      run('UPDATE integrations SET branch = ?, updated_at = ? WHERE id = ?', [args.branch, Date.now(), args.integrationId])
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  // ── Sync / pull (re-discover APIs from remote) ───────────────────────────────

  ipcMain.handle('postly:git:sync', async (_, args: { integrationId: string }) => {
    try {
      const row = queryOne<{ value: string; type: string } & IntegrationRow>(
        'SELECT * FROM integrations WHERE id = ?',
        [args.integrationId]
      )
      if (!row) return { error: 'Integration not found' }

      if (row.type === 'github') {
        const settings: github.GitHubSettings = {
          baseUrl: row.base_url,
          clientId: '',
          clientSecret: '',
          token: row.token,
          repo: row.repo,
          orgs: [row.repo.split('/')[0]],
        }
        await github.discoverApis(settings)
      } else if (row.type === 'gitlab') {
        const settings: gitlab.GitLabSettings = {
          baseUrl: row.base_url,
          clientId: '',
          token: row.token,
          repo: row.repo,
          groups: [],
        }
        await gitlab.discoverApis(settings)
      }
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  // ── Diff ─────────────────────────────────────────────────────────────────────

  ipcMain.handle('postly:git:diff', async (_, args: { requestId: string }) => {
    try {
      const request = queryOne<RequestRow>('SELECT * FROM requests WHERE id = ?', [args.requestId])
      if (!request) return { error: 'Request not found' }

      const { source, sourceMeta, integration } = getSourceMetaForRequest(args.requestId)
      if (!integration) return { error: 'No integration found for this collection' }

      const scmPath = request.scm_path ?? ''
      const localContent = request.body_content ?? ''
      const branch = integration.branch ?? 'main'

      let remoteContent = ''
      if (source === 'github') {
        const [owner, repo] = (sourceMeta.repo ?? integration.repo ?? '/').split('/')
        remoteContent = await github.getFileContent(integration.token, owner, repo, scmPath, branch)
      } else if (source === 'gitlab') {
        const projectId = sourceMeta.projectId ?? integration.repo
        remoteContent = await gitlab.getFileContent(integration.token, integration.base_url, projectId, scmPath, branch)
      }

      return { data: { localContent, remoteContent, hasChanges: localContent !== remoteContent } }
    } catch (err) { return { error: String(err) } }
  })

  // ── Commit ───────────────────────────────────────────────────────────────────

  ipcMain.handle('postly:git:commit', async (_, args: {
    requestId: string
    commitMessage: string
    branch: string
    fromBranch?: string
    content: string
  }) => {
    try {
      const request = queryOne<RequestRow>('SELECT * FROM requests WHERE id = ?', [args.requestId])
      if (!request) return { error: 'Request not found' }

      const scmPath = request.scm_path ?? ''
      if (!scmPath) return { error: 'Request has no scm_path' }

      const { source, sourceMeta, integration } = getSourceMetaForRequest(args.requestId)
      if (!integration) return { error: 'No integration found for this collection' }

      // Create new branch first if needed
      if (args.fromBranch && args.branch !== args.fromBranch) {
        if (source === 'github') {
          const [owner, repo] = (sourceMeta.repo ?? integration.repo).split('/')
          await github.createBranch(integration.token, owner, repo, args.branch, args.fromBranch)
        } else if (source === 'gitlab') {
          const projectId = sourceMeta.projectId ?? integration.repo
          await gitlab.createBranch(integration.token, integration.base_url, projectId, args.branch, args.fromBranch)
        }
      }

      let newSha = ''
      if (source === 'github') {
        const [owner, repo] = (sourceMeta.repo ?? integration.repo).split('/')
        const latestSha = await github.getFileSha(integration.token, owner, repo, scmPath, args.branch)
        await github.commitFile(integration.token, owner, repo, scmPath, args.content, latestSha, args.commitMessage, args.branch)
        newSha = latestSha
      } else if (source === 'gitlab') {
        const projectId = sourceMeta.projectId ?? integration.repo
        const latestSha = await gitlab.getFileSha(integration.token, integration.base_url, projectId, scmPath, args.branch)
        await gitlab.commitFile(integration.token, integration.base_url, projectId, scmPath, args.content, latestSha, args.commitMessage, args.branch)
        newSha = latestSha
      }

      run('UPDATE requests SET scm_sha = ?, is_dirty = 0, updated_at = ? WHERE id = ?', [newSha, Date.now(), args.requestId])
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  // ── List dirty requests for a collection ────────────────────────────────────

  ipcMain.handle('postly:git:dirty-requests', async (_, args: { collectionId: string }) => {
    try {
      const rows = queryAll<RequestRow & { group_name: string; request_name: string }>(
        `SELECT r.id, r.group_id, r.scm_path, r.name as request_name, g.name as group_name
         FROM requests r
         JOIN groups g ON g.id = r.group_id
         WHERE g.collection_id = ? AND r.is_dirty = 1`,
        [args.collectionId]
      )
      return { data: rows }
    } catch (err) { return { error: String(err) } }
  })
}
