/**
 * Real-network tests: a local HTTP forward proxy sits between executeRequest()
 * and a local target server.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import http from 'http'
import type { AddressInfo } from 'net'

const state = { settings: undefined as string | undefined }
vi.mock('../../database', () => ({
  queryOne: vi.fn(() => (state.settings === undefined ? undefined : { value: state.settings })),
}))
vi.mock('electron', () => ({ session: { defaultSession: { resolveProxy: vi.fn(async () => 'DIRECT') } } }))

import { executeRequest, type HttpRequest } from '../http-executor'

let target: http.Server
let proxy: http.Server
let targetPort = 0
let proxyPort = 0
let proxied: string[] = []
let proxyAuth: (string | undefined)[] = []
let requireAuth = false

const req = (url: string): HttpRequest => ({ method: 'GET', url, headers: {}, bodyType: 'none', authType: 'none', authConfig: {} })

beforeAll(async () => {
  target = http.createServer((_, res) => { res.end('from-target') })
  await new Promise<void>((r) => target.listen(0, '127.0.0.1', r))
  targetPort = (target.address() as AddressInfo).port

  proxy = http.createServer((clientReq, clientRes) => {
    proxyAuth.push(clientReq.headers['proxy-authorization'] as string | undefined)
    if (requireAuth && !clientReq.headers['proxy-authorization']) {
      clientRes.writeHead(407, { 'Proxy-Authenticate': 'Basic realm="t"' }).end()
      return
    }
    proxied.push(clientReq.url ?? '')
    const u = new URL(clientReq.url ?? '')
    const up = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: clientReq.method }, (r) => {
      clientRes.writeHead(r.statusCode ?? 502, r.headers)
      r.pipe(clientRes)
    })
    up.end()
  })
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r))
  proxyPort = (proxy.address() as AddressInfo).port
})

afterAll(async () => {
  await Promise.all([target, proxy].map((s) => new Promise((r) => s.close(r))))
})

beforeEach(() => {
  proxied = []
  proxyAuth = []
  requireAuth = false
  state.settings = JSON.stringify({ mode: 'manual', url: `http://127.0.0.1:${proxyPort}`, username: '', password: '', bypass: '' })
})

describe('executeRequest through a proxy', () => {
  it('routes requests through the configured manual proxy and logs it', async () => {
    const logs: string[] = []
    const res = await executeRequest(req(`http://127.0.0.1:${targetPort}/hello`), { onLog: (e) => logs.push(e.message) })
    expect(res.status).toBe(200)
    expect(res.body).toBe('from-target')
    expect(proxied).toEqual([`http://127.0.0.1:${targetPort}/hello`])
    expect(logs.some((l) => l.startsWith('Proxy: http://127.0.0.1:'))).toBe(true)
  })

  it('goes direct when the host is on the bypass list', async () => {
    state.settings = JSON.stringify({ mode: 'manual', url: `http://127.0.0.1:${proxyPort}`, bypass: '127.0.0.1' })
    const logs: string[] = []
    const res = await executeRequest(req(`http://127.0.0.1:${targetPort}/`), { onLog: (e) => logs.push(e.message) })
    expect(res.body).toBe('from-target')
    expect(proxied).toEqual([])
    expect(logs).toContain('Proxy: none (direct)')
  })

  it('goes direct when proxy mode is none', async () => {
    state.settings = JSON.stringify({ mode: 'none' })
    await executeRequest(req(`http://127.0.0.1:${targetPort}/`))
    expect(proxied).toEqual([])
  })

  it('sends proxy credentials', async () => {
    requireAuth = true
    state.settings = JSON.stringify({ mode: 'manual', url: `http://127.0.0.1:${proxyPort}`, username: 'user', password: 'pw' })
    const res = await executeRequest(req(`http://127.0.0.1:${targetPort}/`))
    expect(res.status).toBe(200)
    expect(proxyAuth[0]).toBe(`Basic ${Buffer.from('user:pw').toString('base64')}`)
  })

  it('reports a missing-credentials proxy with an actionable message', async () => {
    requireAuth = true
    const res = await executeRequest(req(`http://127.0.0.1:${targetPort}/`))
    expect(res.status).toBe(407)
    expect(proxied).toEqual([])
  })

  it('explains an unreachable proxy', async () => {
    state.settings = JSON.stringify({ mode: 'manual', url: 'http://127.0.0.1:1' })
    const res = await executeRequest(req(`http://127.0.0.1:${targetPort}/`))
    expect(res.status).toBe(0)
    expect(res.body).toMatch(/Could not reach proxy http:\/\/127\.0\.0\.1:1/)
  })
})
