/** Real-server tests for how response bodies are kept: binary fidelity, large bodies and text detection. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'http'
import type { AddressInfo } from 'net'
import { executeRequest, type HttpRequest } from '../http-executor'

// Every byte value, including ones that are invalid UTF-8, so any text round trip would corrupt it
const BINARY = Buffer.from(Array.from({ length: 256 }, (_, i) => i))
const LARGE = Buffer.alloc(6 * 1024 * 1024, 'a')

let server: http.Server
let base = ''

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/png') {
      res.writeHead(200, { 'Content-Type': 'image/png' })
      res.end(BINARY)
    } else if (req.url === '/unlabelled') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' })
      res.end(BINARY)
    } else if (req.url === '/svg') {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' })
      res.end('<svg xmlns="http://www.w3.org/2000/svg"/>')
    } else if (req.url === '/odd-text') {
      res.writeHead(200, { 'Content-Type': 'application/x-custom' })
      res.end('plain words')
    } else if (req.url === '/utf8') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('héllo wörld ✓')
    } else if (req.url === '/large') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end(LARGE)
    } else {
      res.setHeader('Content-Type', 'application/json')
      res.end('{"a":1}')
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => { server.closeAllConnections(); server.close() })

const req = (path: string): HttpRequest => ({
  method: 'GET', url: base + path, headers: {}, bodyType: 'none', authType: 'none', authConfig: {},
})

describe('response bodies', () => {
  it('keeps binary payloads byte-exact and does not decode them as text', async () => {
    const res = await executeRequest(req('/png'), {})
    expect(res.binary).toBe(true)
    expect(res.body).toBe('')
    expect(res.size).toBe(256)
    expect(Buffer.compare(res.raw as Buffer, BINARY)).toBe(0)
  })

  it('detects an unlabelled binary body by sniffing', async () => {
    const res = await executeRequest(req('/unlabelled'), {})
    expect(res.binary).toBe(true)
    expect(Buffer.compare(res.raw as Buffer, BINARY)).toBe(0)
  })

  it('treats SVG and unfamiliar text types as text', async () => {
    const svg = await executeRequest(req('/svg'), {})
    expect(svg.binary).toBeUndefined()
    expect(svg.body).toContain('<svg')
    const odd = await executeRequest(req('/odd-text'), {})
    expect(odd.binary).toBeUndefined()
    expect(odd.body).toBe('plain words')
  })

  it('keeps the exact bytes of text responses', async () => {
    const res = await executeRequest(req('/utf8'), {})
    expect(res.body).toBe('héllo wörld ✓')
    expect((res.raw as Buffer).toString('utf8')).toBe('héllo wörld ✓')
    expect(res.finalUrl).toBe(`${base}/utf8`)
  })

  it('still pretty-prints JSON for display', async () => {
    const res = await executeRequest(req('/json'), {})
    expect(res.body).toBe('{\n  "a": 1\n}')
    expect((res.raw as Buffer).toString()).toBe('{"a":1}')
  })

  it('shows only the start of a large body but keeps all of it for Save', async () => {
    const logs: string[] = []
    const res = await executeRequest(req('/large'), { onLog: (e) => logs.push(e.message) })
    expect(res.bodyTruncated).toBe(true)
    // The cap is applied per received chunk, so it can overshoot by up to one chunk
    expect(res.body.length).toBeGreaterThanOrEqual(5 * 1024 * 1024)
    expect(res.body.length).toBeLessThan(LARGE.length)
    expect(res.size).toBe(LARGE.length)
    expect((res.raw as Buffer).length).toBe(LARGE.length)
    expect(logs.some((m) => /showing the first/i.test(m))).toBe(true)
  })
})
