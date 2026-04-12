import { ipcMain, BrowserWindow, nativeTheme } from 'electron'

export function registerWindowHandlers(): void {
  ipcMain.handle('postly:window:set-theme', (_event, theme: 'dark' | 'light') => {
    nativeTheme.themeSource = theme
  })

  ipcMain.handle('postly:window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })

  ipcMain.handle('postly:window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win?.isMaximized()) win.unmaximize()
    else win?.maximize()
  })

  ipcMain.handle('postly:window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  ipcMain.handle('postly:window:is-maximized', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false
  })
}

export function attachWindowEvents(win: BrowserWindow): void {
  win.on('maximize', () => win.webContents.send('postly:window:maximize-change', true))
  win.on('unmaximize', () => win.webContents.send('postly:window:maximize-change', false))
}
