import { ipcMain } from 'electron'
import axios from 'axios'
import { run } from '../database'
import { getProxySettings, toPublicProxySettings, resolveProxy, installAxiosProxy, type ProxyMode } from '../services/proxy'

interface ProxySetArgs {
  mode: ProxyMode
  url: string
  username: string
  /** Undefined keeps the stored password; an empty string clears it. */
  password?: string
  bypass: string
}

export function registerProxyHandlers(): void {
  installAxiosProxy(axios)

  ipcMain.handle('postly:proxy:get', async () => {
    try { return { data: toPublicProxySettings(getProxySettings()) } } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:proxy:set', async (_, args: ProxySetArgs) => {
    try {
      if (!['system', 'manual', 'none'].includes(args.mode)) return { error: 'Invalid proxy mode' }
      const url = (args.url ?? '').trim()
      if (args.mode === 'manual' && url) {
        try {
          const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`)
          if (!['http:', 'https:', 'socks4:', 'socks5:'].includes(parsed.protocol)) return { error: 'Proxy URL must be http, https, socks4 or socks5' }
        } catch { return { error: 'Invalid proxy URL' } }
      }
      const current = getProxySettings()
      const next = {
        mode: args.mode,
        url,
        username: args.username ?? '',
        password: args.password ?? current.password,
        bypass: args.bypass ?? '',
      }
      run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['proxy', JSON.stringify(next)])
      return { data: toPublicProxySettings(next) }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:proxy:test', async (_, args: { url: string }) => {
    try {
      const proxy = await resolveProxy(args.url)
      return { data: { proxy: proxy?.display ?? null } }
    } catch (err) { return { error: String(err) } }
  })
}
