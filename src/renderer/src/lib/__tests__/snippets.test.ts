import { describe, it, expect } from 'vitest'
import { LANGUAGES, generateSnippet, type SnippetLanguage } from '../snippets'
import type { ExportableRequest } from '../snippets/model'

const base: ExportableRequest = {
  protocol: 'http', method: 'POST', url: 'https://api.test/items', params: [{ key: 'page', value: '2', enabled: true }] as never,
  headers: [{ key: 'X-Id', value: 'a"b', enabled: true }] as never,
  bodyType: 'raw-json', bodyContent: '{"name":"x\\"y","n":1}',
  authType: 'basic', authConfig: { username: 'bob', password: 'hunter2' },
  sslVerification: 'enabled', protocolConfig: {},
} as ExportableRequest

const gen = (lang: SnippetLanguage, over: Partial<ExportableRequest> = {}, secrets = true) =>
  generateSnippet(lang, { ...base, ...over }, { includeSecrets: secrets })!

describe('code snippets', () => {
  it('has a generator for every language and skips non-HTTP protocols', () => {
    for (const l of LANGUAGES) {
      expect(gen(l.id).code.length).toBeGreaterThan(10)
      expect(generateSnippet(l.id, { ...base, protocol: 'websocket' } as ExportableRequest, { includeSecrets: true })).toBeNull()
    }
  })

  it('fetch', () => {
    const c = gen('fetch').code
    expect(c).toContain('fetch("https://api.test/items?page=2"')
    expect(c).toContain('method: "POST"')
    expect(c).toContain('"X-Id": "a\\"b"')
    expect(c).toContain('btoa("bob:hunter2")')
    expect(c).toContain('JSON.stringify(')
  })

  it('axios and insecure TLS', () => {
    const c = gen('axios', { sslVerification: 'disabled' }).code
    expect(c).toContain('auth: { username: "bob", password: "hunter2" }')
    expect(c).toContain('rejectUnauthorized: false')
  })

  it('python', () => {
    const c = gen('python').code
    expect(c).toContain('requests.request(')
    expect(c).toContain('auth=("bob", "hunter2")')
    expect(gen('python', { sslVerification: 'disabled' }).code).toContain('verify=False')
  })

  it('go', () => {
    const c = gen('go').code
    expect(c).toContain('http.NewRequest("POST", "https://api.test/items?page=2"')
    expect(c).toContain('req.SetBasicAuth("bob", "hunter2")')
    expect(c).not.toContain('InsecureSkipVerify')
    expect(gen('go', { sslVerification: 'disabled' }).code).toContain('InsecureSkipVerify: true')
  })

  it('csharp puts Content-Type on the content', () => {
    const c = gen('csharp', { headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }] as never }).code
    expect(c).toContain('new StringContent(')
    expect(c).toContain('"application/json"')
    expect(c).not.toContain('TryAddWithoutValidation("Content-Type"')
  })

  it('redacts credentials unless secrets are included', () => {
    for (const l of LANGUAGES) {
      const out = gen(l.id, {}, false)
      expect(out.code).not.toContain('hunter2')
      expect(out.notes.join(' ')).toContain('placeholders')
    }
  })

  it('escapes quotes and newlines in raw bodies', () => {
    const c = gen('csharp', { bodyType: 'raw-text', bodyContent: 'a"b\nc' }).code
    expect(c).toContain('"a\\"b\\nc"')
  })
})
