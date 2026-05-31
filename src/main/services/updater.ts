import { app, BrowserWindow } from 'electron'

export type UpdaterEventType = 'checking' | 'available' | 'not-available' | 'progress' | 'downloaded' | 'error'

export interface UpdaterEvent {
  type: UpdaterEventType
  version?: string
  percent?: number
  error?: string
}

type AutoUpdater = {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  logger: unknown
  on(event: string, handler: (...args: unknown[]) => void): void
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void
  setFeedURL(options: { provider: string; url: string }): void
}

let win: BrowserWindow | null = null
let _autoUpdater: AutoUpdater | null = null

function getAutoUpdater(): AutoUpdater {
  if (_autoUpdater) return _autoUpdater
  // Lazy import — electron-updater is only loaded in packaged builds to avoid
  // cross-platform binary issues during development.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('electron-updater') as { autoUpdater: AutoUpdater }).autoUpdater
}

function emit(event: UpdaterEvent) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('postly:updater:event', event)
  }
}

export function initUpdater(mainWindow: BrowserWindow): void {
  // Always store win so we can emit events in dev mode too
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
    // In dev mode give the user visible feedback rather than silently no-op
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

export function setUpdateFeedUrl(feedUrl: string): void {
  if (!app.isPackaged) return
  getAutoUpdater().setFeedURL({ provider: 'generic', url: feedUrl })
}

/** Inject a mock autoUpdater — for unit tests only. */
export function __setAutoUpdaterForTesting(au: AutoUpdater | null): void {
  _autoUpdater = au
}
