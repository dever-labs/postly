/** Real-server tests for Server-Sent Events and NDJSON streaming responses. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'http'
import type { AddressInfo } from 'net'
import { executeRequest, type HttpRequest, type StreamMessage } from '../http-executor'
import type { StreamEvent } from '../../../shared/stream'

let server: http.Server
let base = ''
const seenLastEventId: Array<string | undefined> = []

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seenLastEventId.push(req.headers['last-event-id'] as string | undefined)
    if (req.url === '/sse') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('id: 1\nevent: greet\ndata: hel')
      setTimeout(() => res.write('lo\n\nid: 2\ndata: line1\ndata: line2\n\n'), 40)
      setTimeout(() => res.end(), 80)
    } else if (req.url === '/ndjson') {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' })
      res.write('{"n":1}\n{"n":')
      setTimeout(() => { res.write('2}\n'); res.end() }, 30)
    } else if (req.url === '/forever') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('id: 1\ndata: first\n\n')
      const t = setInterval(() => res.write(': ping\n'), 20)
      res.on('close', () => clearInterval(t))
    } else if (req.url === '/slow') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      let i = 0
      const t = setInterval(() => { res.write(`data: ${++i}\n\n`); if (i === 6) { clearInterval(t); res.end() } }, 100)
      res.on('close', () => clearInterval(t))
    } else if (req.url === '/idle') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.write('data: only\n\n')
    } else {
      res.setHeader('Content-Type', 'application/json')
      res.end('{"a":1}')
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => { server.closeAllConnections(); server.close() })

const req = (path: string, headers: Record<string, string> = {}): HttpRequest => ({
  method: 'GET', url: base + path, headers, bodyType: 'none', authType: 'none', authConfig: {},
})

function recorder() {
  const messages: StreamMessage[] = []
  const events = () => messages.flatMap((m) => (m.type === 'events' ? m.events : [])) as StreamEvent[]
  return { messages, events, onStream: (m: StreamMessage) => messages.push(m) }
}

describe('streaming responses', () => {
  it('parses Server-Sent Events as they arrive', async () => {
    const rec = recorder()
    const res = await executeRequest(req('/sse'), { onStream: rec.onStream })
    expect(res.status).toBe(200)
    expect(rec.messages[0]).toMatchObject({ type: 'start', kind: 'sse', status: 200 })
    expect(rec.events().map((e) => [e.id, e.event, e.data])).toEqual([
      ['1', 'greet', 'hello'],
      ['2', undefined, 'line1\nline2'],
    ])
    expect(res.body).toContain('data: line2')
  })

  it('delivers events before the response completes', async () => {
    const rec = recorder()
    let sawEventsBeforeEnd = false
    const pending = executeRequest(req('/slow'), { onStream: (m) => { rec.onStream(m); if (m.type === 'events') sawEventsBeforeEnd = true } })
    await new Promise((r) => setTimeout(r, 250))
    expect(sawEventsBeforeEnd).toBe(true)
    await pending
    expect(rec.events()).toHaveLength(6)
  })

  it('parses NDJSON lines split across chunks', async () => {
    const rec = recorder()
    await executeRequest(req('/ndjson'), { onStream: rec.onStream })
    expect(rec.messages[0]).toMatchObject({ kind: 'ndjson' })
    expect(rec.events().map((e) => e.data)).toEqual(['{"n":1}', '{"n":2}'])
  })

  it('stops cleanly on abort and keeps what was received', async () => {
    const rec = recorder()
    const controller = new AbortController()
    const pending = executeRequest(req('/forever'), { signal: controller.signal, onStream: rec.onStream })
    await new Promise((r) => setTimeout(r, 150))
    controller.abort()
    const res = await pending
    expect(res.status).toBe(200)
    expect(res.body).toContain('data: first')
    expect(rec.events().map((e) => e.data)).toEqual(['first'])
  })

  it('applies the timeout to idle time rather than total stream duration', async () => {
    const rec = recorder()
    const res = await executeRequest(req('/slow'), { timeout: 300, onStream: rec.onStream })
    expect(res.status).toBe(200)
    expect(rec.events()).toHaveLength(6)
  })

  it('ends an idle stream once the timeout elapses and keeps received events', async () => {
    const rec = recorder()
    const res = await executeRequest(req('/idle'), { timeout: 200, onStream: rec.onStream })
    expect(res.status).toBe(200)
    expect(rec.events().map((e) => e.data)).toEqual(['only'])
  })

  it('sends a Last-Event-ID header when provided', async () => {
    seenLastEventId.length = 0
    await executeRequest(req('/sse', { 'Last-Event-ID': '2' }), { onStream: () => {} })
    expect(seenLastEventId).toEqual(['2'])
  })

  it('still buffers and pretty-prints non-stream responses', async () => {
    const res = await executeRequest(req('/json'), { onStream: () => {} })
    expect(res.body).toBe('{\n  "a": 1\n}')
    expect(res.size).toBe(7)
  })

  it('treats event streams as plain text when no stream listener is given', async () => {
    const res = await executeRequest(req('/sse'))
    expect(res.body).toContain('id: 2')
  })
})
