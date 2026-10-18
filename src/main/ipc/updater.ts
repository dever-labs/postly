import { ipcMain } from 'electron'
import { checkForUpdates, downloadUpdate, installUpdate, applyFeedUrl, getEnterpriseConfig } from '../services/updater'

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function registerUpdaterHandlers(): void {
  ipcMain.handle('postly:updater:check', () => {
    try {
      checkForUpdates()
      return { data: true }
    } catch (err) {
      return { error: toMessage(err) }
    }
  })

  ipcMain.handle('postly:updater:download', () => {
    try {
      downloadUpdate()
      return { data: true }
    } catch (err) {
      return { error: toMessage(err) }
    }
  })

  ipcMain.handle('postly:updater:install', () => {
    try {
      installUpdate()
      return { data: true }
    } catch (err) {
      return { error: toMessage(err) }
    }
  })

  ipcMain.handle('postly:updater:set-feed', (_, args: { url: string }) => {
    try {
      // Enterprise bundled config always wins — user cannot override it
      const enterprise = getEnterpriseConfig()
      if (!enterprise.updateUrl) {
        applyFeedUrl(args.url || undefined)
      }
      return { data: true }
    } catch (err) {
      return { error: toMessage(err) }
    }
  })

  ipcMain.handle('postly:updater:get-enterprise-config', () => {
    try {
      return { data: getEnterpriseConfig() }
    } catch (err) {
      return { error: toMessage(err) }
    }
  })
}
