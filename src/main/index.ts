import { app, BrowserWindow, shell, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { platform } from 'process'
import { initDatabase } from './database'
import { registerAllIpcHandlers } from './ipc'

function createWindow(): void {
  // Use ICO on Windows for proper multi-resolution title bar / taskbar icon
  const iconFile = platform === 'win32' ? 'icon.ico' : 'icon.png'
  const icon = nativeImage.createFromPath(join(__dirname, '../../resources', iconFile))

  // titleBarOverlay adds native Win32 caption buttons (close/min/max) in the
  // top-right corner while keeping our custom title bar look everywhere else.
  // Height matches the sidebar tab strip (~44px).
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#030712',
    titleBarStyle: platform === 'darwin' ? 'hiddenInset' : 'hidden',
    ...(platform === 'win32' && {
      titleBarOverlay: { color: '#030712', symbolColor: '#d1d5db', height: 44 },
    }),
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (!app.isPackaged) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] ?? 'http://localhost:5173')
    // Skip DevTools when running E2E tests — they create a second BrowserWindow
    // that interferes with Playwright's firstWindow() detection.
    if (!process.env['PLAYWRIGHT']) {
      win.webContents.openDevTools()
    }
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
