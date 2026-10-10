import { describe, it, expect } from 'vitest'
import { parseCurl, buildCurl, tokenize, looksLikeCurl } from '../curl'
import type { Request } from '@/types'

const must = (s: string) => {
  const r = parseCurl(s)
  if (!r) throw new Error('not parsed')
  return r
}
const kv = (r: { headers: { key: string; value: string }[] }) => Object.fromEntries(r.headers.map((h) => [h.key, h.value]))

describe('tokenize', () => {
  it('handles bash quoting, continuations and ANSI-C strings', () => {
    expect(tokenize("curl 'https://a.b/x y' \\\n  -H \"A: \\\"q\\\"\" $'-d\\n'")).toEqual(['curl', 'https://a.b/x y', '-H', 'A: "q"', '-d\n'])
  })
  it('handles cmd.exe caret escaping (Chrome "Copy as cURL (cmd)")', () => {
    const cmd = 'curl "https://a.b/p" ^\n  -H ^"accept: */*^" ^\n  --data-raw ^"{^\\^"a^\\^":1}^"'
    expect(tokenize(cmd)).toEqual(['curl', 'https://a.b/p', '-H', 'accept: */*', '--data-raw', '{"a":1}'])
  })
  it('handles PowerShell backtick continuations and doubled quotes', () => {
    expect(tokenize("curl.exe 'https://a.b' `\n -H 'it''s: ok'")).toEqual(['curl.exe', 'https://a.b', '-H', "it's: ok"])
  })
})

describe('parseCurl', () => {
  it('rejects non-curl text', () => {
    expect(looksLikeCurl('https://example.com')).toBe(false)
    expect(parseCurl('hello world')).toBeNull()
    expect(parseCurl('curl -s')).toBeNull()
  })

  it('parses a simple GET with headers and query', () => {
    const r = must("curl 'https://api.test/users?page=2' -H 'Accept: application/json' -H 'X-Id: 5'")
    expect(r.method).toBe('GET')
    expect(r.url).toBe('https://api.test/users?page=2')
    expect(kv(r)).toEqual({ Accept: 'application/json', 'X-Id': '5' })
    expect(r.bodyType).toBe('none')
    expect(r.name).toBe('GET /users')
  })

  it('infers POST and a JSON body from the Content-Type', () => {
    const r = must(`curl https://api.test/x -H 'Content-Type: application/json' -d '{"a":1}'`)
    expect(r.method).toBe('POST')
    expect(r.bodyType).toBe('raw-json')
    expect(r.bodyContent).toBe('{"a":1}')
    expect(kv(r)['Content-Type']).toBeUndefined()
  })

  it('keeps a Content-Type that differs from the implied one', () => {
    const r = must(`curl https://api.test/x -H 'Content-Type: application/vnd.api+json' --data-raw '{"a":1}'`)
    expect(r.bodyType).toBe('raw-json')
    expect(kv(r)['Content-Type']).toBe('application/vnd.api+json')
  })

  it('treats -d without a Content-Type as urlencoded pairs', () => {
    const r = must("curl https://api.test/x -d 'a=1&b=hello%20world' -d 'c=3'")
    expect(r.bodyType).toBe('x-www-form-urlencoded')
    expect(JSON.parse(r.bodyContent).map((p: { key: string; value: string }) => [p.key, p.value])).toEqual([['a', '1'], ['b', 'hello world'], ['c', '3']])
  })

  it('parses --data-urlencode pairs without encoding the stored value', () => {
    const r = must("curl https://api.test/x --data-urlencode 'q=a b&c'")
    expect(r.bodyType).toBe('x-www-form-urlencoded')
    expect(JSON.parse(r.bodyContent)[0]).toMatchObject({ key: 'q', value: 'a b&c' })
  })

  it('parses multipart -F fields including files', () => {
    const r = must("curl https://api.test/up -F 'name=Ann' -F 'doc=@/tmp/a.pdf;type=application/pdf'")
    expect(r.method).toBe('POST')
    expect(r.bodyType).toBe('form-data')
    const rows = JSON.parse(r.bodyContent)
    expect(rows[0]).toMatchObject({ key: 'name', value: 'Ann' })
    expect(rows[1]).toMatchObject({ key: 'doc', value: '/tmp/a.pdf', fieldType: 'file' })
  })

  it('parses --data-binary @file as a binary body', () => {
    const r = must("curl -X PUT https://api.test/x --data-binary @/tmp/blob.bin")
    expect(r.method).toBe('PUT')
    expect(r.bodyType).toBe('binary')
    expect(r.bodyContent).toBe('/tmp/blob.bin')
  })

  it('moves -G data into the query string', () => {
    const r = must("curl -G https://api.test/s --data-urlencode 'q=a b' -d 'x=1'")
    expect(r.method).toBe('GET')
    expect(r.url).toBe('https://api.test/s?q=a%20b&x=1')
    expect(r.bodyType).toBe('none')
  })

  it('maps -u to basic auth and -k to disabled SSL verification', () => {
    const r = must("curl -k -u 'ann:p:w' https://api.test")
    expect(r.authType).toBe('basic')
    expect(r.authConfig).toEqual({ username: 'ann', password: 'p:w' })
    expect(r.sslVerification).toBe('disabled')
  })

  it('turns Authorization headers into structured auth', () => {
    const b = must("curl https://api.test -H 'Authorization: Bearer abc.def'")
    expect(b.authType).toBe('bearer')
    expect(b.authConfig).toEqual({ token: 'abc.def' })
    expect(b.headers).toHaveLength(0)
    const basic = must(`curl https://api.test -H 'Authorization: Basic ${btoa('u:p')}'`)
    expect(basic.authConfig).toEqual({ username: 'u', password: 'p' })
  })

  it('handles clustered short flags and -XPOST forms', () => {
    const r = must("curl -sSLXPOST https://api.test -H'A: b'")
    expect(r.method).toBe('POST')
    expect(kv(r)).toEqual({ A: 'b' })
    expect(r.warnings.some((w) => w.includes('-L'))).toBe(true)
  })

  it('uses -I for HEAD', () => {
    expect(must('curl -I https://api.test').method).toBe('HEAD')
  })

  it('warns about unsupported options instead of dropping them silently', () => {
    const r = must('curl https://api.test --max-time 5 --cert c.pem --weird-flag -o out.txt')
    expect(r.warnings.join('\n')).toMatch(/--max-time 5/)
    expect(r.warnings.join('\n')).toMatch(/--cert c\.pem/)
    expect(r.warnings.join('\n')).toMatch(/--weird-flag/)
    expect(r.warnings.join('\n')).toMatch(/-o out\.txt/)
  })

  it('warns about unsupported methods and extra URLs', () => {
    const r = must('curl -X PURGE https://a.test https://b.test')
    expect(r.method).toBe('GET')
    expect(r.warnings.join('\n')).toMatch(/PURGE/)
    expect(r.warnings.join('\n')).toMatch(/first URL/)
  })

  it('supports --json and --opt=value forms', () => {
    const r = must(`curl --url=https://api.test --json '{"a":1}'`)
    expect(r.method).toBe('POST')
    expect(r.bodyType).toBe('raw-json')
    expect(kv(r).Accept).toBe('application/json')
  })

  it('parses a Chrome cmd-style command end to end', () => {
    const r = must('curl "https://api.test/p?x=1" ^\n  -H ^"content-type: application/json^" ^\n  --data-raw ^"{^\\^"a^\\^":1}^"')
    expect(r.method).toBe('POST')
    expect(r.bodyContent).toBe('{"a":1}')
  })

  it('leaves {{VAR}} placeholders intact', () => {
    const r = must("curl '{{base}}/x' -H 'X-Key: {{key}}'")
    expect(r.url).toBe('{{base}}/x')
    expect(kv(r)['X-Key']).toBe('{{key}}')
  })
})

const base: Pick<Request, 'protocol' | 'method' | 'url' | 'params' | 'headers' | 'bodyType' | 'bodyContent' | 'authType' | 'authConfig' | 'sslVerification' | 'protocolConfig'> = {
  protocol: 'http', method: 'GET', url: 'https://api.test/x', params: [], headers: [], bodyType: 'none', bodyContent: '',
  authType: 'none', authConfig: {}, sslVerification: 'inherit', protocolConfig: {},
}
const h = (key: string, value: string) => ({ id: key, key, value, enabled: true })

describe('buildCurl', () => {
  it('returns null for non-HTTP protocols', () => {
    expect(buildCurl({ ...base, protocol: 'websocket' }, { includeSecrets: false })).toBeNull()
  })

  it('writes method, headers, params and JSON body', () => {
    const out = buildCurl({
      ...base, method: 'POST', params: [{ id: 'p', key: 'a b', value: 'c&d', enabled: true }, { id: 'q', key: 'off', value: '1', enabled: false }],
      headers: [h('X-Id', '1')], bodyType: 'raw-json', bodyContent: '{"it\'s":1}',
    }, { includeSecrets: false })!
    expect(out.command).toContain("-X POST 'https://api.test/x?a%20b=c%26d'")
    expect(out.command).toContain("-H 'X-Id: 1'")
    expect(out.command).toContain("-H 'Content-Type: application/json'")
    expect(out.command).toContain(`--data-raw '{"it'\\''s":1}'`)
    expect(out.command).not.toContain('off=')
  })

  it('masks credentials unless secrets are included', () => {
    const req = { ...base, headers: [h('Authorization', 'Bearer s3cret'), h('X-Api-Key', 'k')], authType: 'basic' as const, authConfig: { username: 'ann', password: 'pw' } }
    const masked = buildCurl(req, { includeSecrets: false })!
    expect(masked.command).not.toMatch(/s3cret|pw|X-Api-Key: k/)
    expect(masked.command).toContain("-u 'ann:<password>'")
    expect(masked.notes.join(' ')).toMatch(/placeholders/)
    const full = buildCurl(req, { includeSecrets: true })!
    expect(full.command).toContain('Bearer s3cret')
    expect(full.command).toContain("-u 'ann:pw'")
    expect(full.notes).toHaveLength(0)
  })

  it('exports bearer auth as an Authorization header', () => {
    const r = buildCurl({ ...base, authType: 'bearer', authConfig: { token: 'tok' } }, { includeSecrets: true })!
    expect(r.command).toContain("-H 'Authorization: Bearer tok'")
    expect(buildCurl({ ...base, authType: 'bearer', authConfig: { token: 'tok' } }, { includeSecrets: false })!.command).toContain('<token>')
  })

  it('resolves variables or keeps placeholders', () => {
    const req = { ...base, url: '{{base}}/x', headers: [h('X-Env', '{{env}}')], params: [{ id: 'p', key: 'k', value: '{{v}}', enabled: true }] }
    const kept = buildCurl(req, { includeSecrets: false })!
    expect(kept.command).toContain("'{{base}}/x?k={{v}}'")
    const resolved = buildCurl(req, { includeSecrets: false, variables: { base: 'https://h.test', env: 'prod' } })!
    expect(resolved.command).toContain("'https://h.test/x?k={{v}}'")
    expect(resolved.command).toContain('X-Env: prod')
    expect(resolved.notes.join(' ')).toMatch(/\{\{v\}\}/)
  })

  it('exports form bodies, files and binary bodies as placeholders', () => {
    const rows = JSON.stringify([{ id: '1', key: 'a', value: 'b', enabled: true }, { id: '2', key: 'f', value: '/tmp/x.txt', enabled: true, fieldType: 'file' }])
    const form = buildCurl({ ...base, method: 'POST', bodyType: 'form-data', bodyContent: rows }, { includeSecrets: false })!
    expect(form.command).toContain("-F 'a=b'")
    expect(form.command).toContain("-F 'f=@/tmp/x.txt'")
    const bin = buildCurl({ ...base, method: 'POST', bodyType: 'binary', bodyContent: '/tmp/b.bin' }, { includeSecrets: false })!
    expect(bin.command).toContain("--data-binary '@/tmp/b.bin'")
  })

  it('notes inherited auth, and handles HEAD, -k and GraphQL', () => {
    expect(buildCurl({ ...base, authType: 'inherit' }, { includeSecrets: false })!.notes.join(' ')).toMatch(/inherited/)
    expect(buildCurl({ ...base, method: 'HEAD', sslVerification: 'disabled' }, { includeSecrets: false })!.command).toMatch(/curl -I 'https:\/\/api.test\/x' \\\n {2}-k/)
    const gql = buildCurl({ ...base, protocol: 'graphql', bodyContent: '{ me { id } }', protocolConfig: { variables: '{"a":1}' } }, { includeSecrets: false })!
    expect(gql.command).toContain('-X POST')
    expect(gql.command).toContain(`--data-raw '{"query":"{ me { id } }","variables":{"a":1}}'`)
  })
})

describe('buildCurl redaction and GET bodies', () => {
  it('masks credentials in the URL, params, JSON and form bodies unless secrets are included', () => {
    const req = {
      ...base, method: 'POST' as const,
      url: 'https://bob:hunter2@api.test/x?api_key=AAA&page=2&token={{tok}}',
      params: [{ id: 'p', key: 'access_token', value: 'BBB', enabled: true }, { id: 'q', key: 'q', value: 'ok', enabled: true }],
      bodyType: 'raw-json' as const, bodyContent: '{"user":"ann","password":"CCC","nested":{"client_secret":"DDD"}}',
    }
    const out = buildCurl(req, { includeSecrets: false })!
    for (const leaked of ['hunter2', 'AAA', 'BBB', 'CCC', 'DDD']) expect(out.command).not.toContain(leaked)
    expect(out.command).toContain('page=2')
    expect(out.command).toContain('q=ok')
    expect(out.command).toContain('token={{tok}}')
    expect(out.command).toContain('"user":"ann"')
    expect(out.notes.join(' ')).toMatch(/placeholders/)
    const full = buildCurl(req, { includeSecrets: true })!
    for (const kept of ['hunter2', 'AAA', 'BBB', 'CCC', 'DDD']) expect(full.command).toContain(kept)
  })

  it('masks credential fields in form and urlencoded bodies but keeps file paths', () => {
    const rows = JSON.stringify([
      { id: '1', key: 'password', value: 'sekret', enabled: true },
      { id: '2', key: 'name', value: 'ann', enabled: true },
      { id: '3', key: 'auth_file', value: '/tmp/a', enabled: true, fieldType: 'file' },
    ])
    for (const bodyType of ['form-data', 'x-www-form-urlencoded'] as const) {
      const out = buildCurl({ ...base, method: 'POST', bodyType, bodyContent: rows }, { includeSecrets: false })!
      expect(out.command).not.toContain('sekret')
      expect(out.command).toContain('name=ann')
    }
    const raw = buildCurl({ ...base, method: 'POST', bodyType: 'raw-text', bodyContent: 'grant_type=password&client_secret=zzz' }, { includeSecrets: false })!
    expect(raw.command).not.toContain('zzz')
    expect(raw.command).toContain('grant_type=password')
  })

  it('keeps -X GET when a GET has a body, and drops bodies from HEAD', () => {
    const get = buildCurl({ ...base, method: 'GET', bodyType: 'raw-json', bodyContent: '{"q":1}' }, { includeSecrets: false })!
    expect(get.command).toContain('-X GET')
    expect(must(get.command).method).toBe('GET')
    const head = buildCurl({ ...base, method: 'HEAD', bodyType: 'raw-json', bodyContent: '{"q":1}' }, { includeSecrets: false })!
    expect(head.command).not.toContain('--data-raw')
    expect(head.notes.join(' ')).toMatch(/HEAD/)
  })
})

describe('round trip', () => {
  it('export then import yields an equivalent request', () => {
    const rows = JSON.stringify([{ id: '1', key: 'a', value: 'b c', enabled: true }])
    const cases: Array<typeof base> = [
      { ...base, method: 'POST', url: 'https://api.test/a?x=1', headers: [h('X-Id', '1')], bodyType: 'raw-json', bodyContent: '{"a":[1,2]}' },
      { ...base, method: 'PUT', bodyType: 'raw-xml', bodyContent: "<a>it's</a>" },
      { ...base, method: 'POST', bodyType: 'x-www-form-urlencoded', bodyContent: rows },
      { ...base, method: 'POST', bodyType: 'form-data', bodyContent: JSON.stringify([{ id: '1', key: 'f', value: '/tmp/a.txt', enabled: true, fieldType: 'file' }]) },
      { ...base, method: 'DELETE', authType: 'basic', authConfig: { username: 'u', password: 'p' }, sslVerification: 'disabled' },
      { ...base, method: 'GET', authType: 'bearer', authConfig: { token: 't' } },
    ]
    for (const original of cases) {
      const cmd = buildCurl(original, { includeSecrets: true })!.command
      const parsed = must(cmd)
      expect(parsed.method).toBe(original.method)
      expect(parsed.url).toBe(original.url)
      expect(parsed.bodyType).toBe(original.bodyType)
      expect(parsed.authType).toBe(original.authType)
      expect(parsed.authConfig).toEqual(original.authConfig)
      expect(parsed.sslVerification).toBe(original.sslVerification)
      expect(Object.fromEntries(parsed.headers.map((x) => [x.key, x.value]))).toEqual(Object.fromEntries(original.headers.map((x) => [x.key, x.value])))
      if (original.bodyType === 'x-www-form-urlencoded' || original.bodyType === 'form-data') {
        const strip = (s: string) => JSON.parse(s).map((p: { key: string; value: string; fieldType?: string }) => [p.key, p.value, p.fieldType ?? 'text'])
        expect(strip(parsed.bodyContent)).toEqual(strip(original.bodyContent))
      } else {
        expect(parsed.bodyContent).toBe(original.bodyContent)
      }
    }
  })
})
