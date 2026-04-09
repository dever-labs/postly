import { ipcMain, BrowserWindow, nativeTheme } from 'electron'

export function registerWindowHandlers(): void {
  ipcMain.handle('postly:window:set-theme', (_event, theme: 'dark' | 'light') => {
    nativeTheme.themeSource = theme
  })

  ipcMain.handle('postly:window:minimize', () => {
    BrowserWindow.getAllWindows()[0]?.minimize()
  })

  ipcMain.handle('postly:window:maximize', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win?.isMaximized()) win.unmaximize()
    else win?.maximize()
  })

  ipcMain.handle('postly:window:close', () => {
    BrowserWindow.getAllWindows()[0]?.close()
  })

  ipcMain.handle('postly:window:is-maximized', () => {
    return BrowserWindow.getAllWindows()[0]?.isMaximized() ?? false
  })
}

export function attachWindowEvents(win: BrowserWindow): void {
  win.on('maximize', () => win.webContents.send('postly:window:maximize-change', true))
  win.on('unmaximize', () => win.webContents.send('postly:window:maximize-change', false))
}
