import { ipcMain, BrowserWindow } from 'electron'
import { platform } from 'process'

export function registerWindowHandlers(): void {
  ipcMain.handle('postly:window:set-title-bar-overlay', (_event, data: { color: string; symbolColor: string }) => {
    if (platform !== 'win32') return
    const win = BrowserWindow.getAllWindows()[0]
    win?.setTitleBarOverlay({ color: data.color, symbolColor: data.symbolColor, height: 44 })
  })
}
