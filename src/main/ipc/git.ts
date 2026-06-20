import { ipcMain } from 'electron'
import { queryOne, queryAll, run } from '../database'
import * as github from '../services/github'
import * as gitlab from '../services/gitlab'
import * as gitLocal from '../services/git-local'
import { buildExport } from './export-import'

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
  folder_id: string
  name: string
  method: string
  url: string
  params: string
  headers: string
  body_type: string
  body_content: string
  auth_type: string
  auth_config: string
  description: string
  scm_path: string
  scm_sha: string
  is_dirty: number
}

interface FolderRow {
  id: string
  parent_id: string | null
  name: string
  source: string
  source_meta: string | null
  integration_id?: string | null
}

function getIntegration(id: string): IntegrationRow {
  const row = queryOne<IntegrationRow>('SELECT * FROM integrations WHERE id = ?', [id])
  if (!row) throw new Error('Integration not found')
  return row
}

function getRootFolder(folderId: string): FolderRow | null {
  return queryOne<FolderRow>(
    `WITH RECURSIVE lineage AS (
       SELECT id, parent_id, name, source, source_meta, integration_id FROM folders WHERE id = ?
       UNION ALL
       SELECT f.id, f.parent_id, f.name, f.source, f.source_meta, f.integration_id
       FROM folders f
       JOIN lineage l ON l.parent_id = f.id
     )
     SELECT id, parent_id, name, source, source_meta, integration_id
     FROM lineage
     WHERE parent_id IS NULL
     LIMIT 1`,
    [folderId]
  )
}

function getTreeFolderIds(collectionId: string): string[] {
  return queryAll<{ id: string }>(
    `WITH RECURSIVE tree AS (
       SELECT id FROM folders WHERE id = ?
       UNION ALL
       SELECT child.id
       FROM folders child
       JOIN tree parent ON child.parent_id = parent.id
     )
     SELECT id FROM tree`,
    [collectionId]
  ).map((row) => row.id)
}

function clearDirtyForCollection(collectionId: string): void {
  run(
    `WITH RECURSIVE tree AS (
       SELECT id FROM folders WHERE id = ?
       UNION ALL
       SELECT child.id
       FROM folders child
       JOIN tree parent ON child.parent_id = parent.id
     )
     UPDATE requests
     SET is_dirty = 0, updated_at = ?
     WHERE folder_id IN (SELECT id FROM tree)`,
    [collectionId, Date.now()]
  )
}

function getSourceMetaForRequest(requestId: string): {
  source: string
  sourceMeta: Record<string, string>
  integration: IntegrationRow | null
  collection: FolderRow | null
} {
  const request = queryOne<RequestRow>('SELECT * FROM requests WHERE id = ?', [requestId])
  if (!request) throw new Error('Request not found')

  const collection = getRootFolder(request.folder_id)
  const sourceMeta: Record<string, string> = collection?.source_meta ? JSON.parse(collection.source_meta) : {}
  const source = collection?.source ?? ''

  const integrationId = collection?.integration_id ?? sourceMeta.integrationId
  const integration = integrationId
    ? queryOne<IntegrationRow>('SELECT * FROM integrations WHERE id = ?', [integrationId])
    : source === 'github' || source === 'gitlab'
      ? queryOne<IntegrationRow>(
          `SELECT * FROM integrations WHERE type = ? ORDER BY updated_at DESC LIMIT 1`,
          [source]
        )
      : null

  return { source, sourceMeta, integration, collection }
}

export function registerGitHandlers(): void {
  ipcMain.handle('postly:git:current-branch', async (_, args: { integrationId: string }) => {
    try {
      return { data: await gitLocal.getCurrentBranch(args.integrationId) }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:git:branches:list', async (_, args: { integrationId: string }) => {
    try {
      const integration = getIntegration(args.integrationId)
      if (integration.type === 'git') {
        return { data: await gitLocal.listBranches(integration.id) }
      } else if (integration.type === 'github') {
        const [owner, ...repoParts] = integration.repo.split('/')
        return { data: await github.listBranches(integration.token, owner, repoParts.join('/')) }
      } else if (integration.type === 'gitlab') {
        return { data: await gitlab.listBranches(integration.token, integration.base_url, encodeURIComponent(integration.repo)) }
      }
      return { data: [] }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:git:branch:create', async (_, args: {
    integrationId: string; newBranch: string; fromBranch: string
  }) => {
    try {
      const integration = getIntegration(args.integrationId)
      if (integration.type === 'git') {
        await gitLocal.createAndPushBranch(integration.id, args.newBranch, args.fromBranch)
      } else if (integration.type === 'github') {
        const [owner, ...repoParts] = integration.repo.split('/')
        await github.createBranch(integration.token, owner, repoParts.join('/'), args.newBranch, args.fromBranch)
      } else if (integration.type === 'gitlab') {
        await gitlab.createBranch(integration.token, integration.base_url, encodeURIComponent(integration.repo), args.newBranch, args.fromBranch)
      }
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:git:branch:switch', async (_, args: { integrationId: string; branch: string }) => {
    try {
      const integration = getIntegration(args.integrationId)
      if (integration.type === 'git') {
        await gitLocal.switchBranch(integration.id, args.branch)
      }
      run('UPDATE integrations SET branch = ?, updated_at = ? WHERE id = ?', [args.branch, Date.now(), args.integrationId])
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:git:sync', async (_, args: { integrationId: string; collectionId?: string; collectionName?: string }) => {
    try {
      const row = queryOne<IntegrationRow>('SELECT * FROM integrations WHERE id = ?', [args.integrationId])
      if (!row) return { error: 'Integration not found' }

      if (row.type === 'git') {
        await gitLocal.discoverAndImport(row.id, row.repo, row.branch ?? 'main', {
          collectionId: args.collectionId,
          collectionName: args.collectionName,
        })
      } else if (row.type === 'github') {
        const settings: github.GitHubSettings = {
          baseUrl: row.base_url, clientId: '', clientSecret: '',
          token: row.token, repo: row.repo, orgs: [row.repo.split('/')[0]],
        }
        await github.discoverApis(settings)
      } else if (row.type === 'gitlab') {
        const settings: gitlab.GitLabSettings = {
          baseUrl: row.base_url, clientId: '', token: row.token, repo: row.repo, groups: [],
        }
        await gitlab.discoverApis(settings)
      }
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:git:diff', async (_, args: { requestId: string }) => {
    try {
      const request = queryOne<RequestRow>('SELECT * FROM requests WHERE id = ?', [args.requestId])
      if (!request) return { error: 'Request not found' }

      const { source, sourceMeta, integration } = getSourceMetaForRequest(args.requestId)
      if (!integration) return { error: 'No integration found for this collection' }

      const scmPath = request.scm_path ?? ''
      const localContent = request.body_content ?? ''

      if (source === 'git') {
        return { data: await gitLocal.getDiff(integration.id, scmPath, localContent) }
      }

      const branch = integration.branch ?? 'main'
      let remoteContent = ''
      if (source === 'github') {
        const [owner, ...repoParts] = (sourceMeta.repo ?? integration.repo ?? '/').split('/')
        remoteContent = await github.getFileContent(integration.token, owner, repoParts.join('/'), scmPath, branch)
      } else if (source === 'gitlab') {
        const projectId = encodeURIComponent(sourceMeta.projectId ?? integration.repo)
        remoteContent = await gitlab.getFileContent(integration.token, integration.base_url, projectId, scmPath, branch)
      }

      return { data: { localContent, remoteContent, hasChanges: localContent !== remoteContent } }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:git:commit', async (_, args: {
    requestId: string
    commitMessage: string
    branch: string
    fromBranch?: string
  }) => {
    try {
      const request = queryOne<RequestRow>('SELECT * FROM requests WHERE id = ?', [args.requestId])
      if (!request) return { error: 'Request not found' }

      const { source, sourceMeta, integration, collection } = getSourceMetaForRequest(args.requestId)
      if (!integration) return { error: 'No integration found for this collection' }
      if (!collection) return { error: 'Collection not found' }

      const collectionId = collection.id
      const exportData = buildExport([collectionId])
      const collectionExport = exportData.collections[0]
      if (!collectionExport) return { error: 'Collection not found' }

      const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'collection'
      const scmPath = `${slug(collectionExport.name)}.postly.json`
      const fileContent = JSON.stringify(
        { $schema: 'postly/v1', exportedAt: new Date().toISOString(), collections: [collectionExport] },
        null, 2
      )

      const branch = args.branch

      if (source === 'git') {
        if (args.fromBranch && branch !== args.fromBranch) {
          await gitLocal.createAndPushBranch(integration.id, branch, args.fromBranch)
        }
        await gitLocal.commitAndPush(integration.id, scmPath, fileContent, args.commitMessage, branch)
        clearDirtyForCollection(collectionId)
        return { data: true }
      }

      if (args.fromBranch && branch !== args.fromBranch) {
        if (source === 'github') {
          const [owner, ...repoParts] = (sourceMeta.repo ?? integration.repo).split('/')
          await github.createBranch(integration.token, owner, repoParts.join('/'), branch, args.fromBranch)
        } else if (source === 'gitlab') {
          const projectId = sourceMeta.projectId ?? integration.repo
          await gitlab.createBranch(integration.token, integration.base_url, projectId, args.branch, args.fromBranch)
        }
      }

      let newSha = ''
      if (source === 'github') {
        const [owner, ...repoParts] = (sourceMeta.repo ?? integration.repo).split('/')
        const repo = repoParts.join('/')
        const latestSha = await github.getFileSha(integration.token, owner, repo, scmPath, branch)
        await github.commitFile(integration.token, owner, repo, scmPath, fileContent, latestSha, args.commitMessage, branch)
        newSha = latestSha
      } else if (source === 'gitlab') {
        const projectId = encodeURIComponent(sourceMeta.projectId ?? integration.repo)
        const latestSha = await gitlab.getFileSha(integration.token, integration.base_url, projectId, scmPath, branch)
        await gitlab.commitFile(integration.token, integration.base_url, projectId, scmPath, fileContent, latestSha, args.commitMessage, branch)
        newSha = latestSha
      }

      run('UPDATE requests SET scm_sha = ?, is_dirty = 0, updated_at = ? WHERE id = ?', [newSha, Date.now(), args.requestId])
      clearDirtyForCollection(collectionId)
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:git:import', async (_, args: {
    integrationId: string
    collectionId?: string
    collectionName: string
  }) => {
    try {
      const row = queryOne<IntegrationRow>('SELECT * FROM integrations WHERE id = ?', [args.integrationId])
      if (!row) return { error: 'Integration not found' }
      const collectionId = await gitLocal.discoverAndImport(row.id, row.repo, row.branch ?? 'main', {
        collectionId: args.collectionId,
        collectionName: args.collectionName,
      })
      const collection = queryOne<{ id: string; name: string }>(
        `SELECT id, name FROM folders WHERE id = ?`,
        [collectionId]
      )
      return { data: collection }
    } catch (err) {
      const collection = queryOne<{ id: string; name: string }>(
        `SELECT id, name FROM folders WHERE parent_id IS NULL AND integration_id = ? AND source = 'git'`,
        [args.integrationId]
      )
      if (collection) return { data: collection }
      return { error: String(err) }
    }
  })

  ipcMain.handle('postly:git:dirty-requests', async (_, args: { collectionId: string }) => {
    try {
      const folderIds = getTreeFolderIds(args.collectionId)
      if (folderIds.length === 0) return { data: [] }
      const rows = queryAll<Array<RequestRow & { folder_name: string; group_name: string; request_name: string }> extends never ? never : RequestRow & { folder_name: string; group_name: string; request_name: string }>(
        `SELECT r.id, r.folder_id, r.scm_path, r.name as request_name, f.name as folder_name, f.name as group_name
         FROM requests r
         JOIN folders f ON f.id = r.folder_id
         WHERE r.is_dirty = 1 AND r.folder_id IN (${folderIds.map(() => '?').join(',')})`,
        folderIds
      )
      return { data: rows }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:git:push-collection', async (_, args: {
    collectionId: string
    commitMessage: string
    branch: string
  }) => {
    try {
      const collection = queryOne<{ id: string; name: string; source: string; source_meta: string | null; integration_id: string | null }>(
        'SELECT id, name, source, source_meta, integration_id FROM folders WHERE id = ?',
        [args.collectionId]
      )
      if (!collection) return { error: 'Collection not found' }

      const meta: { integrationId?: string; fileName?: string } = collection.source_meta
        ? JSON.parse(collection.source_meta) : {}
      const integrationId = collection.integration_id ?? meta.integrationId
      if (!integrationId) return { error: 'No integration linked to this collection' }

      const integration = queryOne<IntegrationRow>('SELECT * FROM integrations WHERE id = ?', [integrationId])
      if (!integration) return { error: 'Integration not found' }

      const exportData = buildExport([args.collectionId])
      const col = exportData.collections[0]
      const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'collection'
      const fileName = meta.fileName ?? `${slug(col?.name ?? collection.name)}.postly.json`
      const fileContent = JSON.stringify(
        { $schema: 'postly/v1', exportedAt: new Date().toISOString(), collections: col ? [col] : [] },
        null, 2
      )

      await gitLocal.commitAndPush(integration.id, fileName, fileContent, args.commitMessage, args.branch)

      if (!meta.fileName) {
        run('UPDATE folders SET source_meta = ?, updated_at = ? WHERE id = ?',
          [JSON.stringify({ ...meta, integrationId, fileName }), Date.now(), args.collectionId])
      }

      clearDirtyForCollection(args.collectionId)
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })
}
