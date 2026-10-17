import { BrowserWindow, dialog, ipcMain } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import { queryAll, runTransaction } from '../database'
import { parseNetworkSettings, serializeNetworkSettings, type NetworkSettings } from '../services/network-settings'
import { MAX_IMPORT_BYTES, previewBrunoFolder, previewImport } from '../services/import-formats'
import { collectionVariableStatements, exportCollectionVariables, type VariableRow } from '../services/variable-store'

const SCHEMA = 'postly/v1'

export interface ExportRequest {
  name: string
  method: string
  url: string
  protocol: string
  params: unknown[]
  headers: unknown[]
  bodyType: string
  bodyContent: string
  auth: { type: string; config: Record<string, unknown> }
  ssl: string
  /** Timeout / redirect overrides; omitted when everything is inherited. */
  network?: NetworkSettings
  description: string
  protocolConfig: Record<string, unknown>
}

export interface ExportFolder {
  name: string
  description: string
  auth: { type: string; config: Record<string, unknown> }
  ssl: string
  /** Timeout / redirect overrides; omitted when everything is inherited. */
  network?: NetworkSettings
  requests: ExportRequest[]
  folders: ExportFolder[]
  /** @deprecated use folders — present in pre-v2 exports for backward compat */
  groups?: ExportFolder[]
}

export interface ExportCollection {
  name: string
  description: string
  source: string
  auth: { type: string; config: Record<string, unknown> }
  ssl: string
  /** Timeout / redirect overrides; omitted when everything is inherited. */
  network?: NetworkSettings
  /** Collection-scoped variables. Secret values are exported blank. */
  variables?: VariableRow[]
  requests: ExportRequest[]
  folders: ExportFolder[]
  /** @deprecated use folders — present in pre-v2 exports for backward compat */
  groups?: ExportFolder[]
}

export interface PostlyExportFile {
  $schema: string
  exportedAt: string
  collections: ExportCollection[]
}

interface DbFolderRow {
  id: string
  parent_id: string | null
  name: string
  description: string | null
  source: string | null
  auth_type: string | null
  auth_config: string | null
  ssl_verification: string | null
  network_settings: string | null
  sort_order: number
}

interface DbRequestRow {
  id: string
  folder_id: string
  name: string
  method: string | null
  url: string | null
  protocol: string | null
  params: string | null
  headers: string | null
  body_type: string | null
  body_content: string | null
  auth_type: string | null
  auth_config: string | null
  ssl_verification: string | null
  network_settings: string | null
  description: string | null
  protocol_config: string | null
  sort_order: number
}

export function tryParse<T>(val: unknown, fallback: T): T {
  try { return val ? JSON.parse(String(val)) as T : fallback } catch { return fallback }
}

/** Spread into an export object so the key is only present when something is overridden. */
export function networkField(raw: string | null | undefined): { network?: NetworkSettings } {
  const network = parseNetworkSettings(raw)
  return network ? { network } : {}
}

function mapRequest(row: DbRequestRow): ExportRequest {
  return {
    name: String(row.name ?? ''),
    method: String(row.method ?? 'GET'),
    url: String(row.url ?? ''),
    protocol: String(row.protocol ?? 'http'),
    params: tryParse(row.params, []),
    headers: tryParse(row.headers, []),
    bodyType: String(row.body_type ?? 'none'),
    bodyContent: String(row.body_content ?? ''),
    auth: { type: String(row.auth_type ?? 'none'), config: tryParse(row.auth_config, {}) },
    ssl: String(row.ssl_verification ?? 'inherit'),
    ...networkField(row.network_settings),
    description: String(row.description ?? ''),
    protocolConfig: tryParse(row.protocol_config, {}),
  }
}

function mapFolderTree(
  folder: DbFolderRow,
  childFolders: Map<string, DbFolderRow[]>,
  folderRequests: Map<string, DbRequestRow[]>
): ExportFolder {
  return {
    name: String(folder.name ?? ''),
    description: String(folder.description ?? ''),
    auth: { type: String(folder.auth_type ?? 'none'), config: tryParse(folder.auth_config, {}) },
    ssl: String(folder.ssl_verification ?? 'inherit'),
    ...networkField(folder.network_settings),
    requests: (folderRequests.get(folder.id) ?? []).map(mapRequest),
    folders: (childFolders.get(folder.id) ?? []).map((child) => mapFolderTree(child, childFolders, folderRequests)),
  }
}

export function buildExport(collectionIds?: string[]): PostlyExportFile {
  const folderRows = (collectionIds && collectionIds.length > 0
    ? queryAll<DbFolderRow>(
        `WITH RECURSIVE tree AS (
           SELECT * FROM folders WHERE id IN (${collectionIds.map(() => '?').join(',')})
           UNION ALL
           SELECT child.*
           FROM folders child
           JOIN tree parent ON child.parent_id = parent.id
         )
         SELECT * FROM tree ORDER BY sort_order ASC, created_at ASC`,
        collectionIds
      )
    : queryAll<DbFolderRow>('SELECT * FROM folders ORDER BY sort_order ASC, created_at ASC'))

  const requestRows = queryAll<DbRequestRow>('SELECT * FROM requests ORDER BY sort_order ASC, created_at ASC')

  const selectedRootIds = collectionIds ? new Set(collectionIds) : null
  const folderById = new Map(folderRows.map((row) => [row.id, row]))
  const childFolders = new Map<string, DbFolderRow[]>()
  const rootFolders: DbFolderRow[] = []

  for (const folder of folderRows) {
    if (folder.parent_id && folderById.has(folder.parent_id)) {
      const siblings = childFolders.get(folder.parent_id) ?? []
      siblings.push(folder)
      childFolders.set(folder.parent_id, siblings)
    } else if (!folder.parent_id) {
      if (!selectedRootIds || selectedRootIds.has(folder.id)) rootFolders.push(folder)
    }
  }

  const exportedIds = new Set<string>()
  const markExported = (folder: DbFolderRow) => {
    exportedIds.add(folder.id)
    for (const child of childFolders.get(folder.id) ?? []) markExported(child)
  }
  rootFolders.forEach(markExported)

  const folderRequests = new Map<string, DbRequestRow[]>()
  for (const request of requestRows) {
    if (!exportedIds.has(request.folder_id)) continue
    const rows = folderRequests.get(request.folder_id) ?? []
    rows.push(request)
    folderRequests.set(request.folder_id, rows)
  }

  const collections = rootFolders.map((folder) => ({
    name: String(folder.name ?? ''),
    description: String(folder.description ?? ''),
    source: String(folder.source ?? 'local'),
    auth: { type: String(folder.auth_type ?? 'none'), config: tryParse(folder.auth_config, {}) },
    ssl: String(folder.ssl_verification ?? 'inherit'),
    ...networkField(folder.network_settings),
    variables: exportCollectionVariables(folder.id),
    requests: (folderRequests.get(folder.id) ?? []).map(mapRequest),
    folders: (childFolders.get(folder.id) ?? []).map((child) => mapFolderTree(child, childFolders, folderRequests)),
  }))

  return { $schema: SCHEMA, exportedAt: new Date().toISOString(), collections }
}

type Statement = { sql: string; params: unknown[] }

function requestStatements(requests: ExportRequest[], folderId: string, now: number, out: Statement[]): void {
  for (const [index, request] of requests.entries()) {
    out.push({
      sql: `INSERT INTO requests
         (id, folder_id, name, method, url, params, headers, body_type, body_content,
          auth_type, auth_config, ssl_verification, protocol, protocol_config,
          description, network_settings, is_dirty, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      params: [
        crypto.randomUUID(),
        folderId,
        request.name,
        request.method ?? 'GET',
        request.url ?? '',
        JSON.stringify(request.params ?? []),
        JSON.stringify(request.headers ?? []),
        request.bodyType ?? 'none',
        request.bodyContent ?? '',
        request.auth?.type ?? 'none',
        JSON.stringify(request.auth?.config ?? {}),
        request.ssl ?? 'inherit',
        request.protocol ?? 'http',
        JSON.stringify(request.protocolConfig ?? {}),
        request.description ?? '',
        serializeNetworkSettings(request.network),
        index,
        now,
        now,
      ],
    })
  }
}

function folderStatements(folder: ExportFolder, parentId: string, sortOrder: number, now: number, out: Statement[]): void {
  const folderId = crypto.randomUUID()
  out.push({
    sql: `INSERT INTO folders
      (id, parent_id, name, description, source, source_meta, integration_id, auth_type, auth_config,
       ssl_verification, network_settings, hidden, collapsed, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'local', NULL, NULL, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
    params: [
      folderId,
      parentId,
      folder.name,
      folder.description ?? '',
      folder.auth?.type ?? 'none',
      JSON.stringify(folder.auth?.config ?? {}),
      folder.ssl ?? 'inherit',
      serializeNetworkSettings(folder.network),
      sortOrder,
      now,
      now,
    ],
  })
  requestStatements(folder.requests ?? [], folderId, now, out)
  // fall back to `groups` for exports created before the folder-tree refactor
  const children = folder.folders ?? folder.groups ?? []
  for (const [index, child] of children.entries()) {
    folderStatements(child, folderId, index, now, out)
  }
}

/** Imports every collection in one transaction: a failure leaves nothing behind. */
export function importData(data: PostlyExportFile): number {
  const now = Date.now()
  const statements: Statement[] = []
  for (const [collectionIndex, collection] of data.collections.entries()) {
    const collectionId = crypto.randomUUID()
    statements.push({
      sql: `INSERT INTO folders
        (id, parent_id, name, description, source, source_meta, integration_id, auth_type, auth_config,
         ssl_verification, network_settings, hidden, collapsed, sort_order, created_at, updated_at)
       VALUES (?, NULL, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
      params: [
        collectionId,
        collection.name,
        collection.description ?? '',
        collection.source ?? 'local',
        collection.auth?.type ?? 'none',
        JSON.stringify(collection.auth?.config ?? {}),
        collection.ssl ?? 'inherit',
        serializeNetworkSettings(collection.network),
        collectionIndex,
        now,
        now,
      ],
    })
    statements.push(...collectionVariableStatements(collectionId, collection.variables))
    requestStatements(collection.requests ?? [], collectionId, now, statements)
    // fall back to `groups` for exports created before the folder-tree refactor
    const topFolders = collection.folders ?? collection.groups ?? []
    for (const [folderIndex, folder] of topFolders.entries()) {
      folderStatements(folder, collectionId, folderIndex, now, statements)
    }
  }
  runTransaction(statements)
  return data.collections.length
}

function winFromEvent(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

export function registerExportImportHandlers(): void {
  ipcMain.handle('postly:export', async (event, args: { collectionIds?: string[] } = {}) => {
    try {
      const win = winFromEvent(event)
      const data = buildExport(args.collectionIds)
      const defaultName = data.collections.length === 1
        ? `${data.collections[0].name.replace(/[^a-z0-9_-]/gi, '_')}.postly.json`
        : 'postly-export.json'

      const result = await (win
        ? dialog.showSaveDialog(win, {
            title: 'Export Collections',
            defaultPath: defaultName,
            filters: [
              { name: 'Postly Collection (*.postly.json)', extensions: ['json'] },
              { name: 'All Files', extensions: ['*'] },
            ],
          })
        : dialog.showSaveDialog({
            title: 'Export Collections',
            defaultPath: defaultName,
            filters: [
              { name: 'Postly Collection (*.postly.json)', extensions: ['json'] },
              { name: 'All Files', extensions: ['*'] },
            ],
          }))
      if (result.canceled || !result.filePath) return { data: null }

      fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8')
      return { data: { filePath: result.filePath, count: data.collections.length } }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('postly:import', async (event) => {
    try {
      const win = winFromEvent(event)
      const result = await (win
        ? dialog.showOpenDialog(win, {
            title: 'Import Collections',
            filters: [
              { name: 'Postly Collection (*.postly.json)', extensions: ['json'] },
              { name: 'All Files', extensions: ['*'] },
            ],
            properties: ['openFile'],
          })
        : dialog.showOpenDialog({
            title: 'Import Collections',
            filters: [
              { name: 'Postly Collection (*.postly.json)', extensions: ['json'] },
              { name: 'All Files', extensions: ['*'] },
            ],
            properties: ['openFile'],
          }))
      if (result.canceled || result.filePaths.length === 0) return { data: null }

      const raw = fs.readFileSync(result.filePaths[0], 'utf-8')
      const parsed: PostlyExportFile = JSON.parse(raw)

      if (!parsed.$schema?.startsWith('postly/') || !Array.isArray(parsed.collections)) {
        return { error: 'Not a valid Postly export file.' }
      }

      const count = importData(parsed)
      return { data: { count } }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('postly:import:collections', async (_event, args: { collections: ExportCollection[] }) => {
    try {
      if (!Array.isArray(args?.collections)) return { error: 'Invalid collections data.' }
      const count = importData({ $schema: SCHEMA, exportedAt: new Date().toISOString(), collections: args.collections })
      return { data: { count } }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('postly:import:parse', async (_event, args: { text?: string; sourceUrl?: string }) => {
    try {
      if (typeof args?.text !== 'string') return { error: 'No file content provided.' }
      return { data: await previewImport(args.text, { sourceUrl: typeof args.sourceUrl === 'string' ? args.sourceUrl : undefined }) }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('postly:import:parse-folder', (_event, args: { files?: Array<{ path?: unknown; text?: unknown }> }) => {
    try {
      if (!Array.isArray(args?.files)) return { error: 'No files provided.' }
      const files = args.files.filter((f) => typeof f?.path === 'string' && typeof f.text === 'string') as Array<{ path: string; text: string }>
      return { data: previewBrunoFolder(files) }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('postly:import:fetch-url', async (_event, args: { url?: string }) => {
    try {
      const url = new URL(String(args?.url ?? '').trim())
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: 'Only http and https URLs can be imported.' }
      const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { Accept: 'application/json, application/yaml, text/yaml, */*' } })
      if (!response.ok) return { error: `The server answered ${response.status} ${response.statusText}.` }
      const declared = Number(response.headers.get('content-length') ?? 0)
      if (declared > MAX_IMPORT_BYTES) return { error: 'The document is larger than 20 MB.' }
      const chunks: Uint8Array[] = []
      let received = 0
      const reader = response.body?.getReader()
      while (reader) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (received > MAX_IMPORT_BYTES) {
          await reader.cancel()
          return { error: 'The document is larger than 20 MB.' }
        }
        chunks.push(value)
      }
      const text = Buffer.concat(chunks).toString('utf-8')
      return { data: { text } }
    } catch (err) {
      return { error: err instanceof TypeError && /Invalid URL/.test(err.message) ? 'Enter a valid http(s) URL.' : `Could not fetch the document: ${err instanceof Error ? err.message : String(err)}` }
    }
  })
}
