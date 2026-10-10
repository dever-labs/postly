import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = { row: undefined as string | undefined }
vi.mock('../../database', () => ({
  queryOne: vi.fn(() => (state.row === undefined ? undefined : { value: state.row })),
}))
vi.mock('electron', () => ({ session: { defaultSession: { resolveProxy: vi.fn(async () => 'DIRECT') } } }))

import {
  isBypassed, parsePacResult, parseProxySettings, toPublicProxySettings, resolveProxy,
  describeProxyError, getProxySettings, splitUrlCredentials, PROXY_DEFAULTS, type ProxySettings,
} from '../proxy'

const manual = (over: Partial<ProxySettings> = {}): ProxySettings => ({ ...PROXY_DEFAULTS, mode: 'manual', url: 'http://proxy.test:8080', ...over })

beforeEach(() => {
  state.row = undefined
  for (const k of ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy']) delete process.env[k]
})

describe('isBypassed', () => {
  it.each([
    ['http://localhost/x', 'localhost', true],
    ['http://api.internal.example.com/', '.internal.example.com', true],
    ['http://api.internal.example.com/', 'internal.example.com', true],
    ['http://example.com/', 'internal.example.com', false],
    ['http://notinternal.example.com/', 'internal.example.com', false],
    ['http://any.host/', '*', true],
    ['http://a.test:8080/', 'a.test:8080', true],
    ['http://a.test:9090/', 'a.test:8080', false],
    ['https://a.test/', 'a.test:443', true],
    ['http://a.test/', ' , ,', false],
    ['http://a.test/', 'x.test, a.test', true],
    ['http://[::1]:3000/', '[::1]', true],
    ['http://[::1]:3000/', '::1', true],
    ['http://[::1]:3000/', '[::1]:3000', true],
    ['http://[::1]:3000/', '[::1]:4000', false],
    ['http://10.1.2.3/', '10.0.0.0/8', true],
    ['http://11.1.2.3/', '10.0.0.0/8', false],
    ['http://192.168.1.77/', '192.168.1.0/24', true],
    ['http://192.168.2.77/', '192.168.1.0/24', false],
    ['http://example.com/', '10.0.0.0/8', false],
  ])('%s vs "%s" -> %s', (url, list, expected) => {
    expect(isBypassed(new URL(url), list)).toBe(expected)
  })
})

describe('splitUrlCredentials', () => {
  it('moves embedded credentials out of the URL', () => {
    expect(splitUrlCredentials('http://u:p%40ss@proxy.test:8080')).toEqual({ url: 'http://proxy.test:8080', username: 'u', password: 'p@ss' })
    expect(splitUrlCredentials('u:pw@proxy.test:3128')).toEqual({ url: 'proxy.test:3128', username: 'u', password: 'pw' })
    expect(splitUrlCredentials('http://proxy.test:8080')).toEqual({ url: 'http://proxy.test:8080', username: '', password: '' })
  })

  it('redacts credentials from public settings', () => {
    expect(JSON.stringify(toPublicProxySettings(manual({ url: 'http://u:secret@p.test:1' })))).not.toContain('secret')
  })
})

describe('parsePacResult', () => {
  it.each([
    ['PROXY p.test:3128; DIRECT', 'http://p.test:3128'],
    ['HTTPS p.test:443', 'https://p.test:443'],
    ['SOCKS5 s.test:1080', 'socks5://s.test:1080'],
    ['SOCKS s.test:1080', 'socks5://s.test:1080'],
    ['SOCKS4 s.test:1080', 'socks4://s.test:1080'],
    ['DIRECT', null],
    ['', null],
  ])('%s', (input, expected) => expect(parsePacResult(input)).toBe(expected))
})

describe('settings', () => {
  it('defaults to system mode and tolerates garbage', () => {
    expect(parseProxySettings(undefined)).toEqual(PROXY_DEFAULTS)
    expect(parseProxySettings('not json')).toEqual(PROXY_DEFAULTS)
    expect(parseProxySettings(JSON.stringify({ mode: 'bogus', url: 5 }))).toEqual(PROXY_DEFAULTS)
  })

  it('never exposes the password publicly', () => {
    const pub = toPublicProxySettings(manual({ password: 'hunter2' }))
    expect(JSON.stringify(pub)).not.toContain('hunter2')
    expect(pub.hasPassword).toBe(true)
  })

  it('falls back to defaults when the database is unavailable', async () => {
    const { queryOne } = await import('../../database')
    vi.mocked(queryOne).mockImplementationOnce(() => { throw new Error('Database not initialized') })
    expect(getProxySettings()).toEqual(PROXY_DEFAULTS)
  })
})

describe('resolveProxy', () => {
  it('returns null in none mode and for non-http URLs', async () => {
    expect(await resolveProxy('http://x.test', { settings: { ...PROXY_DEFAULTS, mode: 'none' } })).toBeNull()
    expect(await resolveProxy('ftp://x.test', { settings: manual() })).toBeNull()
    expect(await resolveProxy('not a url', { settings: manual() })).toBeNull()
  })

  it('uses the manual proxy and hides credentials in the display string', async () => {
    const r = await resolveProxy('https://x.test', { settings: manual({ username: 'u', password: 'p@ss' }) })
    expect(r?.display).toBe('http://proxy.test:8080')
    expect(r?.display).not.toMatch(/p@ss|u:/)
  })

  it('accepts a proxy without a scheme', async () => {
    expect((await resolveProxy('http://x.test', { settings: manual({ url: 'proxy.test:3128' }) }))?.display).toBe('http://proxy.test:3128')
  })

  it('honors the bypass list and an empty manual URL', async () => {
    expect(await resolveProxy('http://localhost:3000', { settings: manual({ bypass: 'localhost' }) })).toBeNull()
    expect(await resolveProxy('http://x.test', { settings: manual({ url: '' }) })).toBeNull()
  })

  it('supports socks proxies', async () => {
    const r = await resolveProxy('https://x.test', { settings: manual({ url: 'socks5://s.test:1080' }) })
    expect(r?.display).toBe('socks5://s.test:1080')
    expect(r?.httpAgent).toBe(r?.httpsAgent)
  })

  it('reuses agents for identical settings but separates TLS modes', async () => {
    const a = await resolveProxy('https://x.test', { settings: manual() })
    const b = await resolveProxy('https://y.test', { settings: manual() })
    const c = await resolveProxy('https://x.test', { settings: manual(), rejectUnauthorized: false })
    expect(a).toBe(b)
    expect(c).not.toBe(a)
  })

  it('system mode reads environment variables and NO_PROXY', async () => {
    process.env.HTTPS_PROXY = 'env-proxy.test:9000'
    process.env.NO_PROXY = 'skip.test'
    const sys = { ...PROXY_DEFAULTS }
    expect((await resolveProxy('https://x.test', { settings: sys }))?.display).toBe('http://env-proxy.test:9000')
    expect(await resolveProxy('https://skip.test', { settings: sys })).toBeNull()
  })

  it('system mode falls back to the OS resolver', async () => {
    const { session } = await import('electron')
    vi.mocked(session.defaultSession.resolveProxy).mockResolvedValueOnce('PROXY os.test:3128')
    expect((await resolveProxy('http://x.test', { settings: { ...PROXY_DEFAULTS } }))?.display).toBe('http://os.test:3128')
  })
})

describe('describeProxyError', () => {
  const proxy = { display: 'http://p.test:1', httpAgent: {}, httpsAgent: {} } as never
  it('explains auth failures and unreachable proxies', () => {
    expect(describeProxyError('Proxy responded with 407', proxy)).toMatch(/requires authentication/)
    expect(describeProxyError('connect ECONNREFUSED 1.2.3.4:1', proxy)).toMatch(/Could not reach proxy http:\/\/p\.test:1/)
    expect(describeProxyError('something else', proxy)).toBe('something else')
  })
})
