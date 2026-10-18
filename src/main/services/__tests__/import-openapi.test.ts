import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { ExportRequest } from '../../ipc/export-import'
import { previewImport } from '../import-formats'
import { convertOpenApi, isOpenApiDocument, sampleValue } from '../import-openapi'

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

  it('puts the first server URL in a baseUrl variable, resolving server variable defaults, and imports environments for multiple servers', async () => {
    const { collections, warnings } = await previewImport(fixture('petstore-oas3.yaml'))
    const { variables, folders, environments } = collections[0].collection
    expect(variables).toContainEqual({ key: 'baseUrl', value: 'https://api.example.com/v1', isSecret: false })
    expect(variables).toContainEqual({ key: 'petId', value: '7', isSecret: false })
    expect(environments).toEqual([
      {
        name: 'api.example.com',
        variables: [
          { key: 'baseUrl', value: 'https://{{env}}.example.com/v1', isSecret: false },
          { key: 'env', value: 'api', isSecret: false },
        ],
      },
      {
        name: 'staging.example.com',
        variables: [{ key: 'baseUrl', value: 'https://staging.example.com/v1', isSecret: false }],
      },
    ])
    expect(folders[0].requests[0].url).toBe('{{baseUrl}}/pets')
    expect(folders[0].requests[2].url).toBe('{{baseUrl}}/pets/{{petId}}')
    expect(warnings.some((warning) => warning.includes('only the first is used as {{baseUrl}}'))).toBe(false)
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
    expect(col.environments).toBeUndefined()
    expect(col.auth.type).toBe('basic')
    const put = col.folders[0].requests[0]
    expect(put).toMatchObject({ method: 'PUT', url: '{{baseUrl}}/items/{{id}}', bodyType: 'raw-json' })
    expect(JSON.parse(put.bodyContent)).toEqual({ label: 'string' })
    const form = col.requests[0]
    expect(form.bodyType).toBe('x-www-form-urlencoded')
    expect(JSON.parse(form.bodyContent)).toMatchObject([{ key: 'q', value: 'x' }])
  })

  it('creates one environment per Swagger scheme when there is more than one server', async () => {
    const preview = await previewImport(JSON.stringify({
      swagger: '2.0',
      info: { title: 'Legacy API', version: '1' },
      host: 'legacy.example.com',
      basePath: '/api',
      schemes: ['https', 'http'],
      paths: { '/items': { get: { responses: {} } } },
    }))
    expect(preview.collections[0].collection.environments).toEqual([
      { name: 'legacy.example.com (https)', variables: [{ key: 'baseUrl', value: 'https://legacy.example.com/api', isSecret: false }] },
      { name: 'legacy.example.com (http)', variables: [{ key: 'baseUrl', value: 'http://legacy.example.com/api', isSecret: false }] },
    ])
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

type RequestTree = { requests: ExportRequest[]; folders?: RequestTree[] }

const walk = (c: RequestTree, out: ExportRequest[] = []): ExportRequest[] => {
  out.push(...c.requests)
  for (const f of c.folders ?? []) walk(f, out)
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

  it('applies operation > path > root server precedence to request URLs', async () => {
    const { requests, warnings } = await run({
      '/from-path': {
        servers: [{ url: 'https://path.test/api' }],
        get: { responses: {} },
        post: { servers: [{ url: 'https://op.test/api' }], responses: {} },
      },
      '/from-root': { get: { responses: {} } },
    })
    expect(requests.map((request) => [request.name, request.url])).toEqual([
      ['GET /from-path', 'https://path.test/api/from-path'],
      ['POST /from-path', 'https://op.test/api/from-path'],
      ['GET /from-root', '{{baseUrl}}/from-root'],
    ])
    expect(warnings.join()).not.toMatch(/own servers/)
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
    const rows = (requests[0].params as Array<{ key: string; value: string }>).map((q) => [q.key, q.value])
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
    expect((requests[0].headers as Array<{ key: string }>).map((h) => h.key)).toEqual(['X-Ok'])
  })

  it('warns about OpenAPI 3.2 operations it cannot import and still imports trace', async () => {
    const { warnings, requests } = await run({
      '/a': { trace: { responses: {} }, query: { responses: {} }, additionalOperations: { COPY: { responses: {} } } },
    })
    expect(requests).toHaveLength(1)
    expect(warnings.join()).toMatch(/"query" operation/)
    expect(warnings.join()).toMatch(/"additionalOperations" operations/)
  })

  it('defaults missing or empty root servers to "/" and resolves them like other relative servers', async () => {
    const local = await previewImport(JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Default Server', version: '1' },
      paths: { '/pets': { get: { responses: {} } } },
    }))
    expect(local.collections[0].collection.variables).toContainEqual({ key: 'baseUrl', value: '/', isSecret: false })
    expect(walk(local.collections[0].collection)[0].url).toBe('{{baseUrl}}/pets')
    expect(local.warnings.join()).toMatch(/The server URL "\/" is relative/)

    const fetched = await previewImport(JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Default Server', version: '1' },
      servers: [],
      paths: { '/pets': { get: { responses: {} } } },
    }), { sourceUrl: 'https://spec.test/openapi.json' })
    expect(fetched.collections[0].collection.variables).toContainEqual({ key: 'baseUrl', value: 'https://spec.test', isSecret: false })
  })
})

describe('server environments', () => {
  const doc = (servers: unknown[]) => JSON.stringify({ openapi: '3.0.3', info: { title: 'T', version: '1' }, servers, paths: { '/pets': { get: { responses: {} } } } })

  it('normalises each environment baseUrl like the collection variable', async () => {
    const preview = await previewImport(doc([{ url: 'https://a.com/v1/' }, { url: '/api' }]), { sourceUrl: 'https://spec.test/openapi.json' })
    const envs = preview.collections[0].collection.environments ?? []
    expect(envs.map((e) => e.variables[0].value)).toEqual(['https://a.com/v1', 'https://spec.test/api'])
  })

  it('renames a server variable called baseUrl instead of overwriting the URL', async () => {
    const preview = await previewImport(doc([{ url: 'https://{baseUrl}.x.com', variables: { baseUrl: { default: 'p' } } }, { url: 'https://b.x.com' }]))
    const env = preview.collections[0].collection.environments?.[0]
    expect(env?.variables).toEqual([
      { key: 'baseUrl', value: 'https://{{serverBaseUrl}}.x.com', isSecret: false },
      { key: 'serverBaseUrl', value: 'p', isSecret: false },
    ])
  })
})



describe('OpenAPI helper coverage', () => {
  it('recognises valid OpenAPI or Swagger objects only when paths is an object', () => {
    expect(isOpenApiDocument({ openapi: '3.0.0', paths: {} })).toBe(true)
    expect(isOpenApiDocument({ swagger: '2.0', paths: {} })).toBe(true)
    expect(isOpenApiDocument({ openapi: '3.0.0', paths: [] })).toBe(false)
    expect(isOpenApiDocument({})).toBe(false)
  })

  it('builds samples from composed schemas and media examples', async () => {
    expect(sampleValue({
      allOf: [
        { type: 'object', properties: { name: { default: 'Rex' } } },
        { type: 'object', properties: { age: { type: 'integer' } } },
      ],
    })).toEqual({ name: 'Rex', age: 0 })
    expect(sampleValue({ oneOf: [{ type: 'string', default: 'first' }, { type: 'integer' }] })).toBe('first')

    const preview = await previewImport(JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Examples', version: '1' },
      servers: [{ url: 'https://a.test' }],
      paths: {
        '/examples': {
          post: {
            requestBody: {
              content: {
                'application/problem+json': {
                  examples: { primary: { value: { from: 'examples' } } },
                  schema: { type: 'object', properties: { from: { default: 'schema' } } },
                },
              },
            },
            responses: {},
          },
        },
      },
    }))

    expect(JSON.parse(walk(preview.collections[0].collection)[0].bodyContent)).toEqual({ from: 'examples' })
  })

  it('maps server variable enums and relative Swagger 2 base paths', async () => {
    const preview = await previewImport(JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Servers', version: '1' },
      servers: [
        { url: 'https://{stage}.example.com/v1', variables: { stage: { enum: ['beta', 'prod'] } } },
        { url: 'https://static.example.com/v1', description: 'Static' },
      ],
      paths: { '/x': { get: { responses: {} } } },
    }))

    expect(preview.collections[0].collection.environments).toEqual([
      {
        name: '{stage}.example.com',
        variables: [
          { key: 'baseUrl', value: 'https://{{stage}}.example.com/v1', isSecret: false },
          { key: 'stage', value: 'beta', isSecret: false },
        ],
      },
      {
        name: 'Static',
        variables: [{ key: 'baseUrl', value: 'https://static.example.com/v1', isSecret: false }],
      },
    ])

    const swagger = await previewImport(JSON.stringify({
      swagger: '2.0',
      info: { title: 'Legacy', version: '1' },
      basePath: '/api',
      paths: { '/items': { get: { responses: {} } } },
    }), { sourceUrl: 'https://legacy.example.com/swagger.json' })

    expect(swagger.collections[0].collection.variables).toContainEqual({ key: 'baseUrl', value: 'https://legacy.example.com/api', isSecret: false })
  })

  it('warns for unsupported security scheme variants instead of pretending they were imported', async () => {
    const preview = await previewImport(JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Auth', version: '1' },
      servers: [{ url: 'https://a.test' }],
      components: {
        securitySchemes: {
          cookieKey: { type: 'apiKey', in: 'cookie', name: 'sid' },
          missingOauth: { type: 'oauth2', flows: {} },
          mtls: { type: 'mutualTLS' },
        },
      },
      paths: {
        '/cookie': { get: { security: [{ cookieKey: [] }], responses: {} } },
        '/oauth': { get: { security: [{ missingOauth: [] }], responses: {} } },
        '/mtls': { get: { security: [{ mtls: [] }], responses: {} } },
      },
    }))

    expect(walk(preview.collections[0].collection).every((request) => request.auth.type === 'none')).toBe(true)
    expect(preview.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('API keys sent in cookies are not supported'),
      expect.stringContaining('defines no usable flow'),
      expect.stringContaining('Security scheme "mtls" (mutualtls) is not mapped'),
    ]))
  })

  it('maps explode styles for object query params and non-JSON media types', async () => {
    const preview = await previewImport(JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Bodies', version: '1' },
      servers: [{ url: 'https://a.test' }],
      webhooks: { ping: { post: { responses: {} } } },
      paths: {
        '/query': {
          get: {
            parameters: [
              { name: 'filter', in: 'query', schema: { type: 'object' }, example: { status: 'open', limit: 10 } },
              { name: 'compact', in: 'query', explode: false, schema: { type: 'object' }, example: { status: 'closed', limit: 5 } },
            ],
            responses: {},
          },
        },
        '/xml': {
          post: {
            requestBody: { content: { 'application/xml': { example: '<pet id="1" />' } } },
            responses: {},
          },
        },
        '/text': {
          post: {
            requestBody: { content: { 'text/plain': { example: 'plain text' } } },
            responses: {},
          },
        },
        '/binary': {
          post: {
            requestBody: { content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } },
            responses: {},
          },
        },
      },
    }))

    const requests = Object.fromEntries(walk(preview.collections[0].collection).map((request) => [request.name, request] as const))
    expect((requests['GET /query'].params as Array<{ key: string; value: string }>).map((row) => [row.key, row.value])).toEqual([
      ['status', 'open'],
      ['limit', '10'],
      ['compact', 'status,closed,limit,5'],
    ])
    expect(requests['POST /xml']).toMatchObject({ bodyType: 'raw-xml', bodyContent: '<pet id="1" />' })
    expect(requests['POST /text']).toMatchObject({ bodyType: 'raw-text', bodyContent: 'plain text' })
    expect(requests['POST /binary'].bodyType).toBe('binary')
    expect(preview.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('application/pdf is mapped as a binary body'),
      expect.stringContaining('Webhooks are not imported'),
    ]))
  })

  it('can convert a document with empty paths directly', () => {
    const converted = convertOpenApi({ openapi: '3.0.0', info: { title: 'Empty', version: '1' }, paths: {} })
    expect(converted.collection.requests).toEqual([])
    expect(converted.collection.folders).toEqual([])
    expect(converted.warnings).toEqual(expect.arrayContaining([
      'The server URL "/" is relative; set {{baseUrl}} to the full address (for example https://host/).',
      'The document has no operations.',
    ]))
    expect(converted.collection.variables).toContainEqual({ key: 'baseUrl', value: '/', isSecret: false })
  })
})
