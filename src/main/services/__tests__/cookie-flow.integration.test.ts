/**
 * Real-server tests for the cookie jar: Set-Cookie capture, automatic sending,
 * redirect hops and the manual Cookie header override.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'http'
import type { AddressInfo } from 'net'
import { executeRequest, type CookieJarHook, type HttpRequest, type LogEntry } from '../http-executor'
import { applySetCookies, cookieHeaderFor, listCookies, type StoredCookie } from '../cookie-jar'

let server: http.Server
let base = ''
const seen: Array<{ path: string; cookie: string | undefined }> = []

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({ path: req.url ?? '', cookie: req.headers.cookie })
    if (req.url === '/login') {
      res.setHeader('Set-Cookie', ['sid=s3cret; Path=/; HttpOnly', 'theme=dark; Path=/; Max-Age=3600'])
      res.end('ok')
    } else if (req.url === '/hop') {
      res.statusCode = 302
      res.setHeader('Set-Cookie', 'hopped=1; Path=/')
      res.setHeader('Location', '/landing')
      res.end()
    } else {
      res.end('ok')
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => { server.close() })

const req = (path: string, headers: Record<string, string> = {}): HttpRequest => ({
  method: 'GET', url: base + path, headers, bodyType: 'none', authType: 'none', authConfig: {},
})

function makeJar(enabled = true): { rows: StoredCookie[]; hook: CookieJarHook } {
  const state = { rows: [] as StoredCookie[] }
  const hook: CookieJarHook = {
    enabled,
    attach: (url) => (enabled ? cookieHeaderFor(state.rows, url) : { header: '', names: [] }),
    store: (url, setCookie) => {
      const out = applySetCookies(enabled ? state.rows : [], url, setCookie)
      if (enabled) state.rows = out.rows
      return out.stored
    },
  }
  return { get rows() { return state.rows }, hook }
}

describe('cookie jar over real HTTP', () => {
  it('stores cookies from one response and sends them on the next', async () => {
    const jar = makeJar()
    await executeRequest(req('/login'), { cookieJar: jar.hook })
    expect(listCookies(jar.rows).map((c) => c.name).sort()).toEqual(['sid', 'theme'])
    seen.length = 0
    const logs: LogEntry[] = []
    await executeRequest(req('/profile'), { cookieJar: jar.hook, onLog: (e) => logs.push(e) })
    expect(seen[0].cookie).toBe('sid=s3cret; theme=dark')
    const text = logs.map((l) => l.message).join('\n')
    expect(text).toContain('sending 2 from the jar (sid, theme)')
    expect(text).not.toContain('s3cret')
  })

  it('lets a manual Cookie header win and says so', async () => {
    const jar = makeJar()
    await executeRequest(req('/login'), { cookieJar: jar.hook })
    seen.length = 0
    const logs: LogEntry[] = []
    await executeRequest(req('/profile', { cookie: 'manual=1' }), { cookieJar: jar.hook, onLog: (e) => logs.push(e) })
    expect(seen[0].cookie).toBe('manual=1')
    expect(logs.some((l) => /Cookie header set on the request/.test(l.message))).toBe(true)
    expect(logs.every((l) => !l.message.includes('manual=1'))).toBe(true)
  })

  it('captures cookies set on redirect hops and sends them to the next hop', async () => {
    const jar = makeJar()
    seen.length = 0
    const res = await executeRequest(req('/hop'), { cookieJar: jar.hook })
    expect(res.cookies?.map((c) => c.name)).toEqual(['hopped'])
    expect(seen.map((s) => s.path)).toEqual(['/hop', '/landing'])
    expect(seen[1].cookie).toBe('hopped=1')
    expect(listCookies(jar.rows).map((c) => c.name)).toEqual(['hopped'])
  })

  it('does not store or send anything when the jar is disabled, but still reports the cookies', async () => {
    const jar = makeJar(false)
    const res = await executeRequest(req('/login'), { cookieJar: jar.hook })
    expect(res.cookies).toHaveLength(2)
    expect(jar.rows).toEqual([])
    seen.length = 0
    await executeRequest(req('/profile'), { cookieJar: jar.hook })
    expect(seen[0].cookie).toBeUndefined()
  })
})
