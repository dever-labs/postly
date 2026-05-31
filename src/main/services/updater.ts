import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'

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
  win = mainWindow
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  // Suppress electron-updater's own logger to avoid cluttering the console
  autoUpdater.logger = null

  autoUpdater.on('checking-for-update', () => {
    emit({ type: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    emit({ type: 'available', version: (info as { version?: string }).version })
  })

  autoUpdater.on('update-not-available', () => {
    emit({ type: 'not-available' })
  })

  autoUpdater.on('download-progress', (progress: { percent: number }) => {
    emit({ type: 'progress', percent: Math.round(progress.percent) })
  })

  autoUpdater.on('update-downloaded', (info) => {
    emit({ type: 'downloaded', version: (info as { version?: string }).version })
  })

  autoUpdater.on('error', (err: Error) => {
    emit({ type: 'error', error: err.message })
  })
}

export function checkForUpdates(): void {
  if (!app.isPackaged) return
  autoUpdater.checkForUpdates().catch(() => { /* handled via error event */ })
}

export function downloadUpdate(): void {
  autoUpdater.downloadUpdate().catch(() => { /* handled via error event */ })
}

export function installUpdate(): void {
  autoUpdater.quitAndInstall(false, true)
}

export function setUpdateFeedUrl(feedUrl: string): void {
  autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl })
}
