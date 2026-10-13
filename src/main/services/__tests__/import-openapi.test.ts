import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { previewImport } from '../import-formats'
import { sampleValue } from '../import-openapi'

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8')

describe('OpenAPI 3 import', () => {
  it('maps tags to folders, untagged operations to the root, and reports counts', async () => {
    const preview = await previewImport(fixture('petstore-oas3.yaml'))
    expect(preview.format).toBe('openapi')
    const [entry] = preview.collections
    expect(entry.collection.name).toBe('Pet Store')
    expect(entry.folders).toBe(1)
    expect(entry.requests).toBe(6)
    expect(entry.collection.folders[0]).toMatchObject({ name: 'pets', description: 'Pet operations' })
    expect(entry.collection.requests.map((r) => r.name)).toEqual(['Upload avatar', 'Log in'])
  })

  it('puts the server URL in a baseUrl variable, resolving server variable defaults', async () => {
    const { collections, warnings } = await previewImport(fixture('petstore-oas3.yaml'))
    const { variables, folders } = collections[0].collection
    expect(variables).toContainEqual({ key: 'baseUrl', value: 'https://api.example.com/v1', isSecret: false })
    expect(variables).toContainEqual({ key: 'petId', value: '7', isSecret: false })
    expect(folders[0].requests[0].url).toBe('{{baseUrl}}/pets')
    expect(folders[0].requests[2].url).toBe('{{baseUrl}}/pets/{{petId}}')
    expect(warnings).toContain('2 servers are defined; only the first is used as {{baseUrl}} (others: https://staging.example.com/v1).')
  })

  it('merges path-level parameters and marks only required ones enabled', async () => {
    const { collections } = await previewImport(fixture('petstore-oas3.yaml'))
    const list = collections[0].collection.folders[0].requests[0]
    expect(list.params).toMatchObject([
      { key: 'limit', value: '20', enabled: true },
      { key: 'tag', value: '', enabled: false },
    ])
    expect(list.headers).toMatchObject([{ key: 'X-Trace', enabled: false }])
  })

  it('builds example bodies from schemas, skipping read-only properties', async () => {
    const { collections } = await previewImport(fixture('petstore-oas3.yaml'))
    const create = collections[0].collection.folders[0].requests[1]
    expect(create.bodyType).toBe('raw-json')
    expect(JSON.parse(create.bodyContent)).toEqual({ name: 'Rex', tags: ['string'], owner: { email: 'string' } })
  })

  it('maps multipart and urlencoded bodies to key/value rows', async () => {
    const { collections } = await previewImport(fixture('petstore-oas3.yaml'))
    const [upload, login] = collections[0].collection.requests
    expect(upload.bodyType).toBe('form-data')
    expect(JSON.parse(upload.bodyContent)).toMatchObject([{ key: 'name' }, { key: 'file', fieldType: 'file' }])
    expect(login.bodyType).toBe('x-www-form-urlencoded')
    expect(JSON.parse(login.bodyContent)).toMatchObject([{ key: 'user', value: 'bob' }])
  })

  it('maps security: global bearer is inherited, per-operation apiKey and empty security override it', async () => {
    const { collections } = await previewImport(fixture('petstore-oas3.yaml'))
    const col = collections[0].collection
    expect(col.auth).toEqual({ type: 'bearer', config: { token: '' } })
    const [list, , get, del] = col.folders[0].requests
    expect(list.auth.type).toBe('inherit')
    expect(get.auth).toEqual({ type: 'apikey', config: { key: 'X-API-Key', value: '', in: 'header' } })
    expect(del.auth.type).toBe('none')
  })

  it('warns about everything it cannot map instead of dropping it silently', async () => {
    const { warnings } = await previewImport(fixture('petstore-oas3.yaml'))
    expect(warnings.some((w) => w.includes('cookie parameters'))).toBe(true)
    expect(warnings.some((w) => w.includes('callbacks'))).toBe(true)
  })

  it('maps OAuth 2 flows to the OAuth 2.0 auth type with the requested scopes', async () => {
    const { collections } = await previewImport(fixture('petstore-oas3.yaml'))
    const login = collections[0].collection.requests[1]
    expect(login.auth).toEqual({
      type: 'oauth2',
      config: { grantType: 'implicit', clientId: '', clientSecret: '', authUrl: 'https://example.com/auth', tokenUrl: '', scopes: 'read', redirectUri: '' },
    })
  })
})

describe('Swagger 2 import', () => {
  it('builds the base URL, body, form data and basic auth', async () => {
    const preview = await previewImport(fixture('swagger2.json'))
    const col = preview.collections[0].collection
    expect(col.variables).toContainEqual({ key: 'baseUrl', value: 'https://legacy.example.com/api', isSecret: false })
    expect(col.auth.type).toBe('basic')
    const put = col.folders[0].requests[0]
    expect(put).toMatchObject({ method: 'PUT', url: '{{baseUrl}}/items/{{id}}', bodyType: 'raw-json' })
    expect(JSON.parse(put.bodyContent)).toEqual({ label: 'string' })
    const form = col.requests[0]
    expect(form.bodyType).toBe('x-www-form-urlencoded')
    expect(JSON.parse(form.bodyContent)).toMatchObject([{ key: 'q', value: 'x' }])
  })
})

describe('previewImport', () => {
  it('reads JSON as well as YAML', async () => {
    const preview = await previewImport(JSON.stringify({ openapi: '3.0.0', info: { title: 'T', version: '1' }, paths: {} }))
    expect(preview.collections[0].collection.name).toBe('T')
    expect(preview.warnings).toContain('The document has no operations.')
  })

  it('recognises a Postly export and counts nested content', async () => {
    const leaf = { name: 'f', description: '', auth: { type: 'none', config: {} }, ssl: 'inherit', requests: [{}, {}], folders: [] }
    const preview = await previewImport(JSON.stringify({
      $schema: 'postly/v1',
      collections: [{ name: 'C', requests: [{}], folders: [{ ...leaf, folders: [leaf] }] }],
    }))
    expect(preview.format).toBe('postly')
    expect(preview.collections[0]).toMatchObject({ folders: 2, requests: 5 })
  })

  it('does not follow external references', async () => {
    const doc = { openapi: '3.0.0', info: { title: 'T', version: '1' }, paths: { '/a': { get: { responses: { 200: { $ref: 'http://127.0.0.1:1/x.json' } } } } } }
    await expect(previewImport(JSON.stringify(doc))).resolves.toBeTruthy()
  })

  it.each([
    ['', 'empty'],
    ['{not json', 'Invalid JSON'],
    ['just: some\nother: yaml', 'Unrecognised format'],
    ['[1,2]', 'expected a JSON or YAML object'],
  ])('rejects %j', async (text, message) => {
    await expect(previewImport(text)).rejects.toThrow(new RegExp(message, 'i'))
  })

  it('reports an invalid OpenAPI document', async () => {
    const doc = { openapi: '3.0.0', info: { title: 'T', version: '1' }, paths: { '/a': { get: { parameters: [{ $ref: '#/components/missing' }] } } } }
    await expect(previewImport(JSON.stringify(doc))).rejects.toThrow(/Invalid OpenAPI document/)
  })
})

describe('sampleValue', () => {
  it('is bounded for recursive structures', () => {
    const node: Record<string, unknown> = { type: 'object', properties: {} }
    ;(node.properties as Record<string, unknown>).child = node
    expect(() => JSON.stringify(sampleValue(node))).not.toThrow()
  })

  it('prefers example, default and enum', () => {
    expect(sampleValue({ type: 'string', example: 'a' })).toBe('a')
    expect(sampleValue({ type: 'string', default: 'd' })).toBe('d')
    expect(sampleValue({ type: 'string', enum: ['x', 'y'] })).toBe('x')
  })
})

const walk = (c: { requests: unknown[]; folders?: unknown[] }, out: Array<Record<string, string>> = []): Array<Record<string, string>> => {
  out.push(...(c.requests as Array<Record<string, string>>))
  for (const f of (c.folders ?? []) as Array<{ requests: unknown[]; folders?: unknown[] }>) walk(f, out)
  return out
}

describe('documents published by real tools and vendors', () => {
  // Swagger Petstore (v2 and v3), OpenAPI Initiative examples (3.0 and 3.1), USPTO
  it.each(['real-petstore3.json', 'real-petstore2.json', 'real-tictactoe-oas31.yaml', 'real-uspto.yaml', 'real-link-example.yaml'])('%s converts to usable requests', async (name) => {
    const { collections } = await previewImport(fixture(name))
    const requests = walk(collections[0].collection)
    expect(requests.length).toBeGreaterThan(0)
    for (const r of requests) {
      expect(r.url, r.name).toMatch(/^\{\{baseUrl\}\}\//)
      expect(r.url.replace(/\{\{[^}]+\}\}/g, ''), r.name).not.toMatch(/[{}]/)
      if (r.bodyType === 'raw-json') expect(() => JSON.parse(r.bodyContent), r.name).not.toThrow()
    }
  })

  it('resolves a relative server URL against the address the document was fetched from', async () => {
    const text = fixture('real-petstore3.json')
    const fetched = await previewImport(text, { sourceUrl: 'https://petstore3.swagger.io/api/v3/openapi.json' })
    expect(fetched.collections[0].collection.variables).toContainEqual({ key: 'baseUrl', value: 'https://petstore3.swagger.io/api/v3', isSecret: false })
    const local = await previewImport(text)
    expect(local.warnings.some((w) => w.includes('is relative'))).toBe(true)
  })

  it('does not produce a double slash when the server URL ends with one', async () => {
    const { collections } = await previewImport(fixture('real-uspto.yaml'))
    expect(collections[0].collection.variables?.find((v) => v.key === 'baseUrl')?.value).toBe('https://developer.uspto.gov/ds-api')
  })

  it('handles OpenAPI 3.1 nullable types and schema examples', () => {
    expect(sampleValue({ type: ['null', 'integer'] })).toBe(0)
    expect(sampleValue({ type: 'string', examples: ['first', 'second'] })).toBe('first')
  })

  it('expands YAML anchors and merge keys', async () => {
    const preview = await previewImport(`
openapi: 3.0.0
info: { title: Anchors, version: '1' }
servers: [{ url: 'https://a.test' }]
x-common: &common
  summary: Shared
paths:
  /a:
    get:
      <<: *common
`)
    expect(walk(preview.collections[0].collection)[0].name).toBe('Shared')
  })

  it('lists optional form fields disabled so a send does not submit invented values', async () => {
    const preview = await previewImport(JSON.stringify({
      openapi: '3.0.0', info: { title: 'F', version: '1' }, servers: [{ url: 'https://a.test' }],
      paths: { '/f': { post: { requestBody: { content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', required: ['must'], properties: { must: { type: 'string' }, opt: { type: 'integer' }, nested: { type: 'object', properties: { a: { type: 'string' } } } } } } } } } } },
    }))
    const rows = JSON.parse(walk(preview.collections[0].collection)[0].bodyContent) as Array<{ key: string; value: string; enabled: boolean }>
    expect(rows.map((r) => [r.key, r.enabled])).toEqual([['must', true], ['opt', false], ['nested', false]])
    expect(rows[2].value).toBe('')
  })
})

describe('OAuth 2 and OpenID Connect', () => {
  const doc = (schemes: object, security: object[]) => JSON.stringify({
    openapi: '3.0.0', info: { title: 'A', version: '1' }, servers: [{ url: 'https://a.test' }],
    components: { securitySchemes: schemes }, security,
    paths: { '/x': { get: { responses: {} } } },
  })

  it('prefers authorization code over other flows and says what else was offered', async () => {
    const preview = await previewImport(doc({
      o: { type: 'oauth2', flows: {
        clientCredentials: { tokenUrl: 'https://a.test/token', scopes: { s: '' } },
        authorizationCode: { authorizationUrl: 'https://a.test/auth', tokenUrl: 'https://a.test/token', scopes: { a: '', b: '' } },
      } },
    }, [{ o: [] }]))
    expect(preview.collections[0].collection.auth.config).toMatchObject({ grantType: 'authorization_code', authUrl: 'https://a.test/auth', tokenUrl: 'https://a.test/token', scopes: 'a b' })
    expect(preview.warnings.some((w) => w.includes('also available: client_credentials'))).toBe(true)
  })

  it('maps the Swagger 2 application flow to client credentials', async () => {
    const preview = await previewImport(JSON.stringify({
      swagger: '2.0', info: { title: 'S', version: '1' }, host: 'a.test',
      securityDefinitions: { o: { type: 'oauth2', flow: 'application', tokenUrl: 'https://a.test/token', scopes: { r: '' } } },
      security: [{ o: ['r'] }],
      paths: { '/x': { get: { responses: {} } } },
    }))
    expect(preview.collections[0].collection.auth.config).toMatchObject({ grantType: 'client_credentials', tokenUrl: 'https://a.test/token', scopes: 'r' })
  })

  it('explains that OpenID Connect discovery is not fetched', async () => {
    const preview = await previewImport(doc({ oidc: { type: 'openIdConnect', openIdConnectUrl: 'https://a.test/.well-known/openid-configuration' } }, [{ oidc: [] }]))
    expect(preview.collections[0].collection.auth.type).toBe('none')
    expect(preview.warnings.some((w) => w.includes('OpenID Connect') && w.includes('.well-known'))).toBe(true)
  })
})

describe('documents without tags', () => {
  it('groups by resource, skipping version and api prefixes', async () => {
    const op = { get: { responses: {} } }
    const preview = await previewImport(JSON.stringify({
      openapi: '3.0.0', info: { title: 'N', version: '1' }, servers: [{ url: 'https://a.test' }],
      paths: { '/v1/customers': op, '/v1/customers/{id}': op, '/api/v2/charges': op, '/': op },
    }))
    const col = preview.collections[0].collection
    expect(col.folders.map((f) => [f.name, f.requests.length])).toEqual([['customers', 2], ['charges', 1]])
    expect(col.requests).toHaveLength(1)
  })

  it('keeps untagged operations at the root when the document does use tags', async () => {
    const preview = await previewImport(fixture('petstore-oas3.yaml'))
    expect(preview.collections[0].collection.folders.map((f) => f.name)).toEqual(['pets'])
  })
})

describe('OpenAPI edge cases', () => {
  const base = { openapi: '3.0.0', info: { title: 'T', version: '1' }, servers: [{ url: 'https://a.test' }] }
  const run = async (paths: object) => {
    const p = await previewImport(JSON.stringify({ ...base, paths }))
    const c = p.collections[0].collection
    const requests = [...c.requests, ...c.folders.flatMap((f) => f.requests)]
    return { warnings: p.warnings, requests }
  }

  it('warns when an operation or path declares its own servers', async () => {
    const a = await run({ '/a': { get: { servers: [{ url: 'https://o.test' }], responses: {} } } })
    const b = await run({ '/a': { servers: [{ url: 'https://o.test' }], get: { responses: {} } } })
    expect(a.warnings.join()).toMatch(/own servers/)
    expect(b.warnings.join()).toMatch(/own servers/)
  })

  it('warns about references to other files instead of silently dropping them', async () => {
    const { warnings } = await run({
      '/a': { post: { requestBody: { content: { 'application/json': { schema: { $ref: './pet.yaml' } } } }, responses: {} } },
    })
    expect(warnings.join()).toMatch(/other files or URLs.*\.\/pet\.yaml/)
  })

  it('expands array and object query parameters according to their style', async () => {
    const { requests } = await run({
      '/a': {
        get: {
          parameters: [
            { name: 'ids', in: 'query', schema: { type: 'array', items: { type: 'integer' } }, example: [1, 2] },
            { name: 'csv', in: 'query', explode: false, schema: { type: 'array', items: { type: 'integer' } }, example: [1, 2] },
            { name: 'o', in: 'query', style: 'deepObject', schema: { type: 'object' }, example: { a: 1 } },
          ],
          responses: {},
        },
      },
    })
    const rows = requests[0].params.map((q) => [q.key, q.value])
    expect(rows).toEqual([['ids', '1'], ['ids', '2'], ['csv', '1,2'], ['o[a]', '1']])
  })

  it('ignores Accept, Content-Type and Authorization header parameters', async () => {
    const { requests } = await run({
      '/a': {
        get: {
          parameters: ['Authorization', 'Content-Type', 'Accept', 'X-Ok'].map((name) => ({ name, in: 'header', schema: { type: 'string' } })),
          responses: {},
        },
      },
    })
    expect(requests[0].headers.map((h) => h.key)).toEqual(['X-Ok'])
  })
})
