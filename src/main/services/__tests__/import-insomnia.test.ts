import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { previewImport } from '../import-formats'
import type { ExportCollection, ExportRequest } from '../../ipc/export-import'

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8')
const rows = (v: unknown) => v as Array<{ key: string; value: string; enabled: boolean; fieldType?: string }>

const v4 = (...resources: object[]) => JSON.stringify({ _type: 'export', __export_format: 4, resources: [{ _id: 'wrk_1', _type: 'workspace', parentId: null, name: 'W', description: '' }, ...resources] })
const request = (extra: object) => ({ _id: `req_${Math.random()}`, _type: 'request', parentId: 'wrk_1', name: 'R', method: 'GET', url: 'https://x.test', ...extra })
const importOne = async (extra: object) => {
  const preview = await previewImport(v4(request(extra)))
  const collection = preview.collections[0].collection
  return { collection, request: collection.requests[0] as ExportRequest, warnings: preview.warnings }
}
const minimalV5 = (body: string) => `
type: collection.insomnia.rest/5.0
schema_version: "5.1"
name: V5
meta:
  id: wrk_1
collection:
${body}
`

describe('Insomnia v4 import', () => {
  it('imports a real v4 export with folders, bodies, variables and warnings', async () => {
    const preview = await previewImport(fixture('real-insomnia-v4.json'))
    expect(preview.format).toBe('insomnia')
    const c: ExportCollection = preview.collections[0].collection
    expect(c.name).toBe('Swagger Petstore 1.0.0')
    expect(preview.collections[0]).toMatchObject({ folders: 1, requests: 13 })
    const create = c.requests.find((r) => r.method === 'POST' && r.url.endsWith('/pet'))
    expect(create).toMatchObject({ bodyType: 'raw-json', url: '{{base_url}}/pet' })
    expect(c.variables).toEqual(expect.arrayContaining([{ key: 'base_url', value: '{{scheme}}://{{host}}{{base_path}}', isSecret: false }]))
    expect(c.environments).toEqual([
      {
        name: 'Base environment',
        variables: [{ key: 'base_url', value: '{{scheme}}://{{host}}{{base_path}}', isSecret: false }],
      },
      {
        name: 'OpenAPI env',
        variables: [
          { key: 'base_url', value: '{{scheme}}://{{host}}{{base_path}}', isSecret: false },
          { key: 'scheme', value: 'http', isSecret: false },
          { key: 'base_path', value: '/v2', isSecret: false },
          { key: 'host', value: 'petstore.swagger.io', isSecret: false },
          { key: 'apiKey', value: 'apiKey', isSecret: false },
        ],
      },
    ])
    expect(preview.warnings.join('\n')).toMatch(/2 unit tests were not imported/)
  })

  it('reads YAML in flow style and a multi-workspace export as several collections', async () => {
    expect((await previewImport(fixture('real-insomnia-v4-flow.yaml'))).format).toBe('insomnia')
    const preview = await previewImport(fixture('real-insomnia-multiple-workspaces.yaml'))
    expect(preview.collections.map((c) => c.collection.name)).toEqual(['Collection 1', 'Collection 2'])
    expect(preview.warnings.every((w) => /^Collection \d: /.test(w))).toBe(true)
  })

  it('rejects export formats it does not know', async () => {
    await expect(previewImport(JSON.stringify({ _type: 'export', __export_format: 2, resources: [] }))).rejects.toThrow(/export format 2 is not supported/)
  })

  it('converts template references and warns about tags it cannot convert', async () => {
    const { request: r, warnings } = await importOne({
      url: '{{ _.base_url }}/users/{{ _[\'user-id\'] }}/{{ id }}',
      headers: [{ name: 'X-Id', value: "{% uuid 'v4' %}" }, { name: 'X-Token', value: "{% response 'body', 'req_1', 'b64::JC50b2tlbg==::46b', 'always', 60 %}" }],
    })
    expect(r.url).toBe('{{base_url}}/users/{{user-id}}/{{id}}')
    expect(rows(r.headers).map((h) => h.value)[0]).toBe('{{$guid}}')
    expect(warnings.join()).toMatch(/template tags that were left as text/)
  })

  it('keeps disabled rows and moves a query string out of the URL', async () => {
    const { request: r } = await importOne({
      url: 'https://x.test/a?y=2',
      parameters: [{ name: 'x', value: '1' }, { name: 'off', value: 'v', disabled: true }],
      headers: [{ name: 'H', value: 'v', disabled: true }],
    })
    expect(r.url).toBe('https://x.test/a')
    expect(rows(r.params).map((p) => [p.key, p.value, p.enabled])).toEqual([['x', '1', true], ['off', 'v', false], ['y', '2', true]])
    expect(rows(r.headers)[0].enabled).toBe(false)
  })

  it('maps path parameters to collection variables', async () => {
    const { request: r, collection } = await importOne({ url: 'https://x.test/users/:id', pathParameters: [{ name: 'id', value: '7' }] })
    expect(r.url).toBe('https://x.test/users/{{id}}')
    expect(collection.variables).toEqual([{ key: 'id', value: '7', isSecret: false }])
  })

  it('rewrites docs-style path parameters in v4 and v5 exports', async () => {
    const v4Doc = await importOne({ url: 'https://x.test/users/{user-id}', pathParameters: [{ name: 'user-id', value: '9' }] })
    expect(v4Doc.request.url).toBe('https://x.test/users/{{user-id}}')
    expect(v4Doc.collection.variables).toEqual([{ key: 'user-id', value: '9', isSecret: false }])

    const preview = await previewImport(minimalV5(`  - url: https://x.test/users/{orderId}
    name: R
    meta:
      id: req_1
    method: GET
    pathParameters:
      - name: orderId
        value: "12"
`))
    expect(preview.collections[0].collection.requests[0].url).toBe('https://x.test/users/{{orderId}}')
    expect(preview.collections[0].collection.variables).toEqual([{ key: 'orderId', value: '12', isSecret: false }])
  })

  it('maps follow-redirect overrides and warns once about unsupported request settings', async () => {
    const v4Doc = await importOne({
      settingFollowRedirects: 'off',
      settingSendCookies: false,
      settingStoreCookies: false,
      settingEncodeUrl: false,
      settingRebuildPath: false,
    })
    expect(v4Doc.request.network).toEqual({ followRedirects: false })
    expect(v4Doc.warnings.join('\n')).toMatch(/cookie handling, URL encoding, auto-rebuild path/)

    const preview = await previewImport(minimalV5(`  - url: https://x.test
    name: R
    meta:
      id: req_2
    method: GET
    settings:
      followRedirects: on
      encodeUrl: false
      cookies:
        send: true
        store: false
      rebuildPath: false
`))
    expect(preview.collections[0].collection.requests[0].network).toEqual({ followRedirects: true })
    expect(preview.warnings.join('\n')).toMatch(/cookie handling, URL encoding, auto-rebuild path/)
  })

  it('imports enabled kvPairData from environments and folders, blanking secret base variables in collection scope', async () => {
    const preview = await previewImport(v4(
      {
        _id: 'env_1',
        _type: 'environment',
        parentId: 'wrk_1',
        name: 'Base',
        data: { ignored: 'from-data' },
        kvPairData: [
          { id: 'envPair_1', name: 'baseVar', value: '1', type: 'str', enabled: true },
          { id: 'envPair_2', name: 'secretVar', value: 'shh', type: 'secret', enabled: true },
          { id: 'envPair_3', name: 'disabledVar', value: 'nope', type: 'str', enabled: false },
        ],
      },
      {
        _id: 'grp_1',
        _type: 'request_group',
        parentId: 'wrk_1',
        name: 'Folder',
        environment: { ignoredFolder: 'from-data' },
        kvPairData: [
          { id: 'envPair_4', name: 'folderJson', value: '{"ok":true}', type: 'json', enabled: true },
          { id: 'envPair_5', name: 'disabledFolderVar', value: 'nope', type: 'str', enabled: false },
        ],
        metaSortKey: 1,
      },
      request({ parentId: 'grp_1' }),
    ))
    expect(preview.collections[0].collection.variables).toEqual([
      { key: 'baseVar', value: '1', isSecret: false },
      { key: 'secretVar', value: '', isSecret: true },
      { key: 'folderJson', value: '{"ok":true}', isSecret: false },
    ])
    expect(preview.collections[0].collection.environments).toEqual([
      {
        name: 'Base',
        variables: [
          { key: 'baseVar', value: '1', isSecret: false },
          { key: 'secretVar', value: 'shh', isSecret: true },
        ],
      },
    ])
    expect(preview.warnings.join('\n')).toMatch(/The base environment: 1 secret environment variable was added to the collection variables without its value/)
    expect(preview.warnings.join('\n')).toMatch(/Folder "Folder": secret and typed environment variables were imported as plain text collection variables/)
    expect(preview.warnings.join('\n')).toMatch(/Folder "Folder": its environment variables were added to the collection variables/)
  })

  it('imports v4 sub-environments per workspace, including merged base values and secrets', async () => {
    const preview = await previewImport(JSON.stringify({
      _type: 'export',
      __export_format: 4,
      resources: [
        { _id: 'wrk_1', _type: 'workspace', parentId: null, name: 'One', description: '' },
        { _id: 'wrk_2', _type: 'workspace', parentId: null, name: 'Two', description: '' },
        { _id: 'env_base_1', _type: 'environment', parentId: 'wrk_1', name: 'Base One', data: { base_url: 'https://{{ _.host }}' } },
        { _id: 'env_dev_1', _type: 'environment', parentId: 'env_base_1', name: 'Dev', metaSortKey: 20, data: { api: { url: '{{ _.base_url }}/v1' } } },
        { _id: 'env_prod_1', _type: 'environment', parentId: 'env_base_1', name: 'Prod', metaSortKey: 10, isPrivate: true, data: { token: 'shh', nested: { enabled: true } } },
        { _id: 'req_1', _type: 'request', parentId: 'wrk_1', name: 'R1', method: 'GET', url: '{{ _.base_url }}/ping' },
        { _id: 'env_base_2', _type: 'environment', parentId: 'wrk_2', name: 'Base Two', kvPairData: [{ id: 'pair_1', name: 'region', value: 'us-east-1', type: 'str', enabled: true }] },
        { _id: 'env_qa_2', _type: 'environment', parentId: 'env_base_2', name: 'QA', kvPairData: [{ id: 'pair_2', name: 'secretToken', value: 'token-2', type: 'secret', enabled: true }] },
        { _id: 'req_2', _type: 'request', parentId: 'wrk_2', name: 'R2', method: 'GET', url: 'https://two.test' },
      ],
    }))

    expect(preview.collections.map((entry) => entry.collection.name)).toEqual(['One', 'Two'])
    expect(preview.collections[0].collection.variables).toEqual([{ key: 'base_url', value: 'https://{{host}}', isSecret: false }])
    expect(preview.collections[0].collection.environments).toEqual([
      {
        name: 'Base One',
        variables: [{ key: 'base_url', value: 'https://{{host}}', isSecret: false }],
      },
      {
        name: 'Prod',
        variables: [
          { key: 'base_url', value: 'https://{{host}}', isSecret: false },
          { key: 'token', value: 'shh', isSecret: true },
          { key: 'nested.enabled', value: 'true', isSecret: true },
        ],
      },
      {
        name: 'Dev',
        variables: [
          { key: 'base_url', value: 'https://{{host}}', isSecret: false },
          { key: 'api.url', value: '{{base_url}}/v1', isSecret: false },
        ],
      },
    ])
    expect(preview.collections[1].collection.variables).toEqual([{ key: 'region', value: 'us-east-1', isSecret: false }])
    expect(preview.collections[1].collection.environments).toEqual([
      {
        name: 'Base Two',
        variables: [{ key: 'region', value: 'us-east-1', isSecret: false }],
      },
      {
        name: 'QA',
        variables: [
          { key: 'region', value: 'us-east-1', isSecret: false },
          { key: 'secretToken', value: 'token-2', isSecret: true },
        ],
      },
    ])
    expect(preview.warnings.join('\n')).not.toMatch(/sub-environment/)
  })
})

describe('Insomnia bodies', () => {
  it('maps form, multipart, GraphQL and text bodies', async () => {
    const urlencoded = await importOne({ body: { mimeType: 'application/x-www-form-urlencoded', params: [{ name: 'a', value: 'b' }, { name: 'c', value: 'd', disabled: true }] } })
    expect(urlencoded.request.bodyType).toBe('x-www-form-urlencoded')
    expect(rows(JSON.parse(urlencoded.request.bodyContent)).map((p) => [p.key, p.enabled])).toEqual([['a', true], ['c', false]])

    const multipart = await importOne({ body: { mimeType: 'multipart/form-data', params: [{ name: 'f', type: 'file', fileName: '/tmp/a.txt' }, { name: 't', value: 'v' }] } })
    expect(multipart.request.bodyType).toBe('form-data')
    expect(rows(JSON.parse(multipart.request.bodyContent)).map((p) => [p.key, p.value, p.fieldType ?? 'text'])).toEqual([['f', '/tmp/a.txt', 'file'], ['t', 'v', 'text']])

    const gql = await importOne({ body: { mimeType: 'application/graphql', text: JSON.stringify({ query: '{ a }', variables: { id: 1 } }) } })
    expect(gql.request.bodyType).toBe('graphql')
    expect(JSON.parse(JSON.parse(gql.request.bodyContent).variables)).toEqual({ id: 1 })

    expect((await importOne({ body: { mimeType: 'application/xml', text: '<a/>' } })).request.bodyType).toBe('raw-xml')
    expect((await importOne({ body: { text: 'plain' } })).request.bodyType).toBe('raw-text')
    expect((await importOne({ body: {} })).request.bodyType).toBe('none')
  })

  it('keeps an unusual content type as a header and warns about binary files', async () => {
    const yaml = await importOne({ body: { mimeType: 'text/yaml', text: 'a: 1' } })
    expect(yaml.request.bodyType).toBe('raw-text')
    expect(rows(yaml.request.headers)).toEqual([expect.objectContaining({ key: 'Content-Type', value: 'text/yaml' })])
    const bin = await importOne({ body: { mimeType: 'application/octet-stream', fileName: '/a.bin' } })
    expect(bin.request.bodyType).toBe('binary')
    expect(bin.warnings.join()).toMatch(/binary body/)
  })
})

describe('Insomnia auth', () => {
  const authOf = async (authentication: object) => (await importOne({ authentication })).request.auth
  it('maps bearer, basic, API key, Digest, NTLM, AWS and OAuth 2.0', async () => {
    expect(await authOf({ type: 'bearer', token: 't' })).toEqual({ type: 'bearer', config: { token: 't' } })
    expect(await authOf({ type: 'basic', username: 'u', password: 'p' })).toEqual({ type: 'basic', config: { username: 'u', password: 'p' } })
    expect(await authOf({ type: 'apikey', key: 'k', value: 'v', addTo: 'queryParams' })).toEqual({ type: 'apikey', config: { key: 'k', value: 'v', in: 'query' } })
    expect(await authOf({ type: 'apikey', key: 'k', value: 'v', addTo: 'header' })).toMatchObject({ config: { in: 'header' } })
    expect(await authOf({ type: 'digest', username: 'u', password: 'p' })).toEqual({ type: 'digest', config: { username: 'u', password: 'p' } })
    expect((await authOf({ type: 'ntlm', username: 'u', password: 'p', domain: 'd' })).type).toBe('ntlm')
    expect(await authOf({ type: 'iam', accessKeyId: 'A', secretAccessKey: 'S', region: 'r', service: 's' })).toMatchObject({ type: 'awsv4', config: { accessKey: 'A', secretKey: 'S' } })
    expect(await authOf({ type: 'oauth2', grantType: 'client_credentials', clientId: 'id', clientSecret: 's', accessTokenUrl: 'https://t', scope: 'a b' })).toEqual({
      type: 'oauth2',
      config: { grantType: 'client_credentials', clientId: 'id', clientSecret: 's', authUrl: '', tokenUrl: 'https://t', scopes: 'a b', redirectUri: '' },
    })
  })

  it('inherits when empty, is none when disabled or none, and warns about unsupported types', async () => {
    expect((await authOf({})).type).toBe('inherit')
    expect((await authOf({ type: 'basic', disabled: true })).type).toBe('none')
    expect((await authOf({ type: 'none' })).type).toBe('none')
    const hawk = await importOne({ authentication: { type: 'hawk' } })
    expect(hawk.request.auth.type).toBe('none')
    expect(hawk.warnings.join()).toMatch(/"hawk" authentication is not supported/)
    const refresh = await importOne({ authentication: { type: 'oauth2', grantType: 'refresh_token' } })
    expect(refresh.warnings.join()).toMatch(/refresh_token/)
  })
})

describe('Insomnia v5 import', () => {
  it('imports a v5 collection with nested folders and base-environment variables', async () => {
    const preview = await previewImport(fixture('real-insomnia-v5-security.yaml'))
    expect(preview.format).toBe('insomnia')
    expect(preview.collections).toHaveLength(2)
    expect(preview.collections[0]).toMatchObject({ folders: 2, requests: 7 })
    const c = preview.collections[0].collection
    expect(c.requests[0].url).toBe('{{base_url}}/test/extra-data')
    expect(c.requests[0].auth.type).toBe('basic')
    expect(rows(c.requests[0].headers)[0]).toMatchObject({ key: 'x-inherited-value', value: '{{inherited_value}}' })
    expect(c.environments).toEqual([
      {
        name: 'Security Collection-level Env',
        variables: [{ key: 'inherited_value', value: 'from-collection-env', isSecret: false }],
      },
      {
        name: 'Shared Child Collection Env',
        variables: [{ key: 'inherited_value', value: 'from-shared-child-collection-env', isSecret: false }],
      },
      {
        name: 'Empty Env',
        variables: [{ key: 'inherited_value', value: 'from-collection-env', isSecret: false }],
      },
    ])
    expect(preview.collections[1]).toMatchObject({ collection: { name: 'Security & Testing (API spec)' } })
    expect(preview.collections[1].requests).toBeGreaterThan(2)
    expect(preview.warnings.join('\n')).toMatch(/Scripts were not imported for \d+ items/)
  })

  it('lets folder variables override broader environments and warns about the collision', async () => {
    const preview = await previewImport(fixture('real-insomnia-v5-variables.yaml'))
    const c = preview.collections[0].collection
    expect(c.folders[0].folders[0].requests[0].name).toBe('Child Request')
    expect(c.variables).toEqual([{ key: 'test-value', value: 'grandparent', isSecret: false }])
    expect(c.folders[0].folders[0].requests[0].headers).toEqual([expect.anything(), expect.objectContaining({ key: 'x-test-value', value: '{{test-value}}' })])
    expect(preview.warnings.join()).toMatch(/environment variable "test-value" overrides a broader environment value/)
    expect(preview.warnings.join()).toMatch(/environment variables were added to the collection variables/)
  })

  it('imports the OpenAPI definition of a design document that has no requests', async () => {
    const preview = await previewImport(fixture('real-insomnia-v5-design.yaml'))
    expect(preview.format).toBe('insomnia')
    expect(preview.collections[0].collection.name).toBe('My Design Document')
    expect(preview.collections[0].requests).toBeGreaterThan(10)
    expect(preview.warnings.join()).not.toMatch(/no requests/)
  })

  it('splits mixed v5 collection-plus-spec files into API and spec collections', async () => {
    const preview = await previewImport(minimalV5(`  - url: https://x.test/upload
    name: Upload
    meta:
      id: req_upload
    method: POST
    authentication:
      type: oauth2
      grantType: implicit
      authorizationUrl: https://auth.example.com/authorize
      accessTokenUrl: https://auth.example.com/token
      clientId: client-id
      clientSecret: client-secret
      scope: read
      redirectUrl: https://app.example.com/callback
    body:
      mimeType: multipart/form-data
      params:
        - name: file
          type: file
          fileName: /workspace/file.txt
        - name: note
          value: hi
spec:
  contents:
    openapi: 3.0.3
    info:
      title: Mixed Spec
      version: 1.0.0
    paths:
      /ping:
        get:
          responses:
            "200":
              description: ok
cookieJar:
  cookies:
    - key: sid
      value: cookie
testSuites:
  - tests:
      - name: one
environments:
  subEnvironments:
    - name: Dev
`))
    expect(preview.collections.map((c) => c.collection.name)).toEqual(['V5', 'V5 (API spec)'])
    const request = preview.collections[0].collection.requests[0]
    expect(request.auth).toEqual({
      type: 'oauth2',
      config: {
        grantType: 'implicit',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        authUrl: 'https://auth.example.com/authorize',
        tokenUrl: 'https://auth.example.com/token',
        scopes: 'read',
        redirectUri: 'https://app.example.com/callback',
      },
    })
    expect(request.bodyType).toBe('form-data')
    expect(rows(JSON.parse(request.bodyContent)).map((row) => [row.key, row.value, row.fieldType ?? 'text'])).toEqual([
      ['file', '/workspace/file.txt', 'file'],
      ['note', 'hi', 'text'],
    ])
    expect(preview.collections[0].collection.environments).toEqual([
      { name: 'Base Environment', variables: [] },
      { name: 'Dev', variables: [] },
    ])
    expect(preview.collections[1].requests).toBeGreaterThan(0)
    expect(preview.warnings.join('\n')).toMatch(/The cookie jar was not imported/)
    expect(preview.warnings.join('\n')).toMatch(/1 unit test was not imported/)
  })

  it('imports v5 sub-environments with nested and secret variables and warns only for unsupported templates left as text', async () => {
    const preview = await previewImport(minimalV5(`  - url: "{{ _.base_url }}/users"
    name: R
    meta:
      id: req_env_1
    method: GET
environments:
  name: Base
  meta:
    id: env_base
    isPrivate: false
  data:
    base_url: https://api.example.com
    token: base-token
  subEnvironments:
    - name: Dev
      meta:
        id: env_dev
        sortKey: 20
        isPrivate: false
      data:
        nested:
          url: "{{ _.base_url }}/v2"
        tags:
          - a
          - b
        leftAsText: "{% prompt 'name' %}"
    - name: Secret
      meta:
        id: env_secret
        sortKey: 10
        isPrivate: true
      data:
        token: "{{ _.token }}"
        region: us
`))
    const collection = preview.collections[0].collection
    expect(collection.variables).toEqual([
      { key: 'base_url', value: 'https://api.example.com', isSecret: false },
      { key: 'token', value: 'base-token', isSecret: false },
    ])
    expect(collection.environments).toEqual([
      {
        name: 'Base',
        variables: [
          { key: 'base_url', value: 'https://api.example.com', isSecret: false },
          { key: 'token', value: 'base-token', isSecret: false },
        ],
      },
      {
        name: 'Secret',
        variables: [
          { key: 'base_url', value: 'https://api.example.com', isSecret: false },
          { key: 'token', value: '{{token}}', isSecret: true },
          { key: 'region', value: 'us', isSecret: true },
        ],
      },
      {
        name: 'Dev',
        variables: [
          { key: 'base_url', value: 'https://api.example.com', isSecret: false },
          { key: 'token', value: 'base-token', isSecret: false },
          { key: 'nested.url', value: '{{base_url}}/v2', isSecret: false },
          { key: 'tags', value: '["a","b"]', isSecret: false },
          { key: 'leftAsText', value: "{% prompt 'name' %}", isSecret: false },
        ],
      },
    ])
    expect(preview.warnings.join('\n')).toMatch(/Environment "Dev": uses Insomnia template tags that were left as text/)
  })

  it('imports the base v5 environment even when there are no sub-environments', async () => {
    const preview = await previewImport(minimalV5(`  - url: https://x.test/ping
    name: Ping
    meta:
      id: req_ping
    method: GET
environments:
  name: Base
  meta:
    id: env_base_only
    isPrivate: false
  data:
    base_url: https://x.test
`))
    expect(preview.collections[0].collection.variables).toEqual([{ key: 'base_url', value: 'https://x.test', isSecret: false }])
    expect(preview.collections[0].collection.environments).toEqual([
      {
        name: 'Base',
        variables: [{ key: 'base_url', value: 'https://x.test', isSecret: false }],
      },
    ])
  })

  it('imports standalone v5 environment files', async () => {
    const preview = await previewImport(fixture('real-insomnia-v5-environment.yaml'))
    expect(preview).toMatchObject({
      format: 'insomnia-environment',
      collections: [],
      environments: [{
        name: 'Dev',
        variables: [
          { key: 'base_url', value: 'http://localhost:8000', isSecret: false },
          { key: 'auth_token', value: 'e1015e6d-039b-42dd-b038-31068702935d', isSecret: false },
          { key: 'inherited_value', value: 'from_global_env', isSecret: false },
        ],
      }],
    })
    expect(preview.warnings).toEqual([])
  })

  it('imports standalone v4 environment exports with empty, nested, and secret values', async () => {
    const preview = await previewImport(JSON.stringify({
      _type: 'export',
      __export_format: 4,
      resources: [
        {
          _id: 'env_base',
          _type: 'environment',
          parentId: null,
          name: 'Base',
          isPrivate: false,
          data: {
            base_url: 'https://x.test',
            nested: { auth: { user: 'alice' } },
          },
        },
        {
          _id: 'env_private',
          _type: 'environment',
          parentId: 'env_base',
          name: 'Private',
          isPrivate: true,
          data: {
            token: 'secret-token',
          },
        },
        {
          _id: 'env_empty',
          _type: 'environment',
          parentId: null,
          name: 'Empty',
          data: {},
        },
      ],
    }))

    expect(preview).toMatchObject({
      format: 'insomnia-environment',
      collections: [],
      environments: [
        {
          name: 'Base',
          variables: [
            { key: 'base_url', value: 'https://x.test', isSecret: false },
            { key: 'nested.auth.user', value: 'alice', isSecret: false },
          ],
        },
        {
          name: 'Private',
          variables: [{ key: 'token', value: 'secret-token', isSecret: true }],
        },
        {
          name: 'Empty',
          variables: [],
        },
      ],
    })
  })

  it('rejects v4 workspace imports with more than 5000 environments', async () => {
    await expect(previewImport(JSON.stringify({
      _type: 'export',
      __export_format: 4,
      resources: [
        { _id: 'wrk_1', _type: 'workspace', parentId: null, name: 'W', description: '' },
        { _id: 'env_base', _type: 'environment', parentId: 'wrk_1', name: 'Base', data: {} },
        ...Array.from({ length: 5000 }, (_, index) => ({
          _id: `env_${index + 1}`,
          _type: 'environment',
          parentId: 'env_base',
          name: `Env ${index + 1}`,
          data: {},
        })),
      ],
    }))).rejects.toThrow(/more than 5000 environments/i)
  })

  it('bounds standalone v4 environment nesting depth instead of recursing indefinitely', async () => {
    const resources: Array<Record<string, unknown>> = []
    let parentId: string | null = null
    for (let depth = 0; depth <= 65; depth += 1) {
      const id = `env_${depth}`
      resources.push({
        _id: id,
        _type: 'environment',
        parentId,
        name: `Env ${depth}`,
        data: {},
      })
      parentId = id
    }

    await expect(previewImport(JSON.stringify({
      _type: 'export',
      __export_format: 4,
      resources,
    }))).rejects.toThrow(/nested deeper than 64 levels/i)
  })

  it('counts kvPairData environment rows against the import budget', async () => {
    await expect(previewImport(JSON.stringify({
      _type: 'export',
      __export_format: 4,
      resources: [
        {
          _id: 'env_base',
          _type: 'environment',
          parentId: null,
          name: 'Base',
          kvPairData: Array.from({ length: 20001 }, (_, index) => ({
            id: `pair_${index + 1}`,
            name: `key_${index + 1}`,
            value: String(index + 1),
            type: 'str',
            enabled: true,
          })),
        },
      ],
    }))).rejects.toThrow(/more than 20000 requests and folders/i)
  })

  it('counts merged base environment rows against the import budget in v5 collections', async () => {
    await expect(previewImport(JSON.stringify({
      type: 'collection.insomnia.rest/5.0',
      schema_version: '5.1',
      name: 'Huge envs',
      meta: { id: 'wrk_huge' },
      collection: [],
      environments: {
        name: 'Base',
        meta: { id: 'env_base' },
        data: Object.fromEntries(Array.from({ length: 12000 }, (_, index) => [`base_${index + 1}`, `${index + 1}`])),
        subEnvironments: [
          {
            name: 'Merged',
            meta: { id: 'env_merged', sortKey: 1 },
            data: Object.fromEntries(Array.from({ length: 9001 }, (_, index) => [`child_${index + 1}`, `${index + 1}`])),
          },
        ],
      },
    }))).rejects.toThrow(/more than 20000 requests and folders/i)
  })

  it('explains other unsupported Insomnia file types', async () => {
    await expect(previewImport('type: mcpClient.insomnia/5.0\nname: x\n')).rejects.toThrow(/not supported/)
  })

  it('warns about protocols it cannot import', async () => {
    const preview = await previewImport(v4(request({}), { _id: 'ws_1', _type: 'websocket_request', parentId: 'wrk_1', name: 'Socket', url: 'wss://x' }, { _id: 'g_1', _type: 'grpc_request', parentId: 'wrk_1', name: 'Rpc' }))
    expect(preview.collections[0].requests).toBe(1)
    expect(preview.warnings.join('\n')).toMatch(/Socket.*WebSocket requests are not imported/)
  })

  it('warns when a mixed collection embeds a spec that is not valid OpenAPI', async () => {
    const preview = await previewImport(minimalV5(`  - url: https://x.test
    name: R
    meta:
      id: req_1
    method: GET
spec:
  contents:
    nope: true
`))
    expect(preview.collections).toHaveLength(1)
    expect(preview.warnings.join('\n')).toMatch(/embedded API spec was skipped/)
  })

  it('warns about v5 gRPC requests and empty workspaces', async () => {
    const preview = await previewImport(`
type: collection.insomnia.rest/5.0
schema_version: "5.1"
name: Empty
meta:
  id: wrk_empty
collection:
  - name: Rpc
    meta:
      id: grpc_1
    protoMethodName: Ping
    protoFileId: proto_1
`)
    expect(preview.collections[0].requests).toBe(0)
    expect(preview.warnings.join('\n')).toMatch(/"Rpc": gRPC requests are not imported/)
    expect(preview.warnings.join('\n')).toMatch(/The workspace has no requests/)
  })

  it('throws quickly on aliased YAML collection bombs', async () => {
    let yaml = 'lvl8: &lvl8\\n  url: https://x.test\\n  name: Leaf\\n  meta:\\n    id: req_leaf\\n  method: GET'
    for (let depth = 7; depth >= 0; depth -= 1) {
      const refs = Array.from({ length: 9 }, () => `*lvl${depth + 1}`).join(', ')
      yaml += `\\nlvl${depth}: &lvl${depth}\\n  name: Folder ${depth}\\n  meta:\\n    id: fld_${depth}\\n  children: [${refs}]`
    }
    const bomb = yaml.replace(/\\n/g, '\n') + `
type: collection.insomnia.rest/5.0
schema_version: "5.1"
name: Bomb
meta:
  id: wrk_bomb
collection:
  - *lvl0
`
    await expect(previewImport(bomb)).rejects.toThrow(/more than 20000 requests and folders/)
  })
})
