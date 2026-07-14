import { app, BrowserWindow, shell, Menu, nativeImage, ipcMain } from 'electron'
import { join } from 'path'
import { platform } from 'process'
import { initDatabase } from './database'
import { registerAllIpcHandlers, attachWindowEvents } from './ipc'
import { initUpdater, checkForUpdates, applyFeedUrl, getEnterpriseConfig } from './services/updater'
import { getGeneralSettings } from './ipc/settings-utils'

function createWindow(): BrowserWindow {
  // Use ICO on Windows for proper multi-resolution title bar / taskbar icon
  const iconFile = platform === 'win32' ? 'icon.ico' : 'icon.png'
  const icon = nativeImage.createFromPath(join(__dirname, '../../resources', iconFile))

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#030712',
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

  return win
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)

  // Register a readiness gate BEFORE window creation so the renderer can call
  // waitForReady() as soon as it boots. The promise resolves once initDatabase()
  // completes, allowing data-loading IPC calls to proceed safely.
  let dbResolve!: () => void
  const dbReadyPromise = new Promise<void>((resolve) => { dbResolve = resolve })
  ipcMain.handle('postly:ready', () => dbReadyPromise.then(() => ({ data: true })))

  registerAllIpcHandlers()
  const win = createWindow()
  attachWindowEvents(win)

  // Always init so dev-mode "check now" button can emit events back to renderer
  initUpdater(win)

  // Initialise the database — the window is already open while this runs.
  await initDatabase()
  dbResolve()

  if (app.isPackaged) {
    const generalSettings = getGeneralSettings()
    if (generalSettings.autoUpdate) {
      // Enterprise bundled config takes precedence over user setting.
      // Neither affects the default GitHub Releases channel used by normal builds.
      const enterprise = getEnterpriseConfig()
      const effectiveUrl = enterprise.updateUrl ?? generalSettings.updateFeedUrl
      applyFeedUrl(effectiveUrl)
      checkForUpdates()
    }
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const w = createWindow()
      attachWindowEvents(w)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
