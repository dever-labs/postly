import { BrowserWindow, dialog, ipcMain } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import { queryAll, run } from '../database'

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
  description: string
  protocolConfig: Record<string, unknown>
}

export interface ExportFolder {
  name: string
  description: string
  auth: { type: string; config: Record<string, unknown> }
  ssl: string
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
  description: string | null
  protocol_config: string | null
  sort_order: number
}

export function tryParse<T>(val: unknown, fallback: T): T {
  try { return val ? JSON.parse(String(val)) as T : fallback } catch { return fallback }
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
    requests: (folderRequests.get(folder.id) ?? []).map(mapRequest),
    folders: (childFolders.get(folder.id) ?? []).map((child) => mapFolderTree(child, childFolders, folderRequests)),
  }))

  return { $schema: SCHEMA, exportedAt: new Date().toISOString(), collections }
}

function importRequests(requests: ExportRequest[], folderId: string, now: number): void {
  for (const [index, request] of requests.entries()) {
    const requestId = crypto.randomUUID()
    run(
      `INSERT INTO requests
         (id, folder_id, name, method, url, params, headers, body_type, body_content,
          auth_type, auth_config, ssl_verification, protocol, protocol_config,
          description, is_dirty, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [
        requestId,
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
        index,
        now,
        now,
      ]
    )
  }
}

function importFolder(folder: ExportFolder, parentId: string, sortOrder: number, now: number): void {
  const folderId = crypto.randomUUID()
  run(
    `INSERT INTO folders
      (id, parent_id, name, description, source, source_meta, integration_id, auth_type, auth_config,
       ssl_verification, hidden, collapsed, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'local', NULL, NULL, ?, ?, ?, 0, 0, ?, ?, ?)`,
    [
      folderId,
      parentId,
      folder.name,
      folder.description ?? '',
      folder.auth?.type ?? 'none',
      JSON.stringify(folder.auth?.config ?? {}),
      folder.ssl ?? 'inherit',
      sortOrder,
      now,
      now,
    ]
  )
  importRequests(folder.requests ?? [], folderId, now)
  // fall back to `groups` for exports created before the folder-tree refactor
  const children = folder.folders ?? folder.groups ?? []
  for (const [index, child] of children.entries()) {
    importFolder(child, folderId, index, now)
  }
}

export function importData(data: PostlyExportFile): number {
  const now = Date.now()
  for (const [collectionIndex, collection] of data.collections.entries()) {
    const collectionId = crypto.randomUUID()
    run(
      `INSERT INTO folders
        (id, parent_id, name, description, source, source_meta, integration_id, auth_type, auth_config,
         ssl_verification, hidden, collapsed, sort_order, created_at, updated_at)
       VALUES (?, NULL, ?, ?, ?, NULL, NULL, ?, ?, ?, 0, 0, ?, ?, ?)`,
      [
        collectionId,
        collection.name,
        collection.description ?? '',
        collection.source ?? 'local',
        collection.auth?.type ?? 'none',
        JSON.stringify(collection.auth?.config ?? {}),
        collection.ssl ?? 'inherit',
        collectionIndex,
        now,
        now,
      ]
    )
    importRequests(collection.requests ?? [], collectionId, now)
    // fall back to `groups` for exports created before the folder-tree refactor
    const topFolders = collection.folders ?? collection.groups ?? []
    for (const [folderIndex, folder] of topFolders.entries()) {
      importFolder(folder, collectionId, folderIndex, now)
    }
  }
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
}
