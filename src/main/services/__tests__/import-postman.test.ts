import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { previewImport } from '../import-formats'
import { convertPostmanScripts, isPostmanCollection } from '../import-postman'
import { parseRules } from '../../../shared/extract'
import type { ExportCollection, ExportRequest } from '../../ipc/export-import'

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8')
const SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'

const importDoc = async (item: unknown, extra: object = {}) => {
  const preview = await previewImport(JSON.stringify({ info: { name: 'C', schema: SCHEMA }, item: [item], ...extra }))
  const collection = preview.collections[0].collection
  return { collection, request: collection.requests[0] as ExportRequest, warnings: preview.warnings }
}
const rows = (v: unknown) => v as Array<{ key: string; value: string; enabled: boolean; fieldType?: string }>
const test = (exec: string[]) => [{ listen: 'test', script: { exec } }]

describe('Postman test scripts', () => {
  it('converts environment and collection variable sets from the response', () => {
    const { rules, warnings } = convertPostmanScripts('Login', test([
      '// save the token',
      'var jsonData = pm.response.json();',
      'pm.environment.set("token", jsonData.data.access_token);',
      "pm.collectionVariables.set('first', jsonData.items[0].id);",
      'pm.environment.set("rid", pm.response.headers.get("X-Request-Id"));',
      'pm.environment.set("status", pm.response.code);',
      'pm.environment.set("sid", pm.cookies.get("sid"));',
      'pm.environment.set("direct", pm.response.json().user.name);',
    ]))
    expect(warnings).toEqual([])
    expect(rules.map((r) => [r.source, r.expression, r.variable, r.scope])).toEqual([
      ['json', '$.data.access_token', 'token', 'environment'],
      ['json', '$.items[0].id', 'first', 'collection'],
      ['header', 'X-Request-Id', 'rid', 'environment'],
      ['status', '', 'status', 'environment'],
      ['cookie', 'sid', 'sid', 'environment'],
      ['json', '$.user.name', 'direct', 'environment'],
    ])
  })

  it('warns about what it cannot convert and keeps what it can', () => {
    const { rules, warnings } = convertPostmanScripts('R', test([
      'const d = pm.response.json();',
      'pm.environment.set("a", d.x);',
      'pm.environment.set("b", d.x.toUpperCase());',
      'pm.globals.set("g", d.x);',
      'pm.test("ok", function () { pm.response.to.have.status(200); });',
    ]))
    expect(rules).toHaveLength(1)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/3 script lines/)
  })

  it('warns that pre-request scripts are not imported', () => {
    const { warnings } = convertPostmanScripts('R', [{ listen: 'prerequest', script: { exec: ['console.log(1)'] } }])
    expect(warnings[0]).toMatch(/pre-request/)
  })

  it('attaches rules to the imported request', async () => {
    const { request, warnings } = await importDoc({
      name: 'Login',
      request: { method: 'POST', url: 'http://x/login' },
      event: test(['pm.environment.set("t", pm.response.json().token);', 'tests["x"] = true;']),
    })
    expect(parseRules(request.protocolConfig.extractRules as string)).toHaveLength(1)
    expect(warnings).toHaveLength(1)
  })

  it('ignores disabled scripts at collection, folder and request scope', async () => {
    const preview = await previewImport(JSON.stringify({
      info: { name: 'C', schema: SCHEMA },
      event: [{ listen: 'prerequest', disabled: true, script: { exec: ['console.log("collection")'] } }],
      item: [{
        name: 'F',
        event: [{ listen: 'test', disabled: true, script: { exec: ['pm.environment.set("folder", pm.response.code);'] } }],
        item: [{
          name: 'R',
          event: [{ listen: 'test', disabled: true, script: { exec: ['pm.environment.set("request", pm.response.code);'] } }],
          request: { method: 'GET', url: 'http://x.test' },
        }],
      }],
    }))
    expect(preview.warnings).toEqual([])
    expect(preview.collections[0].collection.folders[0].requests[0].protocolConfig).toEqual({})
  })
})

describe('Postman auth mapping', () => {
  const entries = (o: Record<string, string>) => Object.entries(o).map(([key, value]) => ({ key, value, type: 'string' }))
  const authOf = async (auth: unknown) => {
    const { request, warnings } = await importDoc({ name: 'R', request: { method: 'GET', url: 'https://x.test', auth } })
    return { auth: request.auth, warnings }
  }

  it('maps bearer, basic, API key, Digest, NTLM and AWS Signature', async () => {
    expect((await authOf({ type: 'bearer', bearer: entries({ token: 't' }) })).auth).toEqual({ type: 'bearer', config: { token: 't' } })
    expect((await authOf({ type: 'basic', basic: entries({ username: 'u', password: 'p' }) })).auth).toEqual({ type: 'basic', config: { username: 'u', password: 'p' } })
    expect((await authOf({ type: 'apikey', apikey: entries({ key: 'X-Key', value: 'v', in: 'query' }) })).auth).toEqual({ type: 'apikey', config: { key: 'X-Key', value: 'v', in: 'query' } })
    expect((await authOf({ type: 'apikey', apikey: entries({ key: 'X-Key', value: 'v' }) })).auth.config).toMatchObject({ in: 'header' })
    expect((await authOf({ type: 'digest', digest: entries({ username: 'u', password: 'p', realm: 'r' }) })).auth).toEqual({ type: 'digest', config: { username: 'u', password: 'p' } })
    expect((await authOf({ type: 'ntlm', ntlm: entries({ username: 'u', password: 'p', domain: 'd' }) })).auth.type).toBe('ntlm')
    expect((await authOf({ type: 'awsv4', awsv4: entries({ accessKey: 'A', secretKey: 'S', sessionToken: 'T', region: 'r', service: 's' }) })).auth).toEqual({
      type: 'awsv4', config: { accessKey: 'A', secretKey: 'S', sessionToken: 'T', region: 'r', service: 's' },
    })
  })

  it('accepts the object form of auth parameters used by v2.0 exports', async () => {
    expect((await authOf({ type: 'basic', basic: { username: 'u', password: 'p' } })).auth.config).toEqual({ username: 'u', password: 'p' })
  })

  it('maps OAuth 2.0 including the grant type and endpoints', async () => {
    const { auth } = await authOf({
      type: 'oauth2',
      oauth2: [...entries({ grant_type: 'password_credentials', clientId: 'id', clientSecret: 's', accessTokenUrl: 'https://t', authUrl: 'https://a', scope: 'read write', redirect_uri: 'https://cb' }), { key: 'audience', value: { x: 'y' }, type: 'any' }],
    })
    expect(auth).toEqual({ type: 'oauth2', config: { grantType: 'password', clientId: 'id', clientSecret: 's', authUrl: 'https://a', tokenUrl: 'https://t', scopes: 'read write', redirectUri: 'https://cb' } })
  })

  it('warns about unsupported schemes instead of silently dropping them', async () => {
    const { auth, warnings } = await authOf({ type: 'oauth1', oauth1: [] })
    expect(auth.type).toBe('none')
    expect(warnings.join()).toMatch(/oauth1.*not supported/)
  })

  it('inherits by default, honours "No Auth", and takes folder and collection auth', async () => {
    const preview = await previewImport(JSON.stringify({
      info: { name: 'C', schema: SCHEMA },
      auth: { type: 'bearer', bearer: entries({ token: 'root' }) },
      item: [
        { name: 'F', auth: { type: 'noauth' }, item: [{ name: 'in', request: { method: 'GET', url: 'http://x' } }] },
        { name: 'top', request: { method: 'GET', url: 'http://x' } },
        { name: 'off', request: { method: 'GET', url: 'http://x', auth: { type: 'noauth' } } },
      ],
    }))
    const c = preview.collections[0].collection
    expect(c.auth).toEqual({ type: 'bearer', config: { token: 'root' } })
    expect(c.folders[0].auth.type).toBe('none')
    expect(c.requests.map((r) => r.auth.type)).toEqual(['inherit', 'none'])
    expect(c.folders[0].requests[0].auth.type).toBe('inherit')
  })
})

describe('Postman requests', () => {
  it('imports the real "complex" export with nested folders, bodies and disabled rows', async () => {
    const preview = await previewImport(fixture('real-postman-complex-v2_1.json'))
    expect(preview.format).toBe('postman')
    const c: ExportCollection = preview.collections[0].collection
    expect(c.name).toBe('Complex Test Collection')
    expect(preview.collections[0]).toMatchObject({ folders: 1, requests: 6 })
    const form = c.folders[0].requests[0]
    expect(form.bodyType).toBe('form-data')
    expect(rows(JSON.parse(form.bodyContent)).map((r) => [r.key, r.enabled, r.fieldType ?? 'text'])).toEqual([['file', true, 'file'], ['foo', true, 'text'], ['baz', false, 'text']])
    expect(preview.warnings.join()).toMatch(/Unknown Body.*"unknown"/)
  })

  it('imports v2.0 exports too', async () => {
    const preview = await previewImport(fixture('real-postman-complex-v2_0.json'))
    expect(preview.format).toBe('postman')
    expect(preview.collections[0].requests).toBe(6)
  })

  it('maps real OAuth 2.0 exports for every grant type', async () => {
    const preview = await previewImport(fixture('real-postman-oauth2-v2_1.json'))
    const grants = preview.collections[0].collection.requests.map((r) => r.auth.config.grantType)
    expect(grants).toEqual(['authorization_code', 'authorization_code', 'implicit', 'password', 'client_credentials'])
    expect(preview.warnings).toHaveLength(1)
    expect(preview.warnings[0]).toMatch(/password grant/)
  })

  it('reports scripts that were not imported', async () => {
    const { warnings } = await previewImport(fixture('real-postman-scripts-v2_1.json'))
    expect(warnings.join('\n')).toMatch(/Collection-level scripts/)
    expect(warnings.join('\n')).toMatch(/pre-request script/)
  })

  it('keeps query parameters out of the URL, including disabled ones', async () => {
    const { request } = await importDoc({
      name: 'R',
      request: { method: 'GET', url: { raw: 'https://x.test/a?x=1&y=2', host: ['x', 'test'], path: ['a'], query: [{ key: 'x', value: '1' }, { key: 'y', value: '2', disabled: true }, { key: 'z', value: null }] } },
    })
    expect(request.url).toBe('https://x.test/a')
    expect(rows(request.params).map((p) => [p.key, p.value, p.enabled])).toEqual([['x', '1', true], ['y', '2', false], ['z', '', true]])
  })

  it('splits the query of a plain string URL and drops the fragment', async () => {
    const { request } = await importDoc({ name: 'R', request: { method: 'GET', url: 'https://x.test/a?x=1&flag#frag' } })
    expect(request.url).toBe('https://x.test/a')
    expect(rows(request.params).map((p) => [p.key, p.value])).toEqual([['x', '1'], ['flag', '']])
  })

  it('builds a URL when the export has no raw value', async () => {
    const { request } = await importDoc({ name: 'R', request: { method: 'GET', url: { protocol: 'http', host: ['localhost'], port: '3000', path: ['api', 'v1'] } } })
    expect(request.url).toBe('http://localhost:3000/api/v1')
  })

  it('turns :path variables into collection variables', async () => {
    const { request, collection } = await importDoc({
      name: 'R',
      request: { method: 'GET', url: { raw: 'http://localhost:8080/users/:id/posts/:postId', variable: [{ key: 'id', value: '42' }] } },
    })
    expect(request.url).toBe('http://localhost:8080/users/{{id}}/posts/{{postId}}')
    expect(collection.variables).toEqual(expect.arrayContaining([{ key: 'id', value: '42', isSecret: false }, { key: 'postId', value: '', isSecret: false }]))
  })

  it('imports collection variables and blanks secrets', async () => {
    const { collection } = await importDoc({ name: 'R', request: 'http://x' }, { variable: [{ key: 'a', value: '1' }, { key: 's', value: 'shh', type: 'secret' }] })
    expect(collection.variables).toEqual([{ key: 'a', value: '1', isSecret: false }, { key: 's', value: '', isSecret: true }])
  })

  it('skips disabled collection variables and collapses folder/item variables to collection scope', async () => {
    const preview = await previewImport(JSON.stringify({
      info: { name: 'C', schema: SCHEMA },
      variable: [{ key: 'root', value: '1' }, { key: 'off', value: 'x', disabled: true }],
      item: [{
        name: 'Folder',
        variable: [{ key: 'root', value: 'folder-wins?' }, { key: 'folderOnly', value: '2' }, { key: 'folderDisabled', value: 'x', disabled: true }],
        item: [{
          name: 'Request',
          variable: [{ key: 'folderOnly', value: 'override' }, { key: 'requestOnly', value: '3', type: 'secret' }],
          request: { method: 'GET', url: 'http://x.test' },
        }],
      }],
    }))
    expect(preview.collections[0].collection.variables).toEqual([
      { key: 'root', value: '1', isSecret: false },
      { key: 'folderOnly', value: '2', isSecret: false },
      { key: 'requestOnly', value: '', isSecret: true },
    ])
    expect(preview.warnings).toHaveLength(1)
    expect(preview.warnings[0]).toMatch(/2 folder variables and 2 item variables were imported as collection variables/i)
    expect(preview.warnings[0]).toMatch(/first value won/i)
  })

  it('parses string-form request headers', async () => {
    const { request } = await importDoc({
      name: 'R',
      request: {
        method: 'POST',
        url: 'http://x.test',
        header: 'Content-Type: application/json\r\nX-Trace: a:b\r\nFlag',
        body: { mode: 'raw', raw: '{}' },
      },
    })
    expect(request.bodyType).toBe('raw-json')
    expect(rows(request.headers).map((h) => [h.key, h.value, h.enabled])).toEqual([
      ['Content-Type', 'application/json', true],
      ['X-Trace', 'a:b', true],
      ['Flag', '', true],
    ])
  })

  it('warns once about saved responses and protocol profile behavior while mapping redirect overrides', async () => {
    const preview = await previewImport(JSON.stringify({
      info: { name: 'C', schema: SCHEMA },
      protocolProfileBehavior: { followRedirects: false, disableBodyPruning: true },
      item: [{
        name: 'Folder',
        protocolProfileBehavior: { maxRedirects: 2, strictSSL: false },
        item: [{
          name: 'R',
          protocolProfileBehavior: { followRedirects: true, maxRedirects: 1 },
          response: [{ name: '200' }, { name: '500' }],
          request: { method: 'GET', url: 'http://x.test' },
        }],
      }],
    }))
    const collection = preview.collections[0].collection
    expect(collection.network).toEqual({ followRedirects: false })
    expect(collection.folders[0].network).toEqual({ maxRedirects: 2 })
    expect(collection.folders[0].requests[0].network).toEqual({ followRedirects: true, maxRedirects: 1 })
    expect(preview.warnings).toHaveLength(2)
    expect(preview.warnings.join('\n')).toMatch(/2 saved response examples across 1 request were not imported/i)
    expect(preview.warnings.join('\n')).toMatch(/protocolProfileBehavior was imported from 1 collection, 1 folder, 1 item/i)
    expect(preview.warnings.join('\n')).toMatch(/Mapped: followRedirects, maxRedirects/i)
    expect(preview.warnings.join('\n')).toMatch(/Ignored keys: disableBodyPruning, strictSSL/i)
  })

  it('maps raw languages, GraphQL and urlencoded bodies', async () => {
    const raw = (language: string) => importDoc({ name: 'R', request: { method: 'POST', url: 'http://x', body: { mode: 'raw', raw: 'x', options: { raw: { language } } } } })
    expect((await raw('json')).request.bodyType).toBe('raw-json')
    expect((await raw('xml')).request.bodyType).toBe('raw-xml')
    const sniffed = await importDoc({ name: 'R', request: { method: 'POST', url: 'http://x', header: [{ key: 'Content-Type', value: 'application/json' }], body: { mode: 'raw', raw: '{}' } } })
    expect(sniffed.request.bodyType).toBe('raw-json')
    const gql = await importDoc({ name: 'R', request: { method: 'POST', url: 'http://x', body: { mode: 'graphql', graphql: { query: '{ a }', variables: '{}' } } } })
    expect(gql.request.bodyType).toBe('graphql')
    expect(JSON.parse(gql.request.bodyContent)).toEqual({ query: '{ a }', variables: '{}' })
    const form = await importDoc({ name: 'R', request: { method: 'POST', url: 'http://x', body: { mode: 'urlencoded', urlencoded: [{ key: 'a', value: 'b', disabled: true }] } } })
    expect(rows(JSON.parse(form.request.bodyContent))[0]).toMatchObject({ key: 'a', value: 'b', enabled: false })
  })

  it('warns about binary bodies and unsupported dynamic variables', async () => {
    const bin = await importDoc({ name: 'B', request: { method: 'POST', url: 'http://x', body: { mode: 'file', file: { src: '/a.bin' } } } })
    expect(bin.request.bodyType).toBe('binary')
    expect(bin.warnings.join()).toMatch(/binary body/)
    const dyn = await importDoc({ name: 'D', request: { method: 'GET', url: 'http://x/{{$randomFirstName}}/{{$guid}}' } })
    expect(dyn.warnings.join()).toMatch(/\{\{\$randomFirstName\}\}/)
    expect(dyn.warnings.join()).not.toMatch(/\$guid/)
  })
})

describe('Postman detection', () => {
  it('accepts Postman hosts and rejects malformed schemas', () => {
    expect(isPostmanCollection({ info: { schema: 'https://schema.postman.com/json/collection/v2.1.0/collection.json' } })).toBe(true)
    expect(isPostmanCollection({ info: { schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' } })).toBe(true)
    expect(isPostmanCollection({ info: { schema: 'not a valid url' } })).toBe(false)
    expect(isPostmanCollection({ info: { schema: 'https://example.com/collection.json' } })).toBe(false)
  })

  it('explains environment files and v1 collections', async () => {
    await expect(previewImport(JSON.stringify({ id: 'x', name: 'Env', values: [], _postman_variable_scope: 'environment' }))).rejects.toThrow(/environment file/)
    await expect(previewImport(JSON.stringify({ id: 'x', name: 'Old', requests: [] }))).rejects.toThrow(/v1/)
  })
})

describe('additional Postman edge cases', () => {
  it('supports JSON.parse(responseBody) aliases and warns about unsupported setters', () => {
    const { rules, warnings } = convertPostmanScripts('Alias', test([
      'const parsed = JSON.parse(responseBody);',
      'pm.collectionVariables.set("client-id", parsed["client-id"]);',
      'pm.globals.set("globalOnly", parsed.token);',
      'pm.variables.set("localOnly", parsed.token);',
    ]))

    expect(rules.map((rule) => [rule.source, rule.expression, rule.variable, rule.scope])).toEqual([
      ['json', '$["client-id"]', 'client-id', 'collection'],
    ])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatch(/2 script lines could not be converted/)
  })

  it('ignores invalid protocolProfileBehavior values and non-request items', async () => {
    const preview = await previewImport(JSON.stringify({
      info: { name: 'C', schema: SCHEMA },
      variable: [{ key: '', value: 'ignored' }, { key: 'root', value: '1' }],
      protocolProfileBehavior: { followRedirects: 'sometimes', maxRedirects: 'NaN', disableBodyPruning: true },
      item: [
        { name: 'Not a request' },
        {
          name: 'Binary',
          variable: [{ key: '', value: 'ignored' }, { key: 'itemOnly', value: '2' }],
          request: { method: 'POST', url: 'http://x.test', body: { mode: 'file', file: {} } },
        },
      ],
    }))

    expect(preview.collections[0].collection.variables).toEqual([
      { key: 'root', value: '1', isSecret: false },
      { key: 'itemOnly', value: '2', isSecret: false },
    ])
    expect(preview.collections[0].collection.network).toBeUndefined()
    expect(preview.collections[0].collection.requests[0]).toMatchObject({ bodyType: 'binary', bodyContent: '' })
    expect(preview.warnings.join('\n')).toMatch(/1 item variable was imported as collection variables/)
    expect(preview.warnings.join('\n')).toMatch(/protocolProfileBehavior was imported from 1 collection\./)
    expect(preview.warnings.join('\n')).toMatch(/Ignored keys: disableBodyPruning, followRedirects, maxRedirects\./)
  })
})

describe('script parsing limits', () => {
  it('handles a pathological whitespace line quickly', () => {
    const line = `pm.environment.set('a', x${' '.repeat(200_000)}y`
    const start = Date.now()
    const result = convertPostmanScripts('r', test([line]))
    expect(Date.now() - start).toBeLessThan(500)
    expect(result.rules).toEqual([])
    expect(result.warnings.length).toBe(1)
  })

  it('rejects collections nested deeper than the import budget allows', async () => {
    let item: Record<string, unknown> = { name: 'leaf', request: { method: 'GET', url: 'http://x.test' } }
    for (let i = 0; i < 66; i++) item = { name: `F${i}`, item: [item] }
    await expect(previewImport(JSON.stringify({ info: { name: 'C', schema: SCHEMA }, item: [item] }))).rejects.toThrow(/nested deeper than 64 levels/i)
  })
})

describe('Postman collection v3', () => {
  it('imports a single-file v3 collection', async () => {
    const preview = await previewImport(['$kind: collection', 'name: x', ''].join('\n'))
    expect(preview.format).toBe('postman')
  })
})
