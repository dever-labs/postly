import simpleGit from 'simple-git'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import SwaggerParser from '@apidevtools/swagger-parser'
import { queryOne, run } from '../database'
import { parseOpenApiToRequests } from './openapi-parser'
import type { PostlyExportFile, ExportCollection } from '../ipc/export-import'

export function getDataDir(): string {
  return app.getPath('userData')
}

export function getRepoPath(integrationId: string): string {
  return path.join(getDataDir(), 'repos', integrationId)
}

/** Verify the URL is reachable using system credentials (GCM / SSH agent / etc.).
 *  Also detects the default branch via `ls-remote --symref`.
 *
 *  We run git with interactive credential prompts disabled so that:
 *  - repos accessible via cached credentials (SSH agent, OS keychain, GCM stored
 *    tokens) connect instantly and silently, and
 *  - repos that would require a credential dialog fail immediately with an error
 *    rather than hanging indefinitely waiting for user input.
 *
 *  GIT_TERMINAL_PROMPT=0  — suppresses terminal-level prompts (git 2.3+, all platforms)
 *  GCM_INTERACTIVE=never  — prevents Windows Git Credential Manager from opening its GUI */
export async function testConnectivity(repoUrl: string): Promise<{ name: string; defaultBranch: string }> {
  const nonInteractiveEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
  }
  let defaultBranch = 'main'
  try {
    const raw = await simpleGit().env(nonInteractiveEnv).raw(['ls-remote', '--symref', repoUrl, 'HEAD'])
    const match = raw.match(/ref: refs\/heads\/(\S+)\s+HEAD/)
    if (match) defaultBranch = match[1]
  } catch {
    // Some servers don't support --symref; fall back to plain ls-remote
    await simpleGit().env(nonInteractiveEnv).listRemote([repoUrl])
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

/** Return the currently checked-out branch name (or 'HEAD' if detached). */
export async function getCurrentBranch(integrationId: string): Promise<string> {
  const localPath = getRepoPath(integrationId)
  const git = simpleGit(localPath)
  try {
    const branch = await git.revparse(['--abbrev-ref', 'HEAD'])
    return branch.trim() || 'HEAD'
  } catch {
    return 'HEAD'
  }
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
  const resolvedBase = path.resolve(localPath)
  if (!path.resolve(fullPath).startsWith(resolvedBase + path.sep)) {
    throw new Error('Invalid file path: must be within the repository directory')
  }
  fs.mkdirSync(path.dirname(fullPath), { recursive: true })
  fs.writeFileSync(fullPath, content, 'utf8')
  const git = simpleGit(localPath)
  await git.checkout(branch)
  await git.add(filePath)
  await git.commit(message)
  await git.push('origin', branch)
}

/** Import a single Postly collection entry into a DB collection (create or update). */
function upsertPostlyCollection(
  integrationId: string,
  collectionId: string,
  col: ExportCollection,
  fileName: string,
  now: number
) {
  run('DELETE FROM groups WHERE collection_id = ?', [collectionId])
  run(
    'UPDATE collections SET name = ?, source_meta = ?, updated_at = ? WHERE id = ?',
    [col.name, JSON.stringify({ integrationId, fileName }), now, collectionId]
  )
  for (const [gi, grp] of (col.groups ?? []).entries()) {
    const grpId = crypto.randomUUID()
    run(
      `INSERT INTO groups (id, collection_id, name, description, collapsed, hidden, sort_order, auth_type, auth_config, ssl_verification, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)`,
      [grpId, collectionId, grp.name, grp.description ?? '', gi,
       grp.auth?.type ?? 'none', JSON.stringify(grp.auth?.config ?? {}),
       grp.ssl ?? 'inherit', now, now]
    )
    for (const [ri, req] of ((grp.requests ?? []) as unknown as Array<Record<string,unknown>>).entries()) {
      const reqId = crypto.randomUUID()
      run(
        `INSERT INTO requests
           (id, group_id, name, method, url, params, headers, body_type, body_content,
            auth_type, auth_config, ssl_verification, protocol, protocol_config,
            description, scm_path, is_dirty, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [reqId, grpId, req.name, req.method ?? 'GET', req.url ?? '',
         JSON.stringify(req.params ?? []), JSON.stringify(req.headers ?? []),
         req.bodyType ?? 'none', req.bodyContent ?? '',
         (req.auth as Record<string,string>)?.type ?? 'none',
         JSON.stringify((req.auth as Record<string,unknown>)?.config ?? {}),
         req.ssl ?? 'inherit', req.protocol ?? 'http',
         JSON.stringify(req.protocolConfig ?? {}),
         req.description ?? '', fileName, ri, now, now]
      )
    }
  }
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

/** Scan for OpenAPI files and import into a single collection. Returns collectionId. */
async function importOpenApi(integrationId: string, localPath: string, collectionId: string, now: number): Promise<string> {
  for (const filePath of OPENAPI_CANDIDATES) {
    const fullPath = path.join(localPath, filePath)
    if (!fs.existsSync(fullPath)) continue
    let spec: object
    try { spec = await SwaggerParser.dereference(fullPath) } catch { continue }
    run('UPDATE collections SET source_meta = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify({ integrationId, filePath }), now, collectionId])
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
    } catch { /* skip unparseable */ }
  }
  return collectionId
}
export async function discoverAndImport(
  integrationId: string,
  repoUrl: string,
  branch: string,
  opts?: { collectionId?: string; collectionName?: string }
): Promise<string> {
  const now = Date.now()
  const repoName = repoUrl.replace(/\.git$/, '').split('/').slice(-2).join('/')

  // ── 1. Clone/pull first ────────────────────────────────────────────────────
  const localPath = getRepoPath(integrationId)
  await cloneOrPull(integrationId, repoUrl, branch)

  // ── 2. Auto-discover all *.postly.json files (no specific collection) ──────
  if (!opts?.collectionId && !opts?.collectionName) {
    const postlyFiles = fs.readdirSync(localPath).filter(f => f.endsWith('.postly.json'))
    if (postlyFiles.length > 0) {
      let firstId: string | null = null
      for (const file of postlyFiles) {
        try {
          const raw = fs.readFileSync(path.join(localPath, file), 'utf-8')
          const parsed: PostlyExportFile = JSON.parse(raw)
          if (!parsed.$schema?.startsWith('postly/') || !Array.isArray(parsed.collections)) continue
          const col = parsed.collections[0]
          if (!col) continue

          // Find existing collection by fileName in source_meta, or by name
          const byFile = queryOne<{ id: string }>(
            `SELECT id FROM collections WHERE integration_id = ? AND source_meta LIKE ?`,
            [integrationId, `%"fileName":"${file}"%`]
          )
          const byName = !byFile ? queryOne<{ id: string }>(
            `SELECT id FROM collections WHERE integration_id = ? AND name = ? AND source = 'git'`,
            [integrationId, col.name]
          ) : null

          let colId: string
          if (byFile) {
            colId = byFile.id
          } else if (byName) {
            colId = byName.id
          } else {
            colId = crypto.randomUUID()
            run(
              `INSERT INTO collections (id, name, source, source_meta, integration_id, created_at, updated_at) VALUES (?, ?, 'git', ?, ?, ?, ?)`,
              [colId, col.name, JSON.stringify({ integrationId, fileName: file }), integrationId, now, now]
            )
          }
          upsertPostlyCollection(integrationId, colId, col, file, now)
          if (!firstId) firstId = colId
        } catch { /* skip invalid files */ }
      }
      return firstId ?? ''
    }
    // No postly files — fall through to OpenAPI for the single-collection sync path
    const existing = queryOne<{ id: string }>(
      `SELECT id FROM collections WHERE integration_id = ? AND source = 'git' ORDER BY created_at ASC LIMIT 1`,
      [integrationId]
    )
    let collectionId: string
    if (existing) {
      collectionId = existing.id
      run('UPDATE collections SET updated_at = ? WHERE id = ?', [now, collectionId])
    } else {
      collectionId = crypto.randomUUID()
      run(
        `INSERT INTO collections (id, name, source, source_meta, integration_id, created_at, updated_at) VALUES (?, ?, 'git', ?, ?, ?, ?)`,
        [collectionId, repoName, JSON.stringify({ integrationId }), integrationId, now, now]
      )
    }
    return await importOpenApi(integrationId, localPath, collectionId, now)
  }

  // ── 3. Specific collection import (manual import with collectionId/Name) ───
  let collectionId: string

  if (opts?.collectionId) {
    const found = queryOne<{ id: string }>('SELECT id FROM collections WHERE id = ?', [opts.collectionId])
    if (found) {
      collectionId = found.id
      run(
        'UPDATE collections SET source = ?, integration_id = ?, updated_at = ? WHERE id = ?',
        ['git', integrationId, now, collectionId]
      )
    } else {
      collectionId = opts.collectionId
      run(
        `INSERT INTO collections (id, name, source, source_meta, integration_id, created_at, updated_at) VALUES (?, ?, 'git', ?, ?, ?, ?)`,
        [collectionId, opts.collectionName ?? repoName, JSON.stringify({ integrationId }), integrationId, now, now]
      )
    }
  } else {
    // collectionName supplied → always new
    collectionId = crypto.randomUUID()
    run(
      `INSERT INTO collections (id, name, source, source_meta, integration_id, created_at, updated_at) VALUES (?, ?, 'git', ?, ?, ?, ?)`,
      [collectionId, opts.collectionName ?? repoName, JSON.stringify({ integrationId }), integrationId, now, now]
    )
  }

  // Scan postly files for this specific collection
  const postlyFiles = fs.readdirSync(localPath).filter(f => f.endsWith('.postly.json'))
  if (postlyFiles.length > 0) {
    for (const file of postlyFiles) {
      try {
        const raw = fs.readFileSync(path.join(localPath, file), 'utf-8')
        const parsed: PostlyExportFile = JSON.parse(raw)
        if (!parsed.$schema?.startsWith('postly/') || !Array.isArray(parsed.collections)) continue
        const col = parsed.collections[0]
        if (!col) continue
        upsertPostlyCollection(integrationId, collectionId, col, file, now)
        break
      } catch { /* skip */ }
    }
    return collectionId
  }

  return await importOpenApi(integrationId, localPath, collectionId, now)
}

/** Delete a collection's .postly.json file from the repo, commit, and push. */
export async function deleteCollectionFile(
  integrationId: string,
  fileName: string,
  branch: string,
  commitMessage: string
): Promise<void> {
  const localPath = getRepoPath(integrationId)
  const fullPath = path.join(localPath, fileName)
  const resolvedBase = path.resolve(localPath)
  if (!path.resolve(fullPath).startsWith(resolvedBase + path.sep)) {
    throw new Error('Invalid file path: must be within the repository directory')
  }
  if (!fs.existsSync(localPath)) return
  const git = simpleGit(localPath)
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath)
    await git.rm([fileName]).catch(() => {})
    await git.commit(commitMessage)
    await git.push('origin', branch)
  }
}
