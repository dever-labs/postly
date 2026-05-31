import { app, BrowserWindow } from 'electron'

export type UpdaterEventType = 'checking' | 'available' | 'not-available' | 'progress' | 'downloaded' | 'error'

export interface UpdaterEvent {
  type: UpdaterEventType
  version?: string
  percent?: number
  error?: string
}

let win: BrowserWindow | null = null

function emit(event: UpdaterEvent) {
  if (win && !win.isDestroyed()) {
    win.webContents.send('postly:updater:event', event)
  }
}

export function initUpdater(mainWindow: BrowserWindow): void {
  // Always store win so we can emit events in dev mode too
  win = mainWindow

  if (!app.isPackaged) return

  // Lazy import — electron-updater is only loaded in packaged builds to avoid
  // cross-platform binary issues during development.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null

  autoUpdater.on('checking-for-update', () => emit({ type: 'checking' }))
  autoUpdater.on('update-available', (info: { version?: string }) => emit({ type: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => emit({ type: 'not-available' }))
  autoUpdater.on('download-progress', (progress: { percent: number }) => emit({ type: 'progress', percent: Math.round(progress.percent) }))
  autoUpdater.on('update-downloaded', (info: { version?: string }) => emit({ type: 'downloaded', version: info.version }))
  autoUpdater.on('error', (err: Error) => emit({ type: 'error', error: err.message }))
}

export function checkForUpdates(): void {
  if (!app.isPackaged) {
    // In dev mode give the user visible feedback rather than silently no-op
    emit({ type: 'checking' })
    setTimeout(() => emit({ type: 'not-available' }), 800)
    return
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
  autoUpdater.checkForUpdates().catch(() => { /* handled via error event */ })
}

export function downloadUpdate(): void {
  if (!app.isPackaged) return
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
  autoUpdater.downloadUpdate().catch(() => { /* handled via error event */ })
}

export function installUpdate(): void {
  if (!app.isPackaged) return
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
  autoUpdater.quitAndInstall(false, true)
}

export function setUpdateFeedUrl(feedUrl: string): void {
  if (!app.isPackaged) return
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
  autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl })
}
