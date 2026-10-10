import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const state = { dir: '' }
vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  safeStorage: { isEncryptionAvailable: () => false },
}))

import { initDatabase } from '../../database'
import {
  recordHistory, listHistory, getHistoryEntry, deleteHistoryEntry, clearHistory, pruneHistory,
  maskHeaders, maskAuthConfig, maskUrl, maskBodyText, MAX_STORED_BODY_BYTES,
} from '../history'

const dirs: string[] = []
beforeEach(async () => {
  state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postly-hist-'))
  dirs.push(state.dir)
  await initDatabase()
})
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })))

const on = { enabled: true, limit: 500 }
const req = (over: Record<string, unknown> = {}) => ({
  method: 'GET', url: 'https://api.test/items', headers: {}, bodyType: 'none', authType: 'none', authConfig: {}, ...over,
})
const res = (over: Record<string, unknown> = {}) => ({
  status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, body: '{"ok":true}', duration: 12, size: 11, ...over,
})

describe('masking', () => {
  it('masks secret headers but keeps variable references and ordinary headers', () => {
    expect(maskHeaders({
      Authorization: 'Bearer abc.def', Cookie: 'sid=1', 'X-Api-Key': 'k', Accept: 'application/json',
      'X-Custom-Token': 'zzz', Authorization2: 'x',
    })).toEqual({
      Authorization: '••••••••', Cookie: '••••••••', 'X-Api-Key': '••••••••', Accept: 'application/json',
      'X-Custom-Token': '••••••••', Authorization2: 'x',
    })
    expect(maskHeaders({ Authorization: 'Bearer {{TOKEN}}', 'X-Api-Key': '{{KEY}}' })).toEqual({ Authorization: 'Bearer {{TOKEN}}', 'X-Api-Key': '{{KEY}}' })
    expect(maskHeaders({ Authorization: 'Bearer real-{{TOKEN}}' }).Authorization).toBe('••••••••')
  })

  it('masks literal auth secrets but keeps usernames and variable references', () => {
    expect(maskAuthConfig({ username: 'bob', password: 'pw', token: 't', clientId: 'cid', clientSecret: 's' }))
      .toEqual({ username: 'bob', password: '••••••••', token: '••••••••', clientId: 'cid', clientSecret: '••••••••' })
    expect(maskAuthConfig({ token: '{{TOKEN}}' })).toEqual({ token: '{{TOKEN}}' })
  })

  it('masks secret query parameters in URLs', () => {
    expect(maskUrl('https://a.test/x?api_key=SECRET&page=2&access_token=abc')).toBe('https://a.test/x?api_key=••••••••&page=2&access_token=••••••••')
    expect(maskUrl('https://a.test/x?token={{T}}')).toBe('https://a.test/x?token={{T}}')
    expect(maskUrl('https://a.test/x?q=1')).toBe('https://a.test/x?q=1')
  })
})

describe('body and params masking', () => {
  it('masks secret fields in JSON bodies, including nested ones, and keeps variables', () => {
    const out = JSON.parse(maskBodyText('{"user":"a","password":"hunter2","n":{"client_secret":"x","ok":1},"token":"{{TOKEN}}"}') as string)
    expect(out).toEqual({ user: 'a', password: '••••••••', n: { client_secret: '••••••••', ok: 1 }, token: '{{TOKEN}}' })
  })

  it('masks non-string secret values and arrays', () => {
    const out = JSON.parse(maskBodyText('{"password":123456,"refresh_tokens":["a","b"],"secret":true}') as string)
    expect(out).toEqual({ password: '••••••••', refresh_tokens: ['••••••••', '••••••••'], secret: '••••••••' })
  })

  it('does not throw on malformed percent-escapes and masks key/sig params consistently', () => {
    expect(maskUrl('https://a.test/x?token=100%&page=2')).toBe('https://a.test/x?token=••••••••&page=2')
    const id = recordHistory(req({ params: { key: 'AIza', sig: 's', page: '1' } }), res(), on) as string
    expect((getHistoryEntry(id) as NonNullable<ReturnType<typeof getHistoryEntry>>).request.params)
      .toEqual({ key: '••••••••', sig: '••••••••', page: '1' })
  })

  it('masks secret fields in urlencoded bodies', () => {
    expect(maskBodyText('grant_type=password&username=a&password=hunter2')).toBe('grant_type=password&username=a&password=••••••••')
  })

  it('leaves other content untouched', () => {
    expect(maskBodyText('plain text body')).toBe('plain text body')
    expect(maskBodyText('{"a":1}')).toBe('{"a":1}')
  })

  it('masks params, request body and response body when stored', () => {
    const id = recordHistory(
      req({ params: { api_key: 'sk-live', page: '2' }, body: '{"password":"p"}', bodyType: 'json' }),
      res({ body: '{"access_token":"abc"}' }), on) as string
    const e = getHistoryEntry(id) as NonNullable<ReturnType<typeof getHistoryEntry>>
    expect(e.request.params).toEqual({ api_key: '••••••••', page: '2' })
    expect(JSON.stringify(e.request)).not.toContain('"p"')
    expect(e.responseBody).not.toContain('abc')
  })
})

describe('recordHistory', () => {
  it('stores a masked request and the response summary', () => {
    const id = recordHistory(
      req({ method: 'POST', url: 'https://api.test/x?api_key=SECRET', headers: { Authorization: 'Bearer live-token' }, body: '{"a":1}', bodyType: 'raw-json', authType: 'bearer', authConfig: { token: 'live-token' } }),
      res({ status: 201, headers: { 'set-cookie': 'sid=abc', 'content-type': 'text/plain' } }), on
    )
    expect(id).toBeTruthy()
    const entry = getHistoryEntry(id as string)
    expect(entry).toMatchObject({ method: 'POST', status: 201, statusText: 'OK', duration: 12, size: 11, responseBody: '{"ok":true}', bodyTruncated: false })
    expect(JSON.stringify(entry)).not.toMatch(/live-token|SECRET|sid=abc/)
    expect(entry?.request).toMatchObject({ body: '{"a":1}', bodyType: 'raw-json', authType: 'bearer' })
  })

  it('does nothing when history is disabled or the limit is 0', () => {
    expect(recordHistory(req(), res(), { enabled: false, limit: 500 })).toBeNull()
    expect(recordHistory(req(), res(), { enabled: true, limit: 0 })).toBeNull()
    expect(listHistory()).toEqual([])
  })

  it('truncates large bodies on a character boundary and flags it', () => {
    const id = recordHistory(req(), res({ body: 'é'.repeat(MAX_STORED_BODY_BYTES) }), on) as string
    const entry = getHistoryEntry(id) as NonNullable<ReturnType<typeof getHistoryEntry>>
    expect(entry.bodyTruncated).toBe(true)
    expect(Buffer.byteLength(entry.responseBody)).toBeLessThanOrEqual(MAX_STORED_BODY_BYTES)
    expect(entry.responseBody).not.toContain('\uFFFD')
  })

  it('skips requests without a URL', () => {
    expect(recordHistory(req({ url: '  ' }), res({ status: 0 }), on)).toBeNull()
  })

  it('records failed requests (status 0)', () => {
    const id = recordHistory(req(), res({ status: 0, statusText: 'connect ECONNREFUSED', body: 'connect ECONNREFUSED' }), on) as string
    expect(getHistoryEntry(id)?.status).toBe(0)
  })

  it('prunes the oldest entries beyond the limit', () => {
    for (let i = 0; i < 5; i++) recordHistory(req({ url: `https://a.test/${i}` }), res(), { enabled: true, limit: 3 })
    expect(listHistory().map((e) => e.url)).toEqual(['https://a.test/4', 'https://a.test/3', 'https://a.test/2'])
    pruneHistory(1)
    expect(listHistory()).toHaveLength(1)
  })
})

describe('listHistory / delete / clear', () => {
  beforeEach(() => {
    recordHistory(req({ method: 'GET', url: 'https://a.test/users' }), res({ status: 200 }), on)
    recordHistory(req({ method: 'POST', url: 'https://a.test/orders' }), res({ status: 500 }), on)
    recordHistory(req({ method: 'GET', url: 'https://b.test/100%_done' }), res({ status: 404 }), on)
  })

  it('lists newest first and filters by url, method and status', () => {
    expect(listHistory().map((e) => e.status)).toEqual([404, 500, 200])
    expect(listHistory({ search: 'orders' })).toHaveLength(1)
    expect(listHistory({ search: 'post' })).toHaveLength(1)
    expect(listHistory({ search: '404' })[0].url).toContain('b.test')
  })

  it('treats LIKE wildcards in the search term literally', () => {
    expect(listHistory({ search: '100%_' })).toHaveLength(1)
    expect(listHistory({ search: '%' })).toHaveLength(1)
  })

  it('supports paging', () => {
    expect(listHistory({ limit: 2 })).toHaveLength(2)
    expect(listHistory({ limit: 2, offset: 2 })).toHaveLength(1)
  })

  it('deletes one entry and clears all', () => {
    const [first] = listHistory()
    deleteHistoryEntry(first.id)
    expect(listHistory()).toHaveLength(2)
    expect(getHistoryEntry(first.id)).toBeNull()
    clearHistory()
    expect(listHistory()).toEqual([])
  })
})
