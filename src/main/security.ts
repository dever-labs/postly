import { shell, type BrowserWindow, type WebPreferences } from 'electron'

/** Baseline web preferences for every BrowserWindow we create. */
export const SECURE_WEB_PREFERENCES: WebPreferences = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
}

/** Only http(s) URLs may be handed to the OS; file:, custom protocols, etc. are refused. */
export function isSafeExternalUrl(raw: string): boolean {
  try {
    const { protocol } = new URL(raw)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

export function openExternalSafe(url: string): void {
  if (isSafeExternalUrl(url)) void shell.openExternal(url)
  else console.warn(`[security] Refused to open external URL with unsupported scheme: ${url}`)
}

/** True when `target` is the app's own page (dev-server origin, or the packaged index.html). */
export function isAppNavigation(target: string, appUrl: string): boolean {
  try {
    const t = new URL(target)
    const a = new URL(appUrl)
    if (a.protocol === 'file:') return t.protocol === 'file:' && t.pathname === a.pathname
    return t.origin === a.origin
  } catch {
    return false
  }
}

/** Denies new windows and in-app navigation away from the app; http(s) links open in the OS browser. */
export function lockDownWindow(win: BrowserWindow, appUrl: string): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (isAppNavigation(url, appUrl)) return
    event.preventDefault()
    openExternalSafe(url)
  })
}
