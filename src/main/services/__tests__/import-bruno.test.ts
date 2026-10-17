import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { EXTRACT_RULES_KEY, parseRules } from '../../../shared/extract'
import { parseBru } from '../bru-lang'
import { previewFolder, previewImport } from '../import-formats'
import { convertBrunoExport, convertBrunoFiles } from '../import-bruno'

const FIX = path.join(__dirname, 'fixtures', 'bruno')
const rows = (v: string) => JSON.parse(v) as Array<{ key: string; value: string; enabled: boolean; fieldType?: string }>

function folder(name: string): Array<{ path: string; text: string }> {
  const walk = (dir: string): Array<{ path: string; text: string }> =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name)
      return e.isDirectory() ? walk(p) : [{ path: `${name}/${path.relative(path.join(FIX, name), p).split(path.sep).join('/')}`, text: fs.readFileSync(p, 'utf-8') }]
    })
  return walk(path.join(FIX, name))
}

function requestText(extra = ''): string {
  return `meta {
  name: Sample
  type: http
}

get {
  url: https://example.com/items
}

${extra}`
}

function bruRequest(options: { method?: string; url?: string; settings?: readonly string[]; blocks?: string; name?: string } = {}): string {
  const method = options.method ?? 'get'
  const lines = [`  url: ${options.url ?? 'https://example.com/items'}`, ...(options.settings ?? []).map((line) => `  ${line}`)].join('\n')
  return `meta {
  name: ${options.name ?? 'Sample'}
  type: http
}

${method} {
${lines}
}
${options.blocks ? `\n\n${options.blocks}` : ''}\n`
}

function bruEntry(options: { method?: string; url?: string; settings?: readonly string[]; blocks?: string; name?: string } = {}) {
  const [entry] = convertBrunoFiles([{ path: 'picked/request.bru', text: bruRequest(options) }])
  return entry
}

function exportEntry(request: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return convertBrunoExport({
    name: 'Exported',
    version: '1',
    items: [{ type: 'http', name: 'Request', seq: 0, request, ...extra }],
    environments: [],
    brunoConfig: {},
  })
}

describe('parseBru', () => {
  it('reads the real bruno-lang request fixture', () => {
    const doc = parseBru(fs.readFileSync(path.join(FIX, 'real-request.bru'), 'utf-8'))
    expect(doc.dicts.get('meta')?.length).toBeGreaterThan(0)
    expect(doc.dicts.has('headers')).toBe(true)
  })

  it('keeps disabled rows and multi-line values', () => {
    const doc = parseBru("headers {\n  ~off: 1\n  on: 2\n}\n\nbody:json {\n  {\n    \"a\": 1\n  }\n}\n")
    expect(doc.dicts.get('headers')).toMatchObject([{ name: 'off', enabled: false }, { name: 'on', enabled: true }])
    expect(JSON.parse(doc.texts.get('body:json') ?? '')).toEqual({ a: 1 })
  })

  it('parses annotations without failing', () => {
    expect(() => parseBru(fs.readFileSync(path.join(FIX, 'real-annotations.bru'), 'utf-8'))).not.toThrow()
  })

  it('parses legacy query blocks and meta tags lists', () => {
    const doc = parseBru(`meta {
  name: Tagged
  tags: [
    smoke
    regression
  ]
}

query {
  page: 1
}
`)
    expect(doc.dicts.get('query')).toMatchObject([{ name: 'page', value: '1', enabled: true }])
    expect(doc.dicts.get('meta')).toMatchObject([{ name: 'name', value: 'Tagged' }, { name: 'tags', value: 'smoke\nregression' }])
  })

  it('tolerates malformed blocks and keeps what it can parse', () => {
    const doc = parseBru(`meta {
  name: Broken
}

headers {
  Accept: application/json
  Broken line
}

body:json {
  {
    "ok": true
  }
`)
    expect(doc.dicts.get('meta')).toMatchObject([{ name: 'name', value: 'Broken', enabled: true }])
    expect(doc.dicts.get('headers')).toMatchObject([{ name: 'Accept', value: 'application/json', enabled: true }])
    expect(JSON.parse(doc.texts.get('body:json') ?? '')).toEqual({ ok: true })
  })
})

describe('Bruno folder import', () => {
  it('imports a real collection with folders, requests, auth and variables', () => {
    const [entry] = convertBrunoFiles(folder('real-collection').map((f) => ({ ...f, path: f.path.replace('real-collection/', 'c/') })))
    expect(entry.collection.requests.length).toBeGreaterThan(0)
    expect(entry.collection.folders.length).toBeGreaterThan(0)
    expect(entry.collection.auth.type).toBe('basic')
    expect(entry.warnings.join('\n')).toMatch(/Scripts were not imported/)
  })

  it('maps graphql, multipart, binary and digest requests and warns about environments', () => {
    const preview = previewFolder(folder('real-testbench'))
    expect(preview.format).toBe('bruno')
    const reqs = convertBrunoFiles(folder('real-testbench'))[0].collection.requests
    const byName = (n: string) => reqs.find((r) => r.name === n)
    expect(byName('mutation')?.bodyType).toBe('graphql')
    expect(byName('multipart-mixed-form-data-file')?.bodyType).toBe('form-data')
    expect(preview.warnings.join('\n')).toMatch(/environments were not imported/)
  })

  it('maps legacy query blocks, warns about unknown blocks, and reports tags once', () => {
    const [entry] = convertBrunoFiles([{ path: 'picked/request.bru', text: `meta {
  name: Legacy Query
  tags: [
    smoke
  ]
}

get {
  url: https://example.com/items
}

query {
  page: 1
}

frobnicate {
  mode: on
}
` }])
    expect(entry.collection.name).toBe('picked')
    expect((entry.collection.requests[0].params as Array<{ key: string; value: string }>).map((p) => [p.key, p.value])).toEqual([['page', '1']])
    expect(entry.warnings.join('\n')).toMatch(/Unsupported Bruno blocks were ignored: frobnicate\./)
    expect(entry.warnings.join('\n')).toMatch(/Tags on the collection, folders, or requests were not imported\./)
    expect(entry.warnings.join('\n')).not.toMatch(/query/)
  })

  it('detects the root without bruno.json regardless of order and normalizes windows paths', () => {
    const files = [
      { path: 'picked\\sub\\deeper\\a.bru', text: requestText() },
      { path: 'picked\\sub\\b.bru', text: requestText() },
    ]
    const [entry] = convertBrunoFiles(files.reverse())
    expect(entry.collection.name).toBe('sub')
    expect(entry.collection.requests.map((r) => r.name)).toEqual(['Sample'])
    expect(entry.collection.folders[0].requests.map((r) => r.name)).toEqual(['Sample'])
  })

  it('treats a top-level .bru file as the root when there is no bruno.json', () => {
    const [entry] = convertBrunoFiles([
      { path: 'picked/sub/nested.bru', text: requestText() },
      { path: 'picked/root.bru', text: requestText('meta {\n  name: Root\n  type: http\n}\n\nget {\n  url: https://example.com/root\n}\n') },
    ])
    expect(entry.collection.name).toBe('picked')
    expect(entry.collection.requests.map((r) => r.url)).toContain('https://example.com/root')
  })

  it('falls back to the folder name when collection metadata is malformed', () => {
    const [entry] = convertBrunoFiles([
      { path: 'picked/collection.bru', text: 'meta {\n  name Broken\n\nheaders {\n  X-Test: 1\n' },
      { path: 'picked/request.bru', text: bruRequest() },
    ])
    expect(entry.collection.name).toBe('picked')
    expect(entry.collection.requests[0]).toMatchObject({ name: 'Sample', url: 'https://example.com/items' })
  })

  it('maps supported request settings to network overrides and warns about unsupported ones', () => {
    const [entry] = convertBrunoFiles([{ path: 'picked/request.bru', text: `meta {
  name: Settings
  type: http
}

get {
  url: https://example.com/items
}

settings {
  followRedirects: false
  maxRedirects: 2
  timeout: 1500
  encodeUrl: true
}
` }])
    expect(entry.collection.requests[0].network).toEqual({ followRedirects: false, maxRedirects: 2, timeout: 1500 })
    expect(entry.warnings.join('\n')).toMatch(/Bruno request settings were not imported: encodeUrl\./)
  })

  it('splits multipart files, strips content types, and warns once about dropped part content types', () => {
    const [entry] = convertBrunoFiles([{ path: 'picked/request.bru', text: `meta {
  name: Upload
  type: http
}

post {
  url: https://example.com/upload
  body: multipartForm
}

body:multipart-form {
  caption: hello @contentType(text/plain)
  file: @file(one.txt|two.txt) @contentType(image/png)
}
` }])
    expect(rows(entry.collection.requests[0].bodyContent).map((r) => [r.key, r.value, r.fieldType ?? 'text'])).toEqual([
      ['caption', 'hello', 'text'],
      ['file', 'one.txt', 'file'],
      ['file', 'two.txt', 'file'],
    ])
    expect(entry.warnings.join('\n')).toMatch(/Multipart part content types were not imported/)
  })

  it('maps every request auth mode from .bru files', () => {
    const cases: Array<{
      name: string
      settings: readonly string[]
      blocks: string
      expected: { type: string; config: Record<string, string> }
      warning?: RegExp
    }> = [
      {
        name: 'inherit',
        settings: ['auth: inherit'],
        blocks: '',
        expected: { type: 'inherit', config: {} },
      },
      {
        name: 'none',
        settings: ['auth: none'],
        blocks: '',
        expected: { type: 'none', config: {} },
      },
      {
        name: 'basic',
        settings: ['auth: basic'],
        blocks: 'auth:basic {\n  username: alice\n  password: secret\n}',
        expected: { type: 'basic', config: { username: 'alice', password: 'secret' } },
      },
      {
        name: 'bearer',
        settings: ['auth: bearer'],
        blocks: 'auth:bearer {\n  token: token-123\n}',
        expected: { type: 'bearer', config: { token: 'token-123' } },
      },
      {
        name: 'digest',
        settings: ['auth: digest'],
        blocks: 'auth:digest {\n  username: digest-user\n  password: digest-pass\n}',
        expected: { type: 'digest', config: { username: 'digest-user', password: 'digest-pass' } },
      },
      {
        name: 'ntlm',
        settings: ['auth: ntlm'],
        blocks: 'auth:ntlm {\n  username: ntlm-user\n  password: ntlm-pass\n  domain: acme\n  workstation: ws-1\n}',
        expected: { type: 'ntlm', config: { username: 'ntlm-user', password: 'ntlm-pass', domain: 'acme', workstation: 'ws-1' } },
      },
      {
        name: 'apikey',
        settings: ['auth: apikey'],
        blocks: 'auth:apikey {\n  key: X-Token\n  value: abc\n  placement: queryparams\n}',
        expected: { type: 'apikey', config: { key: 'X-Token', value: 'abc', in: 'query' } },
      },
      {
        name: 'awsv4',
        settings: ['auth: awsv4'],
        blocks: 'auth:awsv4 {\n  accessKeyId: AKIA\n  secretAccessKey: SECRET\n  sessionToken: SESSION\n  region: eu-west-1\n  service: execute-api\n}',
        expected: { type: 'awsv4', config: { accessKey: 'AKIA', secretKey: 'SECRET', sessionToken: 'SESSION', region: 'eu-west-1', service: 'execute-api' } },
      },
      {
        name: 'oauth2',
        settings: ['auth: oauth2'],
        blocks: 'auth:oauth2 {\n  grant_type: client_credentials\n  authorization_url: https://auth.example.com/authorize\n  access_token_url: https://auth.example.com/token\n  client_id: id\n  client_secret: secret\n  scope: read write\n  callback_url: https://app.example.com/callback\n}',
        expected: {
          type: 'oauth2',
          config: {
            grantType: 'client_credentials',
            clientId: 'id',
            clientSecret: 'secret',
            authUrl: 'https://auth.example.com/authorize',
            tokenUrl: 'https://auth.example.com/token',
            scopes: 'read write',
            redirectUri: 'https://app.example.com/callback',
          },
        },
      },
      {
        name: 'unsupported wsse',
        settings: ['auth: wsse'],
        blocks: 'auth:wsse {\n  username: ignored\n}',
        expected: { type: 'none', config: {} },
        warning: /"wsse" authentication is not supported/,
      },
    ]

    for (const testCase of cases) {
      const entry = bruEntry({ settings: testCase.settings, blocks: testCase.blocks })
      expect(entry.collection.requests[0].auth).toEqual(testCase.expected)
      if (testCase.warning) expect(entry.warnings.join('\n')).toMatch(testCase.warning)
    }
  })

  it('maps every request body mode from .bru files', () => {
    const cases: Array<{
      name: string
      settings: readonly string[]
      blocks: string
      assert: (entry: ReturnType<typeof bruEntry>) => void
    }> = [
      {
        name: 'none',
        settings: ['body: none'],
        blocks: '',
        assert: (entry: ReturnType<typeof bruEntry>) => expect(entry.collection.requests[0]).toMatchObject({ bodyType: 'none', bodyContent: '' }),
      },
      {
        name: 'json',
        settings: ['body: json'],
        blocks: 'body:json {\n  {\n    "hello": true\n  }\n}',
        assert: (entry: ReturnType<typeof bruEntry>) => {
          expect(entry.collection.requests[0].bodyType).toBe('raw-json')
          expect(JSON.parse(entry.collection.requests[0].bodyContent)).toEqual({ hello: true })
        },
      },
      {
        name: 'text',
        settings: ['body: text'],
        blocks: 'body:text {\n  plain text\n}',
        assert: (entry: ReturnType<typeof bruEntry>) => expect(entry.collection.requests[0]).toMatchObject({ bodyType: 'raw-text', bodyContent: 'plain text' }),
      },
      {
        name: 'xml',
        settings: ['body: xml'],
        blocks: 'body:xml {\n  <root/>\n}',
        assert: (entry: ReturnType<typeof bruEntry>) => expect(entry.collection.requests[0]).toMatchObject({ bodyType: 'raw-xml', bodyContent: '<root/>' }),
      },
      {
        name: 'sparql',
        settings: ['body: sparql'],
        blocks: 'body:sparql {\n  SELECT * WHERE {?s ?p ?o}\n}',
        assert: (entry: ReturnType<typeof bruEntry>) => expect(entry.collection.requests[0]).toMatchObject({ bodyType: 'raw-text', bodyContent: 'SELECT * WHERE {?s ?p ?o}' }),
      },
      {
        name: 'graphql',
        settings: ['body: graphql'],
        blocks: 'body:graphql {\n  query GetUser { user { id } }\n}\n\nbody:graphql:vars {\n  {"id":1}\n}',
        assert: (entry: ReturnType<typeof bruEntry>) => {
          expect(entry.collection.requests[0].bodyType).toBe('graphql')
          expect(JSON.parse(entry.collection.requests[0].bodyContent)).toEqual({ query: 'query GetUser { user { id } }', variables: '{"id":1}' })
        },
      },
      {
        name: 'formUrlEncoded',
        settings: ['body: formUrlEncoded'],
        blocks: 'body:form-urlencoded {\n  a: 1\n  ~b: 2\n}',
        assert: (entry: ReturnType<typeof bruEntry>) => {
          expect(entry.collection.requests[0].bodyType).toBe('x-www-form-urlencoded')
          expect(rows(entry.collection.requests[0].bodyContent).map((row) => [row.key, row.value, row.enabled])).toEqual([
            ['a', '1', true],
            ['b', '2', false],
          ])
        },
      },
      {
        name: 'multipartForm',
        settings: ['body: multipartForm'],
        blocks: 'body:multipart-form {\n  note: hi\n  file: @file(one.txt|two.txt)\n}',
        assert: (entry: ReturnType<typeof bruEntry>) => {
          expect(entry.collection.requests[0].bodyType).toBe('form-data')
          expect(rows(entry.collection.requests[0].bodyContent).map((row) => [row.key, row.value, row.fieldType ?? 'text'])).toEqual([
            ['note', 'hi', 'text'],
            ['file', 'one.txt', 'file'],
            ['file', 'two.txt', 'file'],
          ])
        },
      },
      {
        name: 'file',
        settings: ['body: file'],
        blocks: 'body:file {\n  path: ignored.bin\n}',
        assert: (entry: ReturnType<typeof bruEntry>) => {
          expect(entry.collection.requests[0]).toMatchObject({ bodyType: 'binary', bodyContent: '' })
          expect(entry.warnings.join('\n')).toMatch(/binary body was not imported/)
        },
      },
      {
        name: 'unsupported',
        settings: ['body: snailMail'],
        blocks: '',
        assert: (entry: ReturnType<typeof bruEntry>) => {
          expect(entry.collection.requests[0]).toMatchObject({ bodyType: 'none', bodyContent: '' })
          expect(entry.warnings.join('\n')).toMatch(/body type "snailMail" is not supported/)
        },
      },
    ]

    for (const testCase of cases) testCase.assert(bruEntry({ method: 'post', settings: testCase.settings, blocks: testCase.blocks }))
  })

  it('converts post-response vars, notes dropped oauth settings, and warns about extra Bruno config', () => {
    const [entry] = convertBrunoFiles([
      {
        path: 'picked/bruno.json',
        text: JSON.stringify({
          name: 'Picked',
          proxy: { enabled: true },
          clientCertificates: { certs: [{ host: 'api.example.com' }] },
        }),
      },
      {
        path: 'picked/request.bru',
        text: bruRequest({
          settings: ['auth: oauth2'],
          blocks: `auth:oauth2 {
  grant_type: password
  authorization_url: https://auth.example.com/authorize
  access_token_url: https://auth.example.com/token
  refresh_token_url: https://auth.example.com/refresh
  client_id: id
  client_secret: secret
  scope: read
  callback_url: https://app.example.com/callback
  username: demo
  password: pass
  state: xyz
  pkce: true
}

auth:oauth2:additional_params:access_token_req:body {
  audience: api
}

vars:post-response {
  token: res.body.token
  statusCode: res.status
  etag: res.headers.etag
  skipped: res.body[*]
}`,
        }),
      },
    ])
    const rules = parseRules(String(entry.collection.requests[0].protocolConfig[EXTRACT_RULES_KEY]))
    expect(rules.map((rule) => [rule.variable, rule.source, rule.expression])).toEqual([
      ['token', 'json', '$.token'],
      ['statusCode', 'status', ''],
      ['etag', 'header', 'etag'],
    ])
    expect(entry.warnings.join('\n')).toMatch(/post-response variable could not be converted \(skipped\)/)
    expect(entry.warnings.join('\n')).toMatch(/OAuth 2\.0 settings were not imported: .*refresh token URL.*state.*PKCE.*additional auth\/token\/refresh parameters.*password grant username \/ password/)
    expect(entry.warnings.join('\n')).toMatch(/proxy and client certificate settings were not imported/)
  })

  it('rejects a folder with no Bruno files', () => {
    expect(() => previewFolder([{ path: 'x/readme.md', text: '' }])).toThrow(/No Bruno/)
  })

  it('returns no collections when the selected folder has no Bruno files after ignored directories are removed', () => {
    expect(convertBrunoFiles([
      { path: '.git/request.bru', text: requestText() },
      { path: 'node_modules/ignored/request.bru', text: requestText() },
    ])).toEqual([])
  })

  it('reads the YAML (OpenCollection) format', () => {
    const preview = previewFolder([
      { path: 'c/opencollection.yml', text: ['opencollection: 1.0.0', 'info:', '  name: Y', ''].join('\n') },
      { path: 'c/ping.yml', text: ['info:', '  name: Ping', '  type: http', 'http:', '  method: GET', '  url: https://x.test', ''].join('\n') },
    ])
    expect(preview.format).toBe('bruno')
  })

  it('applies the import budget to folder trees', () => {
    const deep = Array.from({ length: 66 }, (_, i) => `f${i}`).join('/')
    expect(() => convertBrunoFiles([
      { path: 'picked/root.bru', text: requestText() },
      { path: `picked/${deep}/request.bru`, text: requestText() },
    ])).toThrow(/nested deeper than 64 levels/)
  })
})

describe('Bruno JSON export', () => {
  it('is detected and converted', async () => {
    const preview = await previewImport(fs.readFileSync(path.join(FIX, 'real-export.json'), 'utf-8'))
    expect(preview.format).toBe('bruno')
    expect(preview.collections[0].collection.name).toBe('test_collection')
    expect(preview.collections[0].requests).toBe(1)
  })

  it('maps multipart file arrays, OAuth 2.0 fields, settings, and tags from JSON exports', () => {
    const entry = convertBrunoExport(JSON.parse(fs.readFileSync(path.join(FIX, 'edge-export.json'), 'utf-8')) as Record<string, unknown>)
    const request = entry.collection.requests[0]
    expect(request.network).toEqual({ followRedirects: false, maxRedirects: 7, timeout: 1200 })
    expect(rows(request.bodyContent).map((r) => [r.key, r.value, r.fieldType ?? 'text'])).toEqual([
      ['file', 'a.txt', 'file'],
      ['file', 'b.txt', 'file'],
      ['caption', 'hello', 'text'],
    ])
    expect(request.auth).toEqual({
      type: 'oauth2',
      config: {
        grantType: 'password',
        clientId: 'id',
        clientSecret: 'secret',
        authUrl: 'https://auth.example.com/authorize',
        tokenUrl: 'https://auth.example.com/token',
        scopes: 'read write',
        redirectUri: 'https://app.example.com/callback',
      },
    })
    expect(entry.warnings.join('\n')).toMatch(/OAuth 2\.0 settings were not imported: .*refresh token URL.*state.*PKCE.*password grant username \/ password/)
    expect(entry.warnings.join('\n')).toMatch(/Bruno request settings were not imported: encodeUrl\./)
    expect(entry.warnings.join('\n')).toMatch(/Tags on the collection, folders, or requests were not imported\./)
    expect(entry.warnings.join('\n')).toMatch(/Multipart part content types were not imported/)
  })

  it('maps every request auth mode from JSON exports', () => {
    const cases: Array<{
      auth: Record<string, unknown>
      expected: { type: string; config: Record<string, string> }
      warning?: RegExp
    }> = [
      {
        auth: { mode: 'inherit' },
        expected: { type: 'inherit', config: {} },
      },
      {
        auth: { mode: 'none' },
        expected: { type: 'none', config: {} },
      },
      {
        auth: { mode: 'basic', basic: { username: 'alice', password: 'secret' } },
        expected: { type: 'basic', config: { username: 'alice', password: 'secret' } },
      },
      {
        auth: { mode: 'bearer', bearer: { token: 'token-123' } },
        expected: { type: 'bearer', config: { token: 'token-123' } },
      },
      {
        auth: { mode: 'digest', digest: { username: 'digest-user', password: 'digest-pass' } },
        expected: { type: 'digest', config: { username: 'digest-user', password: 'digest-pass' } },
      },
      {
        auth: { mode: 'ntlm', ntlm: { username: 'ntlm-user', password: 'ntlm-pass', domain: 'acme', workstation: 'ws-1' } },
        expected: { type: 'ntlm', config: { username: 'ntlm-user', password: 'ntlm-pass', domain: 'acme', workstation: 'ws-1' } },
      },
      {
        auth: { mode: 'apikey', apikey: { key: 'X-Token', value: 'abc', placement: 'header' } },
        expected: { type: 'apikey', config: { key: 'X-Token', value: 'abc', in: 'header' } },
      },
      {
        auth: { mode: 'awsv4', awsv4: { accessKeyId: 'AKIA', secretAccessKey: 'SECRET', sessionToken: 'SESSION', region: 'eu-west-1', service: 'execute-api' } },
        expected: { type: 'awsv4', config: { accessKey: 'AKIA', secretKey: 'SECRET', sessionToken: 'SESSION', region: 'eu-west-1', service: 'execute-api' } },
      },
      {
        auth: {
          mode: 'oauth2',
          oauth2: {
            grantType: 'authorization_code',
            authorizationUrl: 'https://auth.example.com/authorize',
            accessTokenUrl: 'https://auth.example.com/token',
            clientId: 'id',
            clientSecret: 'secret',
            scope: 'read write',
            callbackUrl: 'https://app.example.com/callback',
          },
        },
        expected: {
          type: 'oauth2',
          config: {
            grantType: 'authorization_code',
            clientId: 'id',
            clientSecret: 'secret',
            authUrl: 'https://auth.example.com/authorize',
            tokenUrl: 'https://auth.example.com/token',
            scopes: 'read write',
            redirectUri: 'https://app.example.com/callback',
          },
        },
      },
      {
        auth: { mode: 'oauth1', oauth1: { consumerKey: 'ignored' } },
        expected: { type: 'none', config: {} },
        warning: /"oauth1" authentication is not supported/,
      },
    ]

    for (const testCase of cases) {
      const entry = exportEntry({ url: 'https://example.com/items', method: 'GET', auth: testCase.auth })
      expect(entry.collection.requests[0].auth).toEqual(testCase.expected)
      if (testCase.warning) expect(entry.warnings.join('\n')).toMatch(testCase.warning)
    }
  })

  it('maps every request body mode from JSON exports', () => {
    const cases = [
      {
        body: { mode: 'none' },
        assert: (entry: ReturnType<typeof exportEntry>) => expect(entry.collection.requests[0]).toMatchObject({ bodyType: 'none', bodyContent: '' }),
      },
      {
        body: { mode: 'json', json: '{"hello":true}' },
        assert: (entry: ReturnType<typeof exportEntry>) => {
          expect(entry.collection.requests[0].bodyType).toBe('raw-json')
          expect(JSON.parse(entry.collection.requests[0].bodyContent)).toEqual({ hello: true })
        },
      },
      {
        body: { mode: 'text', text: 'plain text' },
        assert: (entry: ReturnType<typeof exportEntry>) => expect(entry.collection.requests[0]).toMatchObject({ bodyType: 'raw-text', bodyContent: 'plain text' }),
      },
      {
        body: { mode: 'xml', xml: '<root/>' },
        assert: (entry: ReturnType<typeof exportEntry>) => expect(entry.collection.requests[0]).toMatchObject({ bodyType: 'raw-xml', bodyContent: '<root/>' }),
      },
      {
        body: { mode: 'sparql', sparql: 'SELECT * WHERE {?s ?p ?o}' },
        assert: (entry: ReturnType<typeof exportEntry>) => expect(entry.collection.requests[0]).toMatchObject({ bodyType: 'raw-text', bodyContent: 'SELECT * WHERE {?s ?p ?o}' }),
      },
      {
        body: { mode: 'graphql', graphql: { query: 'query GetUser { user { id } }', variables: '{"id":1}' } },
        assert: (entry: ReturnType<typeof exportEntry>) => {
          expect(entry.collection.requests[0].bodyType).toBe('graphql')
          expect(JSON.parse(entry.collection.requests[0].bodyContent)).toEqual({ query: 'query GetUser { user { id } }', variables: '{"id":1}' })
        },
      },
      {
        body: { mode: 'formUrlEncoded', formUrlEncoded: [{ name: 'a', value: '1', enabled: true }, { name: 'b', value: '2', enabled: false }] },
        assert: (entry: ReturnType<typeof exportEntry>) => {
          expect(entry.collection.requests[0].bodyType).toBe('x-www-form-urlencoded')
          expect(rows(entry.collection.requests[0].bodyContent).map((row) => [row.key, row.value, row.enabled])).toEqual([
            ['a', '1', true],
            ['b', '2', false],
          ])
        },
      },
      {
        body: { mode: 'multipartForm', multipartForm: [{ name: 'note', value: 'hi', enabled: true }, { name: 'file', type: 'file', value: ['one.txt', 'two.txt'], enabled: true }] },
        assert: (entry: ReturnType<typeof exportEntry>) => {
          expect(entry.collection.requests[0].bodyType).toBe('form-data')
          expect(rows(entry.collection.requests[0].bodyContent).map((row) => [row.key, row.value, row.fieldType ?? 'text'])).toEqual([
            ['note', 'hi', 'text'],
            ['file', 'one.txt', 'file'],
            ['file', 'two.txt', 'file'],
          ])
        },
      },
      {
        body: { mode: 'file', file: [{ path: 'ignored.bin' }] },
        assert: (entry: ReturnType<typeof exportEntry>) => {
          expect(entry.collection.requests[0]).toMatchObject({ bodyType: 'binary', bodyContent: '' })
          expect(entry.warnings.join('\n')).toMatch(/binary body was not imported/)
        },
      },
      {
        body: { mode: 'snailMail' },
        assert: (entry: ReturnType<typeof exportEntry>) => {
          expect(entry.collection.requests[0]).toMatchObject({ bodyType: 'none', bodyContent: '' })
          expect(entry.warnings.join('\n')).toMatch(/body type "snailMail" is not supported/)
        },
      },
    ] as const

    for (const testCase of cases) testCase.assert(exportEntry({ url: 'https://example.com/items', method: 'POST', body: testCase.body }))
  })

  it('applies the import budget to exported trees', () => {
    let cursor: Record<string, unknown> = {
      type: 'folder',
      name: 'f0',
      seq: 0,
      root: {},
      items: [],
    }
    const doc: Record<string, unknown> = { name: 'Budget', version: '1', items: [cursor], environments: [], brunoConfig: {} }
    for (let i = 1; i <= 65; i++) {
      const next: Record<string, unknown> = { type: 'folder', name: `f${i}`, seq: i, root: {}, items: [] }
      ;(cursor.items as Array<Record<string, unknown>>).push(next)
      cursor = next
    }
    expect(() => convertBrunoExport(doc)).toThrow(/nested deeper than 64 levels/)
  })

  it('keeps export-only warnings, unsupported items, and missing multipart files specific to JSON exports', () => {
    const entry = convertBrunoExport({
      name: 'Export edge cases',
      version: 1,
      root: {
        tags: ['root'],
        request: {
          headers: [{ name: 'X-Root', value: '1', enabled: true }],
          vars: { req: [{ name: 'rootVar', value: 'rv', enabled: true }] },
          script: { req: 'console.log(1)' },
          docs: 'Root docs',
        },
      },
      items: [{
        type: 'folder',
        name: 'API',
        seq: 1,
        root: {
          tags: ['folder'],
          request: {
            headers: [{ name: 'X-Folder', value: '1', enabled: true }],
            vars: { req: [{ name: 'folderVar', value: 'fv', enabled: true }] },
            script: { req: 'console.log(2)' },
            docs: 'Folder docs',
          },
        },
        items: [
          {
            type: 'graphql-request',
            name: 'Graph',
            seq: 1,
            request: {
              url: 'https://graphql.example.com',
              body: { mode: 'graphql', graphql: { query: 'query Ping { ping }', variables: '{"id":1}' } },
              auth: { mode: 'none' },
            },
          },
          {
            type: 'http',
            name: 'Upload',
            seq: 2,
            request: {
              method: 'POST',
              url: 'https://upload.example.com',
              body: {
                mode: 'multipartForm',
                multipartForm: [
                  { name: 'file', type: 'file', value: [], enabled: true },
                  { name: 'caption', value: 'hello', contentType: 'text/plain', enabled: true },
                ],
              },
              vars: {
                res: [{ name: 'trace', value: 'res.headers["x-trace"]', enabled: true }],
              },
            },
          },
          {
            type: 'grpc-request',
            name: 'Rpc',
            seq: 3,
            request: {},
          },
        ],
      }],
      environments: [{ name: 'Dev' }],
      brunoConfig: {},
    })

    const api = entry.collection.folders[0]
    expect(api.requests[0]).toMatchObject({ name: 'Graph', bodyType: 'graphql', auth: { type: 'none', config: {} } })
    expect(api.requests[1].bodyType).toBe('form-data')
    expect(rows(api.requests[1].bodyContent).map((row) => [row.key, row.value, row.fieldType ?? 'text'])).toEqual([
      ['caption', 'hello', 'text'],
    ])
    expect(parseRules(String(api.requests[1].protocolConfig[EXTRACT_RULES_KEY]))).toMatchObject([
      { source: 'header', expression: 'x-trace', variable: 'trace' },
    ])
    expect(entry.warnings.join('\n')).toMatch(/Collection: its headers were not imported/)
    expect(entry.warnings.join('\n')).toMatch(/Folder "API": its headers were not imported/)
    expect(entry.warnings.join('\n')).toMatch(/Scripts were not imported for 2 items \(Collection, Folder "API"\)\./)
    expect(entry.warnings.join('\n')).toMatch(/1 environment was not imported \(Dev\)/)
    expect(entry.warnings.join('\n')).toMatch(/"Rpc": only HTTP and GraphQL requests are imported\./)
    expect(entry.warnings.join('\n')).toMatch(/one or more multipart file fields were not imported/)
    expect(entry.warnings.join('\n')).toMatch(/Multipart part content types were not imported/)
    expect(entry.warnings.join('\n')).toMatch(/Tags on the collection, folders, or requests were not imported\./)
  })
})
