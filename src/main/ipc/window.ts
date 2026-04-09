import { ipcMain, BrowserWindow, nativeTheme } from 'electron'
import { platform } from 'process'

export function registerWindowHandlers(): void {
  ipcMain.handle('postly:window:set-title-bar-overlay', (_event, data: { color: string; symbolColor: string; theme: 'dark' | 'light' }) => {
    // Keep nativeTheme in sync so Windows DWM renders caption button
    // hover effects correctly for the current color scheme.
    nativeTheme.themeSource = data.theme

    if (platform !== 'win32') return
    const win = BrowserWindow.getAllWindows()[0]
    win?.setTitleBarOverlay({ color: data.color, symbolColor: data.symbolColor, height: 44 })
  })
}
