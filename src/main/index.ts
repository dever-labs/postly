import { app, BrowserWindow, Menu, nativeImage, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { platform } from 'process'
import { initDatabase, preloadSqlJs, flushPersist, quarantineUnreadableDatabase } from './database'
import { registerAllIpcHandlers, attachWindowEvents } from './ipc'
import { setUpdaterWindow, initUpdater, checkForUpdates, applyFeedUrl, getEnterpriseConfig } from './services/updater'
import { getGeneralSettings } from './ipc/settings-utils'
import { SECURE_WEB_PREFERENCES, lockDownWindow } from './security'

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
      ...SECURE_WEB_PREFERENCES
    }
  })

  const appUrl = app.isPackaged
    ? pathToFileURL(join(__dirname, '../renderer/index.html')).href
    : (process.env['ELECTRON_RENDERER_URL'] ?? 'http://localhost:5173')
  lockDownWindow(win, appUrl)

  if (!app.isPackaged) {
    win.loadURL(appUrl)
    // Skip DevTools when running E2E tests — they create a second BrowserWindow
    // that interferes with Playwright's firstWindow() detection.
    if (!process.env['PLAYWRIGHT']) {
      win.webContents.openDevTools()
    }
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

void preloadSqlJs().catch(() => {})

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

  // Cheap: lets dev-mode "check now" emit events. electron-updater itself is
  // loaded after startup (see below) so it stays off the critical path.
  setUpdaterWindow(win)

  // Initialise the database — the window is already open while this runs.
  try {
    await initDatabase()
  } catch (err) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'error',
      title: 'Postly cannot open its database',
      message: 'The Postly database could not be read.',
      detail:
        `${err instanceof Error ? err.message : String(err)}\n\n` +
        'This usually means the OS keychain entry that protects it is unavailable or the file is damaged. ' +
        'Quit and retry once the keychain is unlocked, or start fresh — the old files are kept next to the new ones (postly.db.unreadable-*).',
      buttons: ['Quit', 'Start fresh'],
      defaultId: 0,
      cancelId: 0
    })
    if (response === 0) {
      app.exit(1)
      return
    }
    try {
      quarantineUnreadableDatabase()
      await initDatabase()
    } catch (retryErr) {
      dialog.showErrorBox('Postly cannot start', `Could not create a new database: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`)
      app.exit(1)
      return
    }
  }
  dbResolve()

  if (app.isPackaged) {
    // Update checks are a background concern: wait until the UI has rendered,
    // then yield a few seconds so they never compete with startup work.
    const startUpdateCheck = (): void => {
      setTimeout(() => {
        initUpdater(win)
        const generalSettings = getGeneralSettings()
        if (generalSettings.autoUpdate) {
          // Enterprise bundled config takes precedence over user setting.
          // Neither affects the default GitHub Releases channel used by normal builds.
          const enterprise = getEnterpriseConfig()
          const effectiveUrl = enterprise.updateUrl ?? generalSettings.updateFeedUrl
          applyFeedUrl(effectiveUrl)
          checkForUpdates()
        }
      }, 3000)
    }
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', startUpdateCheck)
    else startUpdateCheck()
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const w = createWindow()
      attachWindowEvents(w)
    }
  })
})

app.on('before-quit', flushPersist)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
