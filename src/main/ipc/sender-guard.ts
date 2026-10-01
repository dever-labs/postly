import { ipcMain } from 'electron'

type HandleFn = typeof ipcMain.handle

/** True when the URL belongs to the app's own renderer (packaged file:// or the dev server origin). */
export function isTrustedSenderUrl(url: string, devServerUrl = process.env['ELECTRON_RENDERER_URL']): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol === 'file:') return true
  if (!devServerUrl) return false
  try {
    return parsed.origin === new URL(devServerUrl).origin
  } catch {
    return false
  }
}

/**
 * Wraps ipcMain.handle so every handler rejects calls that do not originate
 * from the app's own renderer frame. Must run before handlers are registered.
 */
export function installIpcSenderGuard(): void {
  const original: HandleFn = ipcMain.handle.bind(ipcMain)
  ipcMain.handle = ((channel, listener) =>
    original(channel, (event, ...args) => {
      const url = event.senderFrame?.url ?? ''
      if (!isTrustedSenderUrl(url)) {
        throw new Error(`Blocked IPC call to "${channel}" from untrusted origin`)
      }
      return listener(event, ...args)
    })) as HandleFn
}
