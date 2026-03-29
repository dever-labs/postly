import { app, BrowserWindow, shell, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { platform } from 'process'
import { initDatabase } from './database'
import { registerAllIpcHandlers } from './ipc'

function createWindow(): void {
  // Use ICO on Windows for proper multi-resolution title bar / taskbar icon
  const iconFile = platform === 'win32' ? 'icon.ico' : 'icon.png'
  const icon = nativeImage.createFromPath(join(__dirname, '../../resources', iconFile))

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#030712',
    // 'hiddenInset' is macOS-only; use 'hidden' on Windows/Linux
    titleBarStyle: platform === 'darwin' ? 'hiddenInset' : 'hidden',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (!app.isPackaged) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] ?? 'http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  await initDatabase()
  registerAllIpcHandlers()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
