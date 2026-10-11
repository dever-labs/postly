/** Real-server tests for API key, Digest and AWS Signature V4 authentication. */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import crypto from 'crypto'
import http from 'http'
import type { AddressInfo } from 'net'
import { clearDigestSessions, executeRequest, type HttpRequest, type LogEntry } from '../http-executor'

let server: http.Server
let base = ''
const seen: Array<{ url: string; headers: http.IncomingHttpHeaders }> = []
let nonce = 'abc123'
const md5 = (s: string) => crypto.createHash('md5').update(s).digest('hex')

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({ url: req.url ?? '', headers: req.headers })
    if (req.url === '/echo') {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        const body = Buffer.concat(chunks)
        const claimed = req.headers['x-amz-content-sha256']
        const actual = crypto.createHash('sha256').update(body).digest('hex')
        res.end(JSON.stringify({ body: body.toString(), hashMatches: claimed === undefined || claimed === actual }))
      })
    } else if (req.url?.startsWith('/digest')) {
      const auth = req.headers.authorization
      const p: Record<string, string> = {}
      for (const m of (auth ?? '').matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)) p[m[1]] = m[2] ?? m[3]
      const ha1 = md5(`alice:realm:wonderland`)
      const ha2 = md5(`${req.method}:${p.uri}`)
      const expected = md5(`${ha1}:${nonce}:${p.nc}:${p.cnonce}:auth:${ha2}`)
      if (auth?.startsWith('Digest ') && p.response === expected && p.uri === req.url) {
        res.end('welcome alice')
        return
      }
      res.writeHead(401, { 'WWW-Authenticate': `Digest realm="realm", nonce="${nonce}", qop="auth", algorithm=MD5` })
      res.end('denied')
    } else {
      res.end('ok')
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => { server.close() })

const req = (path: string, authType: string, authConfig: Record<string, string>, extra: Partial<HttpRequest> = {}): HttpRequest => ({
  method: 'GET', url: base + path, headers: {}, bodyType: 'none', authType, authConfig, ...extra,
})

describe('API key', () => {
  it('sends the key in a header', async () => {
    seen.length = 0
    const res = await executeRequest(req('/h', 'apikey', { key: 'X-Api-Key', value: 'k-123', in: 'header' }))
    expect(res.body).toBe('ok')
    expect(seen[0].headers['x-api-key']).toBe('k-123')
  })

  it('sends the key as a query parameter without writing it to the Console', async () => {
    seen.length = 0
    const logs: LogEntry[] = []
    await executeRequest(req('/q?a=1', 'apikey', { key: 'api_key', value: 'k-456', in: 'query' }), { onLog: (e) => logs.push(e) })
    expect(seen[0].url).toBe('/q?a=1&api_key=k-456')
    expect(logs.map((l) => l.message).join('\n')).not.toContain('k-456')
    expect(logs.some((l) => l.message.includes('query parameter'))).toBe(true)
  })
})

describe('Digest', () => {
  beforeEach(() => { clearDigestSessions(); nonce = 'abc123' })

  it('answers the 401 challenge and succeeds', async () => {
    seen.length = 0
    const logs: LogEntry[] = []
    const res = await executeRequest(req('/digest/path?x=1', 'digest', { username: 'alice', password: 'wonderland' }), { onLog: (e) => logs.push(e) })
    expect(res.status).toBe(200)
    expect(res.body).toBe('welcome alice')
    expect(seen).toHaveLength(2)
    expect(seen[0].headers.authorization).toBeUndefined()
    expect(logs.map((l) => l.message).join('\n')).not.toContain('wonderland')
    expect(logs.some((l) => l.message.includes('answering the challenge'))).toBe(true)
  })

  it('returns the 401 when the password is wrong', async () => {
    const res = await executeRequest(req('/digest', 'digest', { username: 'alice', password: 'nope' }))
    expect(res.status).toBe(401)
  })

  it('does not send credentials to a server that does not challenge', async () => {
    seen.length = 0
    const res = await executeRequest(req('/open', 'digest', { username: 'alice', password: 'x' }))
    expect(res.status).toBe(200)
    expect(seen).toHaveLength(1)
  })
})

describe('AWS Signature V4', () => {
  it('signs the request that is actually sent', async () => {
    seen.length = 0
    const logs: LogEntry[] = []
    await executeRequest(
      req('/sig?b=2&a=1', 'awsv4', { accessKey: 'AKIDEXAMPLE', secretKey: 'topsecret', region: 'eu-west-1', service: 'execute-api' }, { method: 'POST', bodyType: 'raw-json', body: '{"n":1}' }),
      { onLog: (e) => logs.push(e) }
    )
    const h = seen[0].headers
    expect(h.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/eu-west-1\/execute-api\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/)
    expect(h['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/)
    expect(logs.map((l) => l.message).join('\n')).not.toContain('topsecret')
  })

  it.each([['{"a":1}\n', '{"a":1}'], ['{not json {{var}}', '{not json {{var}}']])('sends exactly the bytes that were hashed (%j)', async (body, sent) => {
    const res = await executeRequest(
      req('/echo', 'awsv4', { accessKey: 'A', secretKey: 'S', region: 'r', service: 's3' }, { method: 'POST', bodyType: 'raw-json', body })
    )
    expect(JSON.parse(res.body)).toEqual({ body: sent, hashMatches: true })
  })

  it('warns and sends unsigned when configuration is incomplete', async () => {
    seen.length = 0
    const logs: LogEntry[] = []
    await executeRequest(req('/sig', 'awsv4', { accessKey: 'A' }), { onLog: (e) => logs.push(e) })
    expect(seen[0].headers.authorization).toBeUndefined()
    expect(logs.some((l) => l.level === 'warn')).toBe(true)
  })
})

describe('unknown auth types', () => {
  it('fall back to sending no credentials', async () => {
    seen.length = 0
    const res = await executeRequest(req('/x', 'from-the-future', { token: 't' }))
    expect(res.status).toBe(200)
    expect(seen[0].headers.authorization).toBeUndefined()
  })

  it('reuses the challenge: the second request needs one round trip with a higher nc', async () => {
    const r = () => req('/digest', 'digest', { username: 'alice', password: 'wonderland' })
    await executeRequest(r())
    seen.length = 0
    const res = await executeRequest(r())
    expect(res.status).toBe(200)
    expect(seen).toHaveLength(1)
    expect(seen[0].headers.authorization).toMatch(/nc=00000002/)
  })

  it('answers the new challenge when the nonce has gone stale', async () => {
    const r = () => req('/digest', 'digest', { username: 'alice', password: 'wonderland' })
    await executeRequest(r())
    nonce = 'rotated'
    seen.length = 0
    const res = await executeRequest(r())
    expect(res.status).toBe(200)
    expect(seen).toHaveLength(2)
    expect(seen[1].headers.authorization).toMatch(/nc=00000001/)
  })
})
