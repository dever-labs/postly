/** Real-server tests for per-request timeout and redirect options. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'http'
import type { AddressInfo } from 'net'
import { executeRequest, type HttpRequest } from '../http-executor'

let server: http.Server
let base = ''

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    if (url.pathname === '/slow') {
      setTimeout(() => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('done') }, 400)
    } else if (url.pathname === '/hop') {
      const n = Number(url.searchParams.get('n') ?? '0')
      if (n > 0) { res.writeHead(302, { Location: `/hop?n=${n - 1}` }); res.end() }
      else { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('arrived') }
    } else {
      res.writeHead(404); res.end()
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((resolve) => { server.close(() => resolve()) }))

const req = (path: string): HttpRequest => ({ method: 'GET', url: `${base}${path}`, headers: {}, bodyType: 'none', authType: 'none', authConfig: {} })

describe('timeout', () => {
  it('fails a slow endpoint under a short timeout and succeeds under a longer one', async () => {
    const short = await executeRequest(req('/slow'), { timeout: 100 })
    expect(short.status).toBe(0)
    expect(short.statusText).toBe('timeout of 100ms exceeded')

    const long = await executeRequest(req('/slow'), { timeout: 3000 })
    expect(long.status).toBe(200)
    expect(long.body).toBe('done')
  })

  it('does not call a slow response a connect timeout', async () => {
    const res = await executeRequest(req('/slow'), { timeout: 100 })
    expect(res.statusText).not.toMatch(/connect/i)
  })

  it('reports an unreachable host as a connect timeout', async (ctx) => {
    // 10.255.255.1 black-holes SYNs on most networks; some sandboxes reject it immediately, which this cannot test
    const res = await executeRequest({ ...req('/'), url: 'http://10.255.255.1:81/' }, { timeout: 300 })
    if (!/timeout/i.test(res.statusText)) ctx.skip()
    expect(res.status).toBe(0)
    expect(res.statusText).toBe('connect timeout of 300ms exceeded (no connection to the server)')
  })
})

describe('redirects', () => {
  it('follows redirects up to the configured limit', async () => {
    const ok = await executeRequest(req('/hop?n=3'), { followRedirects: true, maxRedirects: 3 })
    expect(ok.status).toBe(200)
    expect(ok.body).toBe('arrived')

    const tooMany = await executeRequest(req('/hop?n=3'), { followRedirects: true, maxRedirects: 2 })
    expect(tooMany.status).toBe(0)
    expect(tooMany.statusText).toMatch(/redirects exceeded/i)
  })

  it('returns the redirect itself when following is off, whatever the limit', async () => {
    const res = await executeRequest(req('/hop?n=1'), { followRedirects: false, maxRedirects: 10 })
    expect(res.status).toBe(302)
    expect(res.headers['location']).toBe('/hop?n=0')
  })

  it('treats a limit of 0 as no redirects', async () => {
    const res = await executeRequest(req('/hop?n=1'), { followRedirects: true, maxRedirects: 0 })
    expect(res.status).toBe(302)
  })

  it('defaults to five redirects', async () => {
    expect((await executeRequest(req('/hop?n=5'), {})).status).toBe(200)
    expect((await executeRequest(req('/hop?n=6'), {})).status).toBe(0)
  })
})
