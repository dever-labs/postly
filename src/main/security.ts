import { session, shell, type BrowserWindow, type Session, type WebPreferences } from 'electron'

/** Baseline web preferences for every BrowserWindow we create. */
export const SECURE_WEB_PREFERENCES: WebPreferences = {
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
}

export function isLoopbackHost(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(hostname.toLowerCase())
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

function matchesCallbackUrl(target: URL, callbackUrl: string): boolean {
  try {
    const callback = new URL(callbackUrl)
    return target.protocol === callback.protocol
      && target.hostname === callback.hostname
      && target.port === callback.port
      && target.pathname === callback.pathname
  } catch {
    return false
  }
}

export function isAllowedAuthNavigation(target: string, callbackUrls: string[] = []): boolean {
  try {
    const url = new URL(target)
    if (callbackUrls.some((callbackUrl) => matchesCallbackUrl(url, callbackUrl))) return true
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

export function denySessionPermissions(targetSession: Session): boolean {
  if (targetSession === session.defaultSession) {
    console.warn('[security] Refused to install deny-all permission handlers on defaultSession')
    return false
  }
  targetSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  targetSession.setPermissionCheckHandler(() => false)
  return true
}

/** Auth windows may navigate within the OAuth flow, but never open popups or request extra permissions. */
export function lockDownAuthWindow(win: BrowserWindow, callbackUrls: string[] = []): void {
  const session = (win.webContents as Electron.WebContents & { session?: Session }).session
  if (session) denySessionPermissions(session)
  win.webContents.setWindowOpenHandler?.(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (isAllowedAuthNavigation(url, callbackUrls)) return
    event.preventDefault()
    console.warn(`[security] Blocked auth-window navigation to unsupported URL: ${url}`)
  })
}
