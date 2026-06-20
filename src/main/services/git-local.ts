import simpleGit from 'simple-git'
import { app } from 'electron'
import path from 'path'
import os from 'os'
import fs from 'fs'
import crypto from 'crypto'
import SwaggerParser from '@apidevtools/swagger-parser'
import { queryOne, run } from '../database'
import { parseOpenApiToRequests } from './openapi-parser'
import type { PostlyExportFile, ExportCollection, ExportFolder, ExportRequest } from '../ipc/export-import'

export function getDataDir(): string {
  return app.getPath('userData')
}

export function getRepoPath(integrationId: string): string {
  return path.join(getDataDir(), 'repos', integrationId)
}

/** Build a GIT_SSH_COMMAND that:
 *  - accepts new host keys on first connection (TOFU / StrictHostKeyChecking=accept-new)
 *  - explicitly loads the user's default SSH identity files so the command works
 *    even when Electron is launched outside a shell that has an SSH agent running
 *    (common on macOS when launched from the Dock, or on Windows)
 *
 *  Key search order mirrors OpenSSH defaults: ed25519 → ecdsa → rsa → dsa. */
export function buildSshCommand(): string {
  const sshDir = path.join(os.homedir(), '.ssh')
  const keyNames = ['id_ed25519', 'id_ecdsa', 'id_rsa', 'id_dsa']
  const identityArgs = keyNames
    .map((name) => path.join(sshDir, name))
    .filter((keyPath) => { try { return fs.existsSync(keyPath) } catch { return false } })
    // SSH -i expects forward slashes even on Windows
    .map((keyPath) => `-i "${keyPath.replace(/\\/g, '/')}"`)
    .join(' ')

  return `ssh -o StrictHostKeyChecking=accept-new${identityArgs ? ' ' + identityArgs : ''}`
}

/** Returns true for SSH-style URLs (git@host:path or ssh://...).
 *  HTTPS URLs must NOT receive GIT_SSH_COMMAND — simple-git blocks it. */
export function isSshUrl(url: string): boolean {
  return /^(ssh:\/\/|git@)/i.test(url.trim())
}

/** Base environment applied to all git network operations (no SSH override). */
const GIT_ENV_BASE = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GCM_INTERACTIVE: 'never',
}

/** Build the git environment for a known URL.
 *  GIT_SSH_COMMAND is only injected for SSH URLs to avoid the
 *  "not permitted without allowUnsafeSshCommand" error from simple-git
 *  when the remote is HTTPS. */
export function buildGitEnv(repoUrl: string): typeof GIT_ENV_BASE & { GIT_SSH_COMMAND?: string } {
  if (isSshUrl(repoUrl)) {
    return { ...GIT_ENV_BASE, GIT_SSH_COMMAND: buildSshCommand() }
  }
  return { ...GIT_ENV_BASE }
}

/** Resolve the origin remote URL from an already-cloned local repo. */
async function getRemoteUrl(localPath: string): Promise<string> {
  try {
    const remotes = await simpleGit(localPath).getRemotes(true)
    return remotes.find((r) => r.name === 'origin')?.refs?.fetch ?? ''
  } catch {
    return ''
  }
}

/** Verify the URL is reachable using system credentials (GCM / SSH agent / etc.).
 *  Also detects the default branch via `ls-remote --symref`. */
export async function testConnectivity(repoUrl: string): Promise<{ name: string; defaultBranch: string }> {
  const env = buildGitEnv(repoUrl)
  let defaultBranch = 'main'
  try {
    const raw = await simpleGit().env(env).raw(['ls-remote', '--symref', repoUrl, 'HEAD'])
    const match = raw.match(/ref: refs\/heads\/(\S+)\s+HEAD/)
    if (match) defaultBranch = match[1]
  } catch {
    // Some servers don't support --symref; fall back to plain ls-remote
    await simpleGit().env(env).listRemote([repoUrl])
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
  const env = buildGitEnv(repoUrl)
  if (fs.existsSync(path.join(localPath, '.git'))) {
    const git = simpleGit(localPath).env(env)
    await git.fetch()
    try {
      await git.checkout(branch)
      await git.pull('origin', branch)
    } catch {
      // branch may not exist remotely yet — that's OK
    }
  } else {
    fs.mkdirSync(localPath, { recursive: true })
    await simpleGit().env(env).clone(repoUrl, localPath)
    const git = simpleGit(localPath).env(env)
    try { await git.checkout(branch) } catch { /* fallback to default */ }
  }
}

/** List remote branch names for an already-cloned repo. */
export async function listBranches(integrationId: string): Promise<string[]> {
  const localPath = getRepoPath(integrationId)
  const remoteUrl = await getRemoteUrl(localPath)
  const git = simpleGit(localPath).env(buildGitEnv(remoteUrl))
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
  const remoteUrl = await getRemoteUrl(localPath)
  const git = simpleGit(localPath).env(buildGitEnv(remoteUrl))
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
  const remoteUrl = await getRemoteUrl(localPath)
  const git = simpleGit(localPath).env(buildGitEnv(remoteUrl))
  await git.checkout(branch)
  await git.add(filePath)
  await git.commit(message)
  await git.push('origin', branch)
}

function insertExportRequest(
  request: ExportRequest,
  folderId: string,
  scmPath: string,
  sortOrder: number,
  now: number
): void {
  const reqId = crypto.randomUUID()
  run(
    `INSERT INTO requests
       (id, folder_id, name, method, url, params, headers, body_type, body_content,
        auth_type, auth_config, ssl_verification, protocol, protocol_config,
        description, scm_path, is_dirty, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [reqId, folderId, request.name, request.method ?? 'GET', request.url ?? '',
      JSON.stringify(request.params ?? []), JSON.stringify(request.headers ?? []),
      request.bodyType ?? 'none', request.bodyContent ?? '',
      request.auth?.type ?? 'none',
      JSON.stringify(request.auth?.config ?? {}),
      request.ssl ?? 'inherit', request.protocol ?? 'http',
      JSON.stringify(request.protocolConfig ?? {}),
      request.description ?? '', scmPath, sortOrder, now, now]
  )
}

function insertExportFolder(
  folder: ExportFolder,
  parentId: string,
  scmPath: string,
  sortOrder: number,
  now: number
): void {
  const folderId = crypto.randomUUID()
  run(
    `INSERT INTO folders
      (id, parent_id, name, description, source, source_meta, integration_id, auth_type, auth_config,
       ssl_verification, hidden, collapsed, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'local', NULL, NULL, ?, ?, ?, 0, 0, ?, ?, ?)`,
    [folderId, parentId, folder.name, folder.description ?? '',
      folder.auth?.type ?? 'none', JSON.stringify(folder.auth?.config ?? {}),
      folder.ssl ?? 'inherit', sortOrder, now, now]
  )
  for (const [ri, req] of (folder.requests ?? []).entries()) {
    insertExportRequest(req, folderId, scmPath, ri, now)
  }
  // fall back to `groups` for .postly.json files committed before the folder-tree refactor
  for (const [fi, child] of (folder.folders ?? folder.groups ?? []).entries()) {
    insertExportFolder(child, folderId, scmPath, fi, now)
  }
}

/** Import a single Postly collection entry into a DB collection (create or update). */
function upsertPostlyCollection(
  integrationId: string,
  collectionId: string,
  col: ExportCollection,
  fileName: string,
  now: number
) {
  run('DELETE FROM requests WHERE folder_id = ?', [collectionId])
  run('DELETE FROM folders WHERE parent_id = ?', [collectionId])
  run(
    'UPDATE folders SET name = ?, source_meta = ?, updated_at = ? WHERE id = ?',
    [col.name, JSON.stringify({ integrationId, fileName }), now, collectionId]
  )
  for (const [ri, req] of (col.requests ?? []).entries()) {
    insertExportRequest(req, collectionId, fileName, ri, now)
  }
  // fall back to `groups` for .postly.json files committed before the folder-tree refactor
  for (const [fi, folder] of (col.folders ?? col.groups ?? []).entries()) {
    insertExportFolder(folder, collectionId, fileName, fi, now)
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
    run('UPDATE folders SET source_meta = ?, updated_at = ? WHERE id = ?',
      [JSON.stringify({ integrationId, filePath }), now, collectionId])
    try {
      const { folders, requests } = await parseOpenApiToRequests(spec, collectionId)
      run('DELETE FROM requests WHERE folder_id = ?', [collectionId])
      run('DELETE FROM folders WHERE parent_id = ?', [collectionId])
      for (const folder of folders) {
        run(
          `INSERT INTO folders (id, parent_id, name, description, source, source_meta, integration_id, auth_type, auth_config, ssl_verification, hidden, collapsed, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'local', NULL, NULL, 'none', '{}', 'inherit', ?, ?, ?, ?, ?)`,
          [folder.id, folder.parentId, folder.name, folder.description ?? '', folder.hidden ? 1 : 0, folder.collapsed ? 1 : 0, folder.sortOrder, folder.createdAt, folder.updatedAt]
        )
      }
      for (const req of requests) {
        run(
          `INSERT INTO requests (id, folder_id, name, method, url, params, headers, body_type, body_content, auth_type, auth_config, description, scm_path, scm_sha, is_dirty, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [req.id, req.folderId, req.name, req.method, req.url, req.params, req.headers, req.bodyType,
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
            `SELECT id FROM folders WHERE parent_id IS NULL AND integration_id = ? AND source_meta LIKE ?`,
            [integrationId, `%"fileName":"${file}"%`]
          )
          const byName = !byFile ? queryOne<{ id: string }>(
            `SELECT id FROM folders WHERE parent_id IS NULL AND integration_id = ? AND name = ? AND source = 'git'`,
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
              `INSERT INTO folders (id, parent_id, name, source, source_meta, integration_id, auth_type, auth_config, ssl_verification, hidden, collapsed, sort_order, created_at, updated_at)
               VALUES (?, NULL, ?, 'git', ?, ?, 'none', '{}', 'inherit', 0, 0, 0, ?, ?)`,
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
      `SELECT id FROM folders WHERE parent_id IS NULL AND integration_id = ? AND source = 'git' ORDER BY created_at ASC LIMIT 1`,
      [integrationId]
    )
    let collectionId: string
    if (existing) {
      collectionId = existing.id
      run('UPDATE folders SET updated_at = ? WHERE id = ?', [now, collectionId])
    } else {
      collectionId = crypto.randomUUID()
      run(
        `INSERT INTO folders (id, parent_id, name, source, source_meta, integration_id, auth_type, auth_config, ssl_verification, hidden, collapsed, sort_order, created_at, updated_at)
         VALUES (?, NULL, ?, 'git', ?, ?, 'none', '{}', 'inherit', 0, 0, 0, ?, ?)`,
        [collectionId, repoName, JSON.stringify({ integrationId }), integrationId, now, now]
      )
    }
    return await importOpenApi(integrationId, localPath, collectionId, now)
  }

  // ── 3. Specific collection import (manual import with collectionId/Name) ───
  let collectionId: string

  if (opts?.collectionId) {
    const found = queryOne<{ id: string }>('SELECT id FROM folders WHERE id = ?', [opts.collectionId])
    if (found) {
      collectionId = found.id
      run(
        'UPDATE folders SET source = ?, integration_id = ?, updated_at = ? WHERE id = ?',
        ['git', integrationId, now, collectionId]
      )
    } else {
      collectionId = opts.collectionId
      run(
        `INSERT INTO folders (id, parent_id, name, source, source_meta, integration_id, auth_type, auth_config, ssl_verification, hidden, collapsed, sort_order, created_at, updated_at)
         VALUES (?, NULL, ?, 'git', ?, ?, 'none', '{}', 'inherit', 0, 0, 0, ?, ?)`,
        [collectionId, opts.collectionName ?? repoName, JSON.stringify({ integrationId }), integrationId, now, now]
      )
    }
  } else {
    // collectionName supplied → always new
    collectionId = crypto.randomUUID()
    run(
      `INSERT INTO folders (id, parent_id, name, source, source_meta, integration_id, auth_type, auth_config, ssl_verification, hidden, collapsed, sort_order, created_at, updated_at)
       VALUES (?, NULL, ?, 'git', ?, ?, 'none', '{}', 'inherit', 0, 0, 0, ?, ?)`,
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
  const remoteUrl = await getRemoteUrl(localPath)
  const git = simpleGit(localPath).env(buildGitEnv(remoteUrl))
  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath)
    await git.rm([fileName]).catch(() => {})
    await git.commit(commitMessage)
    await git.push('origin', branch)
  }
}
