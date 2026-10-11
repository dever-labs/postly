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

  it('adds API keys as a header or query parameter and redacts them', () => {
    const header = generateSnippet('curl', { ...base, authType: 'apikey', authConfig: { key: 'X-Api-Key', value: 'abc', in: 'header' } } as ExportableRequest, { includeSecrets: true })
    expect(header?.code).toContain('X-Api-Key: abc')
    const query = generateSnippet('curl', { ...base, authType: 'apikey', authConfig: { key: 'api_key', value: 'abc', in: 'query' } } as ExportableRequest, { includeSecrets: false })
    expect(query?.code).toContain('api_key=<api-key>')
    expect(query?.code).not.toContain('abc')
  })

  const digest = { authType: 'digest', authConfig: { username: 'ann', password: 'pw' } } as const
  const aws = { authType: 'awsv4', authConfig: { accessKey: 'AKID', secretKey: 'SECRET', sessionToken: 'TOK', region: 'eu-west-1', service: 'execute-api' } } as const

  it('renders Digest where the client can answer the challenge', () => {
    expect(gen('curl', digest).code).toContain('--digest')
    expect(gen('curl', digest).code).toContain("-u 'ann:pw'")
    expect(gen('python', digest).code).toContain('from requests.auth import HTTPDigestAuth')
    expect(gen('python', digest).code).toContain('auth=HTTPDigestAuth("ann", "pw")')
    expect(gen('csharp', digest).code).toContain('Credentials = new NetworkCredential("ann", "pw")')
    expect(gen('csharp', digest).code).toContain('using System.Net;')
    expect(gen('curl', digest).notes.join(' ')).not.toMatch(/Digest/)
  })

  it('renders AWS Signature V4 for curl only', () => {
    const curl = gen('curl', aws)
    expect(curl.code).toContain("--aws-sigv4 'aws:amz:eu-west-1:execute-api'")
    expect(curl.code).toContain("-u 'AKID:SECRET'")
    expect(curl.code).toContain("x-amz-security-token: TOK")
    const py = gen('python', aws)
    expect(py.code).not.toContain('aws4auth')
    expect(py.notes.join(' ')).toMatch(/AWS/)
  })

  it('redacts Digest and AWS secrets unless included', () => {
    const d = gen('curl', digest, false)
    expect(d.code).toContain('<password>')
    expect(d.code).not.toContain('pw')
    const a = gen('curl', aws, false).code
    expect(a).toContain('<secret-key>')
    expect(a).toContain('<session-token>')
    expect(a).not.toContain('SECRET')
  })

  it('notes where a language cannot render Digest or AWS signing', () => {
    for (const lang of ['fetch', 'axios', 'go'] as const) {
      expect(gen(lang, digest).notes.join(' ')).toMatch(/Digest/)
      expect(gen(lang, aws).notes.join(' ')).toMatch(/AWS Signature/)
    }
    expect(gen('csharp', aws).notes.join(' ')).toMatch(/AWS Signature/)
  })
})
