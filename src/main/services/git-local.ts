import simpleGit from 'simple-git'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import SwaggerParser from '@apidevtools/swagger-parser'
import { queryOne, run } from '../database'
import { parseOpenApiToRequests } from './openapi-parser'

export function getDataDir(): string {
  return app.getPath('userData')
}

export function getRepoPath(integrationId: string): string {
  return path.join(getDataDir(), 'repos', integrationId)
}

/** Verify the URL is reachable using system credentials (GCM / SSH agent / etc.).
 *  Also detects the default branch via `ls-remote --symref`. */
export async function testConnectivity(repoUrl: string): Promise<{ name: string; defaultBranch: string }> {
  let defaultBranch = 'main'
  try {
    const raw = await simpleGit().raw(['ls-remote', '--symref', repoUrl, 'HEAD'])
    const match = raw.match(/ref: refs\/heads\/(\S+)\s+HEAD/)
    if (match) defaultBranch = match[1]
  } catch {
    // Some servers don't support --symref; fall back to plain ls-remote
    await simpleGit().listRemote([repoUrl])
  }
  let name = repoUrl
  try {
    const gitName = (await simpleGit().raw(['config', '--global', 'user.name'])).trim()
    if (gitName) name = gitName
  } catch { /* ok */ }
  return { name, defaultBranch }
}

/** Clone the repo if not present, otherwise fetch + checkout + pull. */
export async function cloneOrPull(integrationId: string, repoUrl: string, branch: string): Promise<void> {
  const localPath = getRepoPath(integrationId)
  if (fs.existsSync(path.join(localPath, '.git'))) {
    const git = simpleGit(localPath)
    await git.fetch()
    try {
      await git.checkout(branch)
      await git.pull('origin', branch)
    } catch {
      // branch may not exist remotely yet — that's OK
    }
  } else {
    fs.mkdirSync(localPath, { recursive: true })
    await simpleGit().clone(repoUrl, localPath)
    const git = simpleGit(localPath)
    try { await git.checkout(branch) } catch { /* fallback to default */ }
  }
}

/** List remote branch names for an already-cloned repo. */
export async function listBranches(integrationId: string): Promise<string[]> {
  const localPath = getRepoPath(integrationId)
  const git = simpleGit(localPath)
  await git.fetch()
  const result = await git.branch(['-r'])
  return Object.values(result.branches)
    .map((b) => b.name.replace(/^origin\//, ''))
    .filter((b) => !b.includes('HEAD'))
}

/** Create a new local branch from `fromBranch` and push it to origin. */
export async function createAndPushBranch(
  integrationId: string,
  newBranch: string,
  fromBranch: string
): Promise<void> {
  const localPath = getRepoPath(integrationId)
  const git = simpleGit(localPath)
  await git.checkout(fromBranch)
  await git.checkoutLocalBranch(newBranch)
  await git.push(['-u', 'origin', newBranch])
}

/** Checkout a branch in the local clone. */
export async function switchBranch(integrationId: string, branch: string): Promise<void> {
  const localPath = getRepoPath(integrationId)
  const git = simpleGit(localPath)
  try {
    await git.checkout(branch)
  } catch {
    await git.checkoutBranch(branch, `origin/${branch}`)
  }
}

/** Get a diff between the given content and the HEAD version of the file. */
export async function getDiff(
  integrationId: string,
  filePath: string,
  localContent: string
): Promise<{ localContent: string; remoteContent: string; hasChanges: boolean }> {
  const localPath = getRepoPath(integrationId)
  const git = simpleGit(localPath)
  let remoteContent = ''
  try {
    remoteContent = await git.show([`HEAD:${filePath}`])
  } catch {
    // file is new — no HEAD version
  }
  return { localContent, remoteContent, hasChanges: localContent !== remoteContent }
}

/** Write content to the file, stage, commit, and push. */
export async function commitAndPush(
  integrationId: string,
  filePath: string,
  content: string,
  message: string,
  branch: string
): Promise<void> {
  const localPath = getRepoPath(integrationId)
  const fullPath = path.join(localPath, filePath)
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, content, 'utf8')
  const git = simpleGit(localPath)
  await git.checkout(branch)
  await git.add(filePath)
  await git.commit(message)
  await git.push('origin', branch)
}

const OPENAPI_CANDIDATES = [
  'openapi.yaml',
  'openapi.json',
  'openapi/openapi.yaml',
  'docs/openapi.yaml',
  'api/openapi.yaml',
  'swagger.yaml',
  'swagger.json',
]

/** Clone/pull the repo, scan for OpenAPI files, and upsert collections + requests into the DB.
 *  Pass `opts.collectionId` + `opts.collectionName` to import into a specific collection. */
export async function discoverAndImport(
  integrationId: string,
  repoUrl: string,
  branch: string,
  opts?: { collectionId?: string; collectionName?: string }
): Promise<void> {
  const localPath = getRepoPath(integrationId)
  await cloneOrPull(integrationId, repoUrl, branch)

  const now = Date.now()
  for (const filePath of OPENAPI_CANDIDATES) {
    const fullPath = path.join(localPath, filePath)
    if (!fs.existsSync(fullPath)) continue

    let spec: object
    try {
      spec = await SwaggerParser.dereference(fullPath)
    } catch {
      continue
    }

    const sourceMeta = JSON.stringify({ integrationId, filePath })

    // Prefer an explicitly supplied collectionId, then look for one already tied to this integration
    const existing = opts?.collectionId
      ? queryOne<{ id: string }>('SELECT id FROM collections WHERE id = ?', [opts.collectionId])
      : queryOne<{ id: string }>(
          `SELECT id FROM collections WHERE integration_id = ? AND source = 'git'`,
          [integrationId]
        )

    let collectionId: string
    if (existing) {
      collectionId = existing.id
      run('UPDATE collections SET source_meta = ?, updated_at = ? WHERE id = ?', [sourceMeta, now, collectionId])
    } else {
      collectionId = opts?.collectionId ?? crypto.randomUUID()
      const repoName = opts?.collectionName ?? repoUrl.replace(/\.git$/, '').split('/').slice(-2).join('/')
      run(
        `INSERT INTO collections (id, name, source, source_meta, integration_id, created_at, updated_at) VALUES (?, ?, 'git', ?, ?, ?, ?)`,
        [collectionId, repoName, sourceMeta, integrationId, now, now]
      )
    }

    try {
      const { groups, requests } = await parseOpenApiToRequests(spec, collectionId)
      run('DELETE FROM groups WHERE collection_id = ?', [collectionId])
      for (const g of groups) {
        run(
          `INSERT INTO groups (id, collection_id, name, description, collapsed, hidden, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [g.id, g.collectionId, g.name, g.description ?? null, g.collapsed ? 1 : 0, g.hidden ? 1 : 0, g.sortOrder, g.createdAt, g.updatedAt]
        )
      }
      for (const req of requests) {
        run(
          `INSERT INTO requests (id, group_id, name, method, url, params, headers, body_type, body_content, auth_type, auth_config, description, scm_path, scm_sha, is_dirty, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [req.id, req.groupId, req.name, req.method, req.url, req.params, req.headers, req.bodyType,
           req.bodyContent, req.authType, req.authConfig, req.description ?? null, filePath, null,
           0, req.sortOrder, req.createdAt, req.updatedAt]
        )
      }
    } catch { /* skip unparseable specs */ }
  }
}
