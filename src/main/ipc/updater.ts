import { ipcMain } from 'electron'
import { checkForUpdates, downloadUpdate, installUpdate, setUpdateFeedUrl } from '../services/updater'

export function registerUpdaterHandlers(): void {
  ipcMain.handle('postly:updater:check', () => {
    try {
      checkForUpdates()
      return { data: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('postly:updater:download', () => {
    try {
      downloadUpdate()
      return { data: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('postly:updater:install', () => {
    try {
      installUpdate()
      return { data: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('postly:updater:set-feed', (_, args: { url: string }) => {
    try {
      setUpdateFeedUrl(args.url)
      return { data: true }
    } catch (err) {
      return { error: String(err) }
    }
  })
}
