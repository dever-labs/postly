/**
 * `postly://` protocol handling: OS registration, receiving links (macOS
 * `open-url`, Windows/Linux argv on first launch and `second-instance`), and
 * acting on them once the database and renderer are ready.
 *
 * Parsing/validation lives in services/deep-link.ts; nothing from a link is
 * used except a validated http(s) Backstage base URL and entity ref.
 */
import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import axios from 'axios'
import https from 'https'
import path from 'path'
import { queryAll, queryOne } from './database'
import {
  DEEP_LINK_PROTOCOL, formatEntityRef, parseDeepLink, sameBackstageBaseUrl,
  type EntityRef, type OpenBackstageEntityLink,
} from './services/deep-link'
import { findEntityCollection } from './services/backstage-entity'
import { withBackstageAccessToken } from './services/backstage-session'
import { connectIntegration, createIntegration } from './ipc/integrations'

export const DEEP_LINK_OPEN_CHANNEL = 'postly:deep-link:open'

let getWindow: () => BrowserWindow | null = () => null
let rendererReady = false
const queue: string[] = []
let chain: Promise<void> = Promise.resolve()

/** Makes Postly the OS handler for postly:// (packaged builds; dev only with POSTLY_DEV_PROTOCOL=1). */
export function registerProtocolClient(): void {
  try {
    if (!process.defaultApp) {
      app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL)
    } else if (process.env['POSTLY_DEV_PROTOCOL'] === '1' && process.argv[1]) {
      // Dev: electron.exe needs the app path so the OS launches this app, not a bare Electron.
      app.setAsDefaultProtocolClient(DEEP_LINK_PROTOCOL, process.execPath, [path.resolve(process.argv[1])])
    }
  } catch (err) {
    console.warn('[deep-link] could not register the postly:// protocol:', err)
  }
}

/** Queues a raw link; it is handled once the renderer has signalled it is ready. */
export function queueDeepLink(raw: string | undefined): void {
  if (!raw) return
  queue.push(raw)
  flush()
}

function flush(): void {
  if (!rendererReady) return
  while (queue.length > 0) {
    const raw = queue.shift() as string
    // One link at a time: each may show dialogs or run a browser sign-in.
    chain = chain.then(() => handleDeepLink(raw)).catch((err) => console.error('[deep-link] failed:', err))
  }
}

export function focusMainWindow(): void {
  const win = getWindow()
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** The renderer calls `postly:deep-link:ready` after subscribing to DEEP_LINK_OPEN_CHANNEL and once the DB is ready. */
export function registerDeepLinkHandlers(windowGetter: () => BrowserWindow | null): void {
  getWindow = windowGetter
  ipcMain.handle('postly:deep-link:ready', () => {
    rendererReady = true
    flush()
    return { data: true }
  })
}

async function showProblem(message: string, detail: string): Promise<void> {
  const win = getWindow()
  const options = { type: 'warning' as const, title: 'Postly', message, detail, buttons: ['OK'] }
  if (win && !win.isDestroyed()) await dialog.showMessageBox(win, options)
  else await dialog.showMessageBox(options)
}

function notifyRenderer(payload: { collectionId?: string }): void {
  const win = getWindow()
  if (win && !win.isDestroyed()) win.webContents.send(DEEP_LINK_OPEN_CHANNEL, payload)
}

interface IntegrationRow { id: string; base_url: string; client_id: string; token: string; status: string; ssl_verification: string }

function findBackstageSource(baseUrl: string): IntegrationRow | undefined {
  return queryAll<IntegrationRow>(
    `SELECT id, base_url, client_id, token, status, ssl_verification FROM integrations WHERE type = 'backstage' ORDER BY created_at ASC`,
  ).find((row) => sameBackstageBaseUrl(row.base_url, baseUrl))
}

function entityFetcher(integrationId: string): (ref: EntityRef) => Promise<unknown> {
  return async (ref) => {
    const row = queryOne<IntegrationRow>('SELECT id, base_url, client_id, token, status, ssl_verification FROM integrations WHERE id = ?', [integrationId])
    if (!row) return null
    const url = `${row.base_url.replace(/\/+$/, '')}/api/catalog/entities/by-name/${encodeURIComponent(ref.kind)}/${encodeURIComponent(ref.namespace)}/${encodeURIComponent(ref.name)}`
    const httpsAgent = row.ssl_verification === 'disabled'
      ? new https.Agent({ rejectUnauthorized: false }) // codeql[js/disabling-certificate-validation] -- intentional: user-controlled setting (Skip SSL verification toggle)
      : undefined
    const get = async (token: string) => {
      const res = await axios.get(url, {
        headers: token ? { Authorization: `Bearer ${token}`, Accept: 'application/json' } : { Accept: 'application/json' },
        httpsAgent,
        timeout: 15_000,
        validateStatus: (s) => s === 200 || s === 404,
      })
      return res.status === 404 ? null : res.data
    }
    return row.client_id === 'oauth' ? withBackstageAccessToken(integrationId, get) : get(row.token ?? '')
  }
}

async function connectOrReport(integrationId: string, what: string): Promise<boolean> {
  const res = await connectIntegration({ id: integrationId })
  if (res.error) {
    await showProblem(`Could not connect to ${what}`, res.error)
    return false
  }
  return true
}

async function openBackstageEntity(link: OpenBackstageEntityLink): Promise<void> {
  const ref = formatEntityRef(link.entity)
  let source = findBackstageSource(link.backstageBaseUrl)
  let synced = false

  if (!source) {
    const win = getWindow()
    const options = {
      type: 'question' as const,
      title: 'Add Backstage source?',
      message: `Add ${link.backstageBaseUrl} to Postly?`,
      detail: `A link asked Postly to open ${ref} from ${link.backstageBaseUrl}, which isn't one of your sources yet.\n\n` +
        'Postly will add it as a Backstage source and open your browser to sign in (OAuth). Only continue if you trust this Backstage instance.',
      buttons: ['Add and sign in', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
    }
    const { response } = win && !win.isDestroyed() ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    if (response !== 0) return
    const created = await createIntegration({
      type: 'backstage',
      name: new URL(link.backstageBaseUrl).hostname,
      baseUrl: link.backstageBaseUrl,
      clientId: 'oauth',
    })
    const id = (created.data as { id?: string } | undefined)?.id
    if (created.error || !id) {
      await showProblem('Could not add the Backstage source', created.error ?? 'Unknown error')
      return
    }
    notifyRenderer({})
    const ok = await connectOrReport(id, link.backstageBaseUrl)
    notifyRenderer({})
    if (!ok) return
    synced = true
    source = findBackstageSource(link.backstageBaseUrl)
    if (!source) return
  } else if (source.status !== 'connected') {
    if (!await connectOrReport(source.id, link.backstageBaseUrl)) { notifyRenderer({}); return }
    synced = true
  }

  const sourceId = source.id
  const find = () => findEntityCollection(sourceId, link.entity, entityFetcher(sourceId))
  let collectionId: string | null = null
  try {
    collectionId = await find()
    if (!collectionId && !synced) {
      // The catalog may have gained the API since the last sync.
      if (await connectOrReport(sourceId, link.backstageBaseUrl)) collectionId = await find()
    }
  } catch (err) {
    // An OAuth session can expire between syncs: sign in again (browser) once, then retry.
    const retried = source.client_id === 'oauth' && !synced && await connectOrReport(sourceId, link.backstageBaseUrl)
    try {
      if (!retried) throw err
      collectionId = await find()
    } catch (finalErr) {
      await showProblem(`Could not look up ${ref}`, finalErr instanceof Error ? finalErr.message : String(finalErr))
      notifyRenderer({})
      return
    }
  }

  notifyRenderer(collectionId ? { collectionId } : {})
  if (!collectionId) {
    await showProblem(`${ref} was not found`, `No collection in ${link.backstageBaseUrl} contains ${ref}. It may have no OpenAPI, GraphQL or gRPC definition, or you may not have access to it.`)
  }
}

export async function handleDeepLink(raw: string): Promise<void> {
  focusMainWindow()
  let link: OpenBackstageEntityLink
  try {
    link = parseDeepLink(raw)
  } catch (err) {
    await showProblem('This Postly link is not valid', err instanceof Error ? err.message : String(err))
    return
  }
  await openBackstageEntity(link)
}
