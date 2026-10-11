import { ipcMain } from 'electron'
import { queryOne } from '../database'
import { clearCookies, deleteCookie, listCookies, upsertCookie, type CookieRecord } from '../services/cookie-jar'
import { activeEnvKey, loadCookies, saveCookies } from '../services/cookie-store'

type CookieId = { name: string; domain: string; path: string }

export function registerCookieHandlers(): void {
  ipcMain.handle('postly:cookies:list', async () => {
    try {
      const envKey = activeEnvKey()
      const env = envKey ? queryOne<{ name: string }>('SELECT name FROM environments WHERE id = ?', [envKey]) : null
      return { data: { environment: env?.name ?? null, cookies: listCookies(loadCookies(envKey)) } }
    } catch (err) { return { error: String(err) } }
  })
  ipcMain.handle('postly:cookies:upsert', async (_, args: { cookie: CookieRecord; previous?: CookieId }) => {
    try {
      const envKey = activeEnvKey()
      saveCookies(envKey, upsertCookie(loadCookies(envKey), args.cookie, args.previous))
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })
  ipcMain.handle('postly:cookies:delete', async (_, args: CookieId) => {
    try {
      const envKey = activeEnvKey()
      saveCookies(envKey, deleteCookie(loadCookies(envKey), args))
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })
  ipcMain.handle('postly:cookies:clear', async (_, args?: { domain?: string }) => {
    try {
      const envKey = activeEnvKey()
      saveCookies(envKey, clearCookies(loadCookies(envKey), args?.domain))
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })
}
