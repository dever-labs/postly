import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { executeRequest, type HttpRequest, type StreamMessage } from '../http-executor'

const scratchRoot = path.join(__dirname, '.scratch-http-executor')
const uploadFile = path.join(scratchRoot, 'upload.txt')
const binaryFile = path.join(scratchRoot, 'payload.bin')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64')

let server: http.Server
let base = ''
const seen: {
  contentType?: string
  body?: Buffer
  path?: string
} = {}

function request(overrides: Partial<HttpRequest> = {}): HttpRequest {
  return {
    method: 'GET',
    url: `${base}/`,
    headers: {},
    bodyType: 'none',
    authType: 'none',
    authConfig: {},
    ...overrides,
  }
}

beforeAll(async () => {
  fs.rmSync(scratchRoot, { recursive: true, force: true })
  fs.mkdirSync(scratchRoot, { recursive: true })
  fs.writeFileSync(uploadFile, 'uploaded from disk')
  fs.writeFileSync(binaryFile, Buffer.from([0, 1, 2, 3, 254, 255]))

  server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      seen.contentType = req.headers['content-type']
      seen.body = Buffer.concat(chunks)
      seen.path = req.url ?? '/'

      if (req.url === '/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write('id: 1\nevent: tick\ndata: hello\n\n')
        res.end('id: 2\nevent: tick\ndata: world\n\n')
        return
      }

      if (req.url === '/image') {
        res.writeHead(200, { 'Content-Type': 'image/png' })
        res.end(png)
        return
      }

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        contentType: req.headers['content-type'],
        body: Buffer.concat(chunks).toString('utf8'),
        path: req.url,
      }))
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}, 30_000)

afterAll(() => {
  server.closeAllConnections()
  server.close()
  fs.rmSync(scratchRoot, { recursive: true, force: true })
})

describe('http-executor over real HTTP', () => {
  it('sends multipart form-data with file contents from disk', async () => {
    const response = await executeRequest(request({
      method: 'POST',
      url: `${base}/upload`,
      bodyType: 'form-data',
      body: JSON.stringify([
        { key: 'name', value: 'postly', enabled: true, fieldType: 'text' },
        { key: 'attachment', value: uploadFile, enabled: true, fieldType: 'file' },
      ]),
    }))

    expect(response.status).toBe(200)
    expect(seen.contentType).toContain('multipart/form-data; boundary=')
    expect(seen.body?.toString('utf8')).toContain('uploaded from disk')
    expect(seen.body?.toString('utf8')).toContain('filename="upload.txt"')
  })

  it('sends binary request bodies from a file path unchanged', async () => {
    const response = await executeRequest(request({
      method: 'POST',
      url: `${base}/binary`,
      bodyType: 'binary',
      body: binaryFile,
    }))

    expect(response.status).toBe(200)
    expect(seen.body).toEqual(Buffer.from([0, 1, 2, 3, 254, 255]))
  })

  it('serializes GraphQL requests with parsed variables', async () => {
    const response = await executeRequest(request({
      method: 'POST',
      url: `${base}/graphql`,
      bodyType: 'graphql',
      body: JSON.stringify({ query: 'query User($id: ID!) { user(id: $id) { id } }', variables: '{"id":"123"}' }),
    }))

    expect(response.status).toBe(200)
    expect(JSON.parse(seen.body?.toString('utf8') ?? '{}')).toEqual({
      query: 'query User($id: ID!) { user(id: $id) { id } }',
      variables: { id: '123' },
    })
    expect(seen.contentType).toBe('application/json')
  })

  it('streams SSE responses through onStream and returns the final buffered body', async () => {
    const messages: StreamMessage[] = []
    const response = await executeRequest(request({ url: `${base}/stream` }), {
      onStream: (message) => messages.push(message),
    })

    expect(response.status).toBe(200)
    expect(messages[0]).toMatchObject({ type: 'start', kind: 'sse', status: 200 })
    const eventMessages = messages.filter((message): message is Extract<StreamMessage, { type: 'events' }> => message.type === 'events')
    expect(eventMessages.flatMap((message) => message.events.map((event) => event.data))).toEqual(['hello', 'world'])
    expect(response.body).toContain('hello')
    expect(response.body).toContain('world')
  })

  it('returns binary responses as raw bytes without decoding them into body text', async () => {
    const response = await executeRequest(request({ url: `${base}/image` }))

    expect(response.status).toBe(200)
    expect(response.binary).toBe(true)
    expect(response.raw).toEqual(png)
    expect(response.body).toBe('')
  })
})
