import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers: Record<string, (ev: unknown, args?: unknown) => Promise<{ data?: Record<string, unknown>; error?: string }>> = {}
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn((c: string, h: never) => { handlers[c] = h }) },
  session: { defaultSession: { resolveProxy: vi.fn(async () => 'DIRECT') } },
}))

const store = new Map<string, string>()
vi.mock('../../database', () => ({
  queryOne: vi.fn((_sql: string, [key]: string[]) => (store.has(key) ? { value: store.get(key) } : undefined)),
  queryAll: vi.fn(() => [...store].map(([key, value]) => ({ key, value }))),
  run: vi.fn((_sql: string, [key, value]: string[]) => { store.set(key, value) }),
}))

import { registerProxyHandlers } from '../proxy'
import { registerSettingsHandlers } from '../settings'

beforeEach(() => {
  store.clear()
  registerProxyHandlers()
  registerSettingsHandlers()
})

describe('proxy IPC', () => {
  it('stores settings and never returns the password', async () => {
    const set = await handlers['postly:proxy:set'](null, { mode: 'manual', url: 'proxy.test:8080', username: 'u', password: 'hunter2', bypass: 'localhost' })
    expect(set.data).toMatchObject({ mode: 'manual', hasPassword: true })
    for (const out of [
      await handlers['postly:proxy:get'](null),
      await handlers['postly:settings:get'](null, { key: 'proxy' }),
      await handlers['postly:settings:get-all'](null),
    ]) {
      expect(JSON.stringify(out)).not.toContain('hunter2')
    }
  })

  it('keeps the saved password when none is supplied and clears it on empty string', async () => {
    await handlers['postly:proxy:set'](null, { mode: 'manual', url: 'p.test:1', username: 'u', password: 'secret', bypass: '' })
    await handlers['postly:proxy:set'](null, { mode: 'manual', url: 'p.test:1', username: 'u', bypass: '' })
    expect(JSON.parse(store.get('proxy') as string).password).toBe('secret')
    await handlers['postly:proxy:set'](null, { mode: 'manual', url: 'p.test:1', username: 'u', password: '', bypass: '' })
    expect(JSON.parse(store.get('proxy') as string).password).toBe('')
  })

  it('moves credentials typed into the URL into the stored fields and never returns them', async () => {
    const set = await handlers['postly:proxy:set'](null, { mode: 'manual', url: 'http://bob:topsecret@p.test:8080', username: '', bypass: '' })
    expect(JSON.stringify(set)).not.toContain('topsecret')
    expect(JSON.parse(store.get('proxy') as string)).toMatchObject({ url: 'http://p.test:8080', username: 'bob', password: 'topsecret' })
    expect(JSON.stringify(await handlers['postly:settings:get'](null, { key: 'proxy' }))).not.toContain('topsecret')
  })

  it('validates mode and URL scheme', async () => {
    expect((await handlers['postly:proxy:set'](null, { mode: 'bogus', url: '', username: '', bypass: '' })).error).toMatch(/mode/)
    expect((await handlers['postly:proxy:set'](null, { mode: 'manual', url: 'ftp://p.test', username: '', bypass: '' })).error).toMatch(/http, https, socks4 or socks5/)
  })

  it('blocks writing proxy settings through the generic settings channel', async () => {
    expect((await handlers['postly:settings:set'](null, { key: 'proxy', value: { mode: 'none' } })).error).toBeDefined()
    expect(store.has('proxy')).toBe(false)
  })

  it('reports which proxy a URL would use', async () => {
    await handlers['postly:proxy:set'](null, { mode: 'manual', url: 'http://p.test:8080', username: '', bypass: 'skip.test' })
    expect((await handlers['postly:proxy:test'](null, { url: 'https://x.test' })).data).toEqual({ proxy: 'http://p.test:8080' })
    expect((await handlers['postly:proxy:test'](null, { url: 'https://skip.test' })).data).toEqual({ proxy: null })
  })
})
