import { BrowserWindow, dialog, ipcMain } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import { queryAll, run } from '../database'

// ─── Schema ────────────────────────────────────────────────────────────────

const SCHEMA = 'postly/v1'

interface ExportRequest {
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

interface ExportGroup {
  name: string
  description: string
  auth: { type: string; config: Record<string, unknown> }
  ssl: string
  requests: ExportRequest[]
}

interface ExportCollection {
  name: string
  description: string
  source: string
  integrationName?: string
  auth: { type: string; config: Record<string, unknown> }
  ssl: string
  groups: ExportGroup[]
}

export interface PostlyExportFile {
  $schema: string
  exportedAt: string
  collections: ExportCollection[]
}

// ─── Build export object from DB ───────────────────────────────────────────

function buildExport(collectionIds?: string[]): PostlyExportFile {
  const rows = collectionIds && collectionIds.length > 0
    ? queryAll(
        `SELECT * FROM collections WHERE id IN (${collectionIds.map(() => '?').join(',')}) ORDER BY created_at ASC`,
        collectionIds
      )
    : queryAll('SELECT * FROM collections ORDER BY created_at ASC')

  const collections = (rows as Record<string, unknown>[]).map((col) => {
    const groupRows = queryAll(
      'SELECT * FROM groups WHERE collection_id = ? ORDER BY sort_order ASC',
      [col.id]
    ) as Record<string, unknown>[]

    const groups: ExportGroup[] = groupRows.map((grp) => {
      const reqRows = queryAll(
        'SELECT * FROM requests WHERE group_id = ? ORDER BY sort_order ASC',
        [grp.id]
      ) as Record<string, unknown>[]

      const requests: ExportRequest[] = reqRows.map((r) => ({
        name: String(r.name ?? ''),
        method: String(r.method ?? 'GET'),
        url: String(r.url ?? ''),
        protocol: String(r.protocol ?? 'http'),
        params: tryParse(r.params, []),
        headers: tryParse(r.headers, []),
        bodyType: String(r.body_type ?? 'none'),
        bodyContent: String(r.body_content ?? ''),
        auth: { type: String(r.auth_type ?? 'none'), config: tryParse(r.auth_config, {}) },
        ssl: String(r.ssl_verification ?? 'inherit'),
        description: String(r.description ?? ''),
        protocolConfig: tryParse(r.protocol_config, {}),
      }))

      return {
        name: String(grp.name ?? ''),
        description: String(grp.description ?? ''),
        auth: { type: String(grp.auth_type ?? 'none'), config: tryParse(grp.auth_config, {}) },
        ssl: String(grp.ssl_verification ?? 'inherit'),
        requests,
      }
    })

    const integrationRow = col.integration_id
      ? (queryAll('SELECT name FROM integrations WHERE id = ?', [col.integration_id]) as Record<string, unknown>[])[0]
      : null

    return {
      name: String(col.name ?? ''),
      description: String(col.description ?? ''),
      source: String(col.source ?? 'local'),
      integrationName: integrationRow ? String(integrationRow.name) : undefined,
      auth: { type: String(col.auth_type ?? 'none'), config: tryParse(col.auth_config, {}) },
      ssl: String(col.ssl_verification ?? 'inherit'),
      groups,
    }
  })

  return { $schema: SCHEMA, exportedAt: new Date().toISOString(), collections }
}

// ─── Insert imported data into DB ──────────────────────────────────────────

function importData(data: PostlyExportFile): number {
  const now = Date.now()
  for (const col of data.collections) {
    const colId = crypto.randomUUID()
    run(
      `INSERT INTO collections (id, name, source, description, auth_type, auth_config, ssl_verification, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [colId, col.name, col.source ?? 'local', col.description ?? '', col.auth?.type ?? 'none',
       JSON.stringify(col.auth?.config ?? {}), col.ssl ?? 'inherit', now, now]
    )
    for (const [gi, grp] of col.groups.entries()) {
      const grpId = crypto.randomUUID()
      run(
        `INSERT INTO groups (id, collection_id, name, description, collapsed, hidden, sort_order, auth_type, auth_config, ssl_verification, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?)`,
        [grpId, colId, grp.name, grp.description ?? '', gi,
         grp.auth?.type ?? 'none', JSON.stringify(grp.auth?.config ?? {}),
         grp.ssl ?? 'inherit', now, now]
      )
      for (const [ri, req] of grp.requests.entries()) {
        const reqId = crypto.randomUUID()
        run(
          `INSERT INTO requests
             (id, group_id, name, method, url, params, headers, body_type, body_content,
              auth_type, auth_config, ssl_verification, protocol, protocol_config,
              description, is_dirty, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
          [reqId, grpId, req.name, req.method ?? 'GET', req.url ?? '',
           JSON.stringify(req.params ?? []), JSON.stringify(req.headers ?? []),
           req.bodyType ?? 'none', req.bodyContent ?? '',
           req.auth?.type ?? 'none', JSON.stringify(req.auth?.config ?? {}),
           req.ssl ?? 'inherit', req.protocol ?? 'http',
           JSON.stringify(req.protocolConfig ?? {}),
           req.description ?? '', ri, now, now]
        )
      }
    }
  }
  return data.collections.length
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function tryParse<T>(val: unknown, fallback: T): T {
  try { return val ? JSON.parse(String(val)) as T : fallback } catch { return fallback }
}

function winFromEvent(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

// ─── IPC handlers ──────────────────────────────────────────────────────────

export function registerExportImportHandlers(): void {
  /** Export one or more collections to a .postly.json file via save dialog. */
  ipcMain.handle('postly:export', async (event, args: { collectionIds?: string[] } = {}) => {
    try {
      const win = winFromEvent(event)
      const data = buildExport(args.collectionIds)
      const defaultName = data.collections.length === 1
        ? `${data.collections[0].name.replace(/[^a-z0-9_-]/gi, '_')}.postly.json`
        : `postly-export.json`

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

  /** Open a .postly.json file via open dialog and import all collections in it. */
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
}
