import { ipcMain } from 'electron'
import { queryOne, run } from '../database'

export function registerDraftHandlers(): void {
  // ── Request drafts ────────────────────────────────────────────────────────

  ipcMain.handle('postly:drafts:request:get', (_, args: { requestId: string }) => {
    try {
      return { data: queryOne('SELECT * FROM request_drafts WHERE request_id = ?', [args.requestId]) }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:drafts:request:upsert', (_, args: {
    requestId: string
    method?: string; url?: string; params?: string; headers?: string
    bodyType?: string; bodyContent?: string
    authType?: string; authConfig?: string
    sslVerification?: string; protocol?: string; protocolConfig?: string
  }) => {
    try {
      run(
        `INSERT OR REPLACE INTO request_drafts
          (request_id, method, url, params, headers, body_type, body_content,
           auth_type, auth_config, ssl_verification, protocol, protocol_config, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          args.requestId, args.method ?? null, args.url ?? null,
          args.params ?? null, args.headers ?? null,
          args.bodyType ?? null, args.bodyContent ?? null,
          args.authType ?? null, args.authConfig ?? null,
          args.sslVerification ?? null, args.protocol ?? null,
          args.protocolConfig ?? null, Date.now(),
        ]
      )
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:drafts:request:delete', (_, args: { requestId: string }) => {
    try {
      run('DELETE FROM request_drafts WHERE request_id = ?', [args.requestId])
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  // ── Collection drafts ─────────────────────────────────────────────────────

  ipcMain.handle('postly:drafts:collection:get', (_, args: { collectionId: string }) => {
    try {
      return { data: queryOne('SELECT * FROM collection_drafts WHERE collection_id = ?', [args.collectionId]) }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:drafts:collection:upsert', (_, args: {
    collectionId: string
    name?: string; description?: string
    authType?: string; authConfig?: string; sslVerification?: string
  }) => {
    try {
      run(
        `INSERT OR REPLACE INTO collection_drafts
          (collection_id, name, description, auth_type, auth_config, ssl_verification, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          args.collectionId, args.name ?? null, args.description ?? null,
          args.authType ?? null, args.authConfig ?? null,
          args.sslVerification ?? null, Date.now(),
        ]
      )
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:drafts:collection:delete', (_, args: { collectionId: string }) => {
    try {
      run('DELETE FROM collection_drafts WHERE collection_id = ?', [args.collectionId])
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  // ── Group drafts ──────────────────────────────────────────────────────────

  ipcMain.handle('postly:drafts:group:get', (_, args: { groupId: string }) => {
    try {
      return { data: queryOne('SELECT * FROM group_drafts WHERE group_id = ?', [args.groupId]) }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:drafts:group:upsert', (_, args: {
    groupId: string
    name?: string; description?: string
    authType?: string; authConfig?: string; sslVerification?: string
  }) => {
    try {
      run(
        `INSERT OR REPLACE INTO group_drafts
          (group_id, name, description, auth_type, auth_config, ssl_verification, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          args.groupId, args.name ?? null, args.description ?? null,
          args.authType ?? null, args.authConfig ?? null,
          args.sslVerification ?? null, Date.now(),
        ]
      )
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:drafts:group:delete', (_, args: { groupId: string }) => {
    try {
      run('DELETE FROM group_drafts WHERE group_id = ?', [args.groupId])
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  // ── Environment drafts ────────────────────────────────────────────────────

  ipcMain.handle('postly:drafts:env:get', (_, args: { envId: string }) => {
    try {
      return { data: queryOne('SELECT * FROM env_drafts WHERE env_id = ?', [args.envId]) }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:drafts:env:upsert', (_, args: { envId: string; varsJson: string }) => {
    try {
      run(
        `INSERT OR REPLACE INTO env_drafts (env_id, vars_json, updated_at) VALUES (?, ?, ?)`,
        [args.envId, args.varsJson, Date.now()]
      )
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:drafts:env:delete', (_, args: { envId: string }) => {
    try {
      run('DELETE FROM env_drafts WHERE env_id = ?', [args.envId])
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })
}
