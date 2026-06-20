import { app, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'

export type UpdaterEventType = 'checking' | 'available' | 'not-available' | 'progress' | 'downloaded' | 'error'

export interface UpdaterEvent {
  type: UpdaterEventType
  version?: string
  percent?: number
  error?: string
}

export interface EnterpriseConfig {
  /** Override the update feed with an internal mirror URL. When present,
   *  the generic provider is used instead of GitHub Releases. */
  updateUrl?: string
}

type AutoUpdater = {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  logger: unknown
  on(event: string, handler: (...args: unknown[]) => void): void
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void
  setFeedURL(options: Record<string, unknown>): void
}

/** Default GitHub publish config — mirrors electron-builder.yml */
const GITHUB_FEED = { provider: 'github', owner: 'dever-labs', repo: 'postly' }

let win: BrowserWindow | null = null
let _autoUpdater: AutoUpdater | null = null

function getAutoUpdater(): AutoUpdater {
  if (_autoUpdater) return _autoUpdater
  // Lazy import — only in packaged builds to avoid cross-platform binary issues
  return (require('electron-updater') as { autoUpdater: AutoUpdater }).autoUpdater
}

function emit(event: UpdaterEvent) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('postly:updater:event', event)
  }
}

/**
 * Reads an optional enterprise.json from the app's resources directory.
 * This file is bundled by IT at deployment time and takes precedence over
 * the user-level update feed URL setting.
 *
 * Format: { "updateUrl": "https://updates.internal.corp/postly/" }
 */
export function getEnterpriseConfig(): EnterpriseConfig {
  try {
    // process.resourcesPath is only available in a packaged Electron app
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
    if (!resourcesPath) return {}
    const configPath = path.join(resourcesPath, 'enterprise.json')
    if (!fs.existsSync(configPath)) return {}
    const raw = fs.readFileSync(configPath, 'utf-8')
    return JSON.parse(raw) as EnterpriseConfig
  } catch {
    return {}
  }
}

/**
 * Switch the autoUpdater to the appropriate provider:
 * - enterprise/user URL set → generic provider (internal mirror)
 * - no URL → revert to GitHub Releases (default product channel)
 *
 * The two channels are completely isolated — enterprise mirrors never
 * interfere with the standard GitHub release flow.
 */
export function applyFeedUrl(feedUrl: string | undefined): void {
  if (!app.isPackaged) return
  const au = getAutoUpdater()
  if (feedUrl) {
    au.setFeedURL({ provider: 'generic', url: feedUrl })
  } else {
    au.setFeedURL(GITHUB_FEED)
  }
}

export function initUpdater(mainWindow: BrowserWindow): void {
  win = mainWindow
  if (!app.isPackaged) return

  const au = getAutoUpdater()
  au.autoDownload = false
  au.autoInstallOnAppQuit = true
  au.logger = null

  au.on('checking-for-update', () => emit({ type: 'checking' }))
  au.on('update-available', (info: unknown) => emit({ type: 'available', version: (info as { version?: string }).version }))
  au.on('update-not-available', () => emit({ type: 'not-available' }))
  au.on('download-progress', (progress: unknown) => emit({ type: 'progress', percent: Math.round((progress as { percent: number }).percent) }))
  au.on('update-downloaded', (info: unknown) => emit({ type: 'downloaded', version: (info as { version?: string }).version }))
  au.on('error', (err: unknown) => emit({ type: 'error', error: (err as Error).message }))
}

export function checkForUpdates(): void {
  if (!app.isPackaged) {
    emit({ type: 'checking' })
    setTimeout(() => emit({ type: 'not-available' }), 800)
    return
  }
  getAutoUpdater().checkForUpdates().catch(() => { /* handled via error event */ })
}

export function downloadUpdate(): void {
  if (!app.isPackaged) return
  getAutoUpdater().downloadUpdate().catch(() => { /* handled via error event */ })
}

export function installUpdate(): void {
  if (!app.isPackaged) return
  getAutoUpdater().quitAndInstall(false, true)
}

/** @deprecated Use applyFeedUrl() directly. Kept for IPC back-compat. */
export function setUpdateFeedUrl(feedUrl: string): void {
  if (!app.isPackaged) return
  applyFeedUrl(feedUrl || undefined)
}

/** Inject a mock autoUpdater — for unit tests only. */
export function __setAutoUpdaterForTesting(au: AutoUpdater | null): void {
  _autoUpdater = au
}
