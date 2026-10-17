import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseRules } from '../../../shared/extract'
import type { ExportCollection, ExportFolder, ExportRequest } from '../../ipc/export-import'
import { convertBrunoYamlFiles, isBrunoYamlFolder } from '../import-bruno-yaml'

const FIX = path.join(__dirname, 'fixtures', 'bruno-yaml')
const rows = (v: string) => JSON.parse(v) as Array<{ key: string; value: string; enabled: boolean; fieldType?: string }>
type RequestTree = Pick<ExportCollection, 'requests' | 'folders'> | Pick<ExportFolder, 'requests' | 'folders'>
const allRequests = (collection: RequestTree): ExportRequest[] => [
  ...collection.requests,
  ...collection.folders.flatMap((folder) => allRequests(folder)),
]

function folder(name: string): Array<{ path: string; text: string }> {
  const walk = (dir: string): Array<{ path: string; text: string }> =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name)
      return entry.isDirectory()
        ? walk(full)
        : [{ path: `${name}/${path.relative(path.join(FIX, name), full).split(path.sep).join('/')}`, text: fs.readFileSync(full, 'utf-8') }]
    })
  return walk(path.join(FIX, name))
}

describe('Bruno YAML folder detection', () => {
  it('detects the OpenCollection root file and ignores .git/node_modules', () => {
    expect(isBrunoYamlFolder([{ path: 'c\\opencollection.yml', text: 'opencollection: 1.0.0' }])).toBe(true)
    expect(isBrunoYamlFolder([{ path: '.git/opencollection.yml', text: 'opencollection: 1.0.0' }])).toBe(false)
    expect(isBrunoYamlFolder([{ path: 'node_modules/opencollection.yml', text: 'opencollection: 1.0.0' }])).toBe(false)
  })
})

describe('Bruno YAML import', () => {
  it('imports the real runner fixture collection and warns about environments', () => {
    const [entry] = convertBrunoYamlFiles(folder('real-runner'))
    expect(entry.collection.name).toBe('Test OpenCollection')
    expect(entry.collection.requests.map((request) => request.name)).toEqual(['Get Users'])
    expect(entry.collection.folders[0].name).toBe('Users')
    expect(entry.collection.folders[0].requests[0]).toMatchObject({ name: 'Create User', method: 'POST', bodyType: 'raw-json' })
    expect(entry.warnings.join('\n')).toMatch(/1 environment was not imported \(dev\)/)
  })

  it('maps defaults, GraphQL, variables, actions, settings, and aggregate warnings', () => {
    const [entry] = convertBrunoYamlFiles(folder('spec-complex').map((file) => ({ ...file, path: file.path.replace('spec-complex/', 'picked/') })))
    const collection = entry.collection
    expect(collection.name).toBe('Spec Complex')
    expect(collection.description).toBe('Root summary')
    expect(collection.auth).toEqual({ type: 'bearer', config: { token: '{{token}}' } })
    expect(collection.network).toEqual({ followRedirects: false, maxRedirects: 4, timeout: 2000 })
    expect(collection.variables).toEqual(expect.arrayContaining([
      { key: 'token', value: 'root-token', isSecret: false },
      { key: 'folderVar', value: 'folder', isSecret: false },
      { key: 'requestVar', value: 'request-value', isSecret: false },
      { key: 'id', value: '42', isSecret: false },
    ]))

    const api = collection.folders[0]
    expect(api).toMatchObject({ name: 'API', description: 'Folder desc', auth: { type: 'apikey', config: { key: 'X-Key', value: '{{token}}', in: 'query' } }, network: { followRedirects: true } })
    expect(api.requests.map((request) => request.name)).toEqual(['Query Users', 'Login'])

    const graphql = api.requests[0]
    expect(graphql).toMatchObject({ bodyType: 'graphql', auth: { type: 'basic', config: { username: 'user', password: 'pass' } }, network: { timeout: 700 } })
    expect(JSON.parse(graphql.bodyContent)).toEqual({ query: 'query Users {\n  users { id }\n}\n', variables: '{"limit":1}' })
    expect(parseRules(graphql.protocolConfig.extractRules as string).map((rule) => rule.source)).toEqual(['status'])

    const login = api.requests[1]
    expect(login).toMatchObject({
      method: 'POST',
      url: 'https://api.example.com/users/{{id}}',
      bodyType: 'raw-json',
      network: { followRedirects: false, timeout: 1500 },
      auth: {
        type: 'oauth2',
        config: {
          grantType: 'password',
          clientId: 'client',
          clientSecret: 'secret',
          authUrl: '',
          tokenUrl: 'https://auth.example.com/token',
          scopes: 'read write',
          redirectUri: '',
        },
      },
    })
    expect(rows(JSON.stringify(login.params)).map((param) => [param.key, param.value, param.enabled])).toEqual([
      ['q', 'search', true],
      ['extra', 'x', false],
    ])
    expect(rows(JSON.stringify(login.headers)).map((header) => [header.key, header.enabled])).toEqual([
      ['Content-Type', true],
      ['X-Off', false],
    ])
    expect(parseRules(login.protocolConfig.extractRules as string).map((rule) => [rule.source, rule.expression, rule.variable])).toEqual([
      ['json', '$.token', 'savedToken'],
    ])

    expect(entry.warnings.join('\n')).toMatch(/Scripts were not imported/)
    expect(entry.warnings.join('\n')).toMatch(/Tests and assertions were not imported/)
    expect(entry.warnings.join('\n')).toMatch(/Documentation blocks were not imported/)
    expect(entry.warnings.join('\n')).toMatch(/Inherited headers were not imported/)
    expect(entry.warnings.join('\n')).toMatch(/Collection or folder post-response actions were not imported/)
    expect(entry.warnings.join('\n')).toMatch(/Actions other than after-response variable setters were not imported/)
    expect(entry.warnings.join('\n')).toMatch(/Only HTTP and GraphQL requests were imported; 2 requests were skipped \(Rpc, Socket\)/)
    expect(entry.warnings.join('\n')).toMatch(/2 folder variables and 1 request variable were imported as collection variables; first value won when names collided/)
    expect(entry.warnings.join('\n')).toMatch(/OAuth 2.0 settings were not imported: refresh token URL, credentials placement \/ saved credentials, token placement \/ saved token source, password grant username \/ password\./)
    expect(entry.warnings.join('\n')).toMatch(/Bruno request settings were not imported: encodeUrl, forwardAuthorizationHeader\./)
    expect(entry.warnings.join('\n')).toMatch(/Unknown OpenCollection keys were ignored: .*api\/folder.yml \(unknownFolder\).*api\/login.yml \(mystery\).*opencollection.yml \(mystery\)/)
    expect(entry.warnings.join('\n')).toMatch(/"api\/bad.yml": could not read YAML/)
  })

  it('maps auth modes and body variants, including Windows paths', () => {
    const entry = convertBrunoYamlFiles([
      { path: 'c\\opencollection.yml', text: 'opencollection: "1.0.0"\ninfo:\n  name: C\n' },
      { path: 'c/basic.yml', text: `info:\n  name: Basic\n  type: http\nhttp:\n  method: GET\n  url: https://x.test\n  auth:\n    type: basic\n    username: u\n    password: p\n` },
      { path: 'c/bearer.yml', text: `info:\n  name: Bearer\n  type: http\nhttp:\n  method: GET\n  url: https://x.test\n  auth:\n    type: bearer\n    token: t\n` },
      { path: 'c/digest.yml', text: `info:\n  name: Digest\n  type: http\nhttp:\n  method: GET\n  url: https://x.test\n  auth:\n    type: digest\n    username: u\n    password: p\n` },
      { path: 'c/ntlm.yml', text: `info:\n  name: Ntlm\n  type: http\nhttp:\n  method: GET\n  url: https://x.test\n  auth:\n    type: ntlm\n    username: u\n    password: p\n    domain: d\n` },
      { path: 'c/apikey.yml', text: `info:\n  name: Key\n  type: http\nhttp:\n  method: GET\n  url: https://x.test\n  auth:\n    type: apikey\n    key: X-Key\n    value: v\n    placement: header\n` },
      { path: 'c/aws.yml', text: `info:\n  name: Aws\n  type: http\nhttp:\n  method: GET\n  url: https://x.test\n  auth:\n    type: awsv4\n    accessKeyId: A\n    secretAccessKey: S\n    sessionToken: T\n    region: eu\n    service: execute-api\n` },
      { path: 'c/inherit.yml', text: `info:\n  name: Inherit\n  type: http\nhttp:\n  method: GET\n  url: https://x.test\n  auth: inherit\n` },
      { path: 'c/none.yml', text: `info:\n  name: None\n  type: http\nhttp:\n  method: GET\n  url: https://x.test\n  auth:\n    type: none\n` },
      { path: 'c/multipart.yml', text: `info:\n  name: Multipart\n  type: http\nhttp:\n  method: POST\n  url: https://x.test\n  body:\n    type: multipart-form\n    data:\n      - name: file\n        type: file\n        value:\n          - a.txt\n          - b.txt\n        contentType: text/plain\n      - name: title\n        type: text\n        value: hi\n` },
      { path: 'c/file.yml', text: `info:\n  name: File\n  type: http\nhttp:\n  method: POST\n  url: https://x.test\n  body:\n    type: file\n    data:\n      - filePath: a.bin\n        contentType: application/octet-stream\n        selected: true\n` },
      { path: 'c/form.yml', text: `info:\n  name: Form\n  type: http\nhttp:\n  method: POST\n  url: https://x.test\n  body:\n    type: form-urlencoded\n    data:\n      - name: a\n        value: 1\n      - name: b\n        value: 2\n        disabled: true\n` },
    ])[0]
    const authByName = Object.fromEntries(entry.collection.requests.map((request) => [request.name, request.auth]))
    expect(authByName.Basic).toEqual({ type: 'basic', config: { username: 'u', password: 'p' } })
    expect(authByName.Bearer).toEqual({ type: 'bearer', config: { token: 't' } })
    expect(authByName.Digest).toEqual({ type: 'digest', config: { username: 'u', password: 'p' } })
    expect(authByName.Ntlm).toEqual({ type: 'ntlm', config: { username: 'u', password: 'p', domain: 'd', workstation: '' } })
    expect(authByName.Key).toEqual({ type: 'apikey', config: { key: 'X-Key', value: 'v', in: 'header' } })
    expect(authByName.Aws).toEqual({ type: 'awsv4', config: { accessKey: 'A', secretKey: 'S', sessionToken: 'T', region: 'eu', service: 'execute-api' } })
    expect(authByName.Inherit).toEqual({ type: 'inherit', config: {} })
    expect(authByName.None).toEqual({ type: 'none', config: {} })

    const multipart = entry.collection.requests.find((request) => request.name === 'Multipart')
    expect(multipart?.bodyType).toBe('form-data')
    expect(rows(multipart?.bodyContent ?? '').map((row) => [row.key, row.value, row.fieldType ?? 'text'])).toEqual([
      ['file', 'a.txt', 'file'],
      ['file', 'b.txt', 'file'],
      ['title', 'hi', 'text'],
    ])
    expect(entry.collection.requests.find((request) => request.name === 'File')?.bodyType).toBe('binary')
    expect(rows(entry.collection.requests.find((request) => request.name === 'Form')?.bodyContent ?? '').map((row) => [row.key, row.enabled])).toEqual([
      ['a', true],
      ['b', false],
    ])
    expect(entry.warnings.join('\n')).toMatch(/Multipart part content types were not imported/)
    expect(entry.warnings.join('\n')).toMatch(/binary body was not imported/)
  })

  it('covers remaining auth flows, body modes, selected variants, and aggregated warnings', () => {
    const [entry] = convertBrunoYamlFiles([
      {
        path: 'picked/root/opencollection.yml',
        text: `opencollection: "1.0.0"
info:
  name: Edge Cases
request:
  variables:
    - name: pickedValue
      value:
        - value: old
        - value: chosen
          selected: true
    - name: vaultSecret
      secretName: api-token
    - name: ignored
      value: never
      disabled: true
  settings:
    http:
      followRedirects: "false"
      maxRedirects: "5"
      timeout: "900"
    graphql:
      followRedirects: nope
      maxRedirects: -1
      timeout: 0
      omitHeaders: strip
`,
      },
      {
        path: 'picked/root/folder.yml',
        text: `info:
  name: Top Folder
request:
  auth: inherit
  variables:
    - name: folderVar
      value: folder-value
    - name: dynamicVar
      value: "{{ $customEdge }}"
  settings:
    http:
      followRedirects: true
docs:
  content: folder docs
`,
      },
      {
        path: 'picked/root/folder/unsupported-flow.yml',
        text: `info:
  name: Unsupported Flow
  type: http
http:
  method: GET
  url: https://edge.example.com/unsupported
  auth:
    type: oauth2
    flow: device_code
`,
      },
      {
        path: 'picked/root/folder/auth-code.yml',
        text: `info:
  name: Auth Code
  type: http
http:
  method: POST
  url: https://edge.example.com/code
  auth:
    type: oauth2
    flow: authorization_code
    authorizationUrl: https://auth.example.com/authorize
    accessTokenUrl: https://auth.example.com/token
    callbackUrl: postly://callback
    scope: read profile
    state: abc
    credentials:
      clientId: web
      clientSecret: secret
`,
      },
      {
        path: 'picked/root/folder/client-credentials.yml',
        text: `info:
  name: Client Credentials
  type: http
http:
  method: GET
  url: https://edge.example.com/client
  auth:
    type: oauth2
    flow: client_credentials
    accessTokenUrl: https://auth.example.com/token
    credentials:
      clientId: service
      clientSecret: service-secret
`,
      },
      {
        path: 'picked/root/folder/implicit.yml',
        text: `info:
  name: Implicit
  type: http
http:
  method: GET
  url: https://edge.example.com/implicit
  auth:
    type: oauth2
    flow: implicit
    authorizationUrl: https://auth.example.com/authorize
    callbackUrl: postly://implicit
    credentials:
      clientId: native
`,
      },
      {
        path: 'picked/root/folder/hawk.yml',
        text: `info:
  name: Hawk
  type: http
http:
  method: GET
  url: https://edge.example.com/hawk
  auth:
    type: hawk
`,
      },
      {
        path: 'picked/root/folder/text.yml',
        text: `info:
  name: Text Selected
  type: http
http:
  method: POST
  url: https://edge.example.com/text
  body:
    - body:
        type: text
        data: old
    - selected: true
      body:
        type: text
        data: chosen
`,
      },
      {
        path: 'picked/root/folder/xml.yml',
        text: `info:
  name: XML Body
  type: http
http:
  method: POST
  url: https://edge.example.com/xml
  body:
    type: xml
    data: "<root />"
`,
      },
      {
        path: 'picked/root/folder/sparql.yml',
        text: `info:
  name: Sparql Body
  type: http
http:
  method: POST
  url: https://edge.example.com/sparql
  body:
    type: sparql
    data: "SELECT * WHERE { ?s ?p ?o }"
`,
      },
      {
        path: 'picked/root/folder/none.yml',
        text: `info:
  name: No Body
  type: http
http:
  method: POST
  url: https://edge.example.com/none
  body:
    type: none
`,
      },
      {
        path: 'picked/root/folder/multipart.yml',
        text: `info:
  name: Multipart Missing
  type: http
http:
  method: POST
  url: https://edge.example.com/multipart
  body:
    type: multipart-form
    data:
      - name: upload
        type: file
        contentType: text/plain
      - name: title
        type: text
        value: hello
`,
      },
      {
        path: 'picked/root/folder/graphql.yml',
        text: `info:
  name: GraphQL Object Vars
  type: graphql
graphql:
  url: https://edge.example.com/graphql
  body:
    query: query Users { users { id } }
    variables:
      limit: 1
runtime:
  actions:
    - type: set-variable
      selector:
        expression: res.status
      variable:
        name: statusCode
    - type: set-variable
      selector:
        expression: res.headers["x-trace"]
      variable:
        name: trace
    - type: set-variable
      selector:
        expression: res.headers.bad.path
      variable:
        name: badHeader
`,
      },
      {
        path: 'picked/root/folder/not-an-object.yml',
        text: '- just\n- a list\n',
      },
      {
        path: 'picked/root/environments/prod.yml',
        text: 'vars:\n  token: prod\n',
      },
    ])

    expect(entry.collection.name).toBe('Edge Cases')
    expect(entry.collection.network).toEqual({ followRedirects: false, maxRedirects: 5, timeout: 900 })
    expect(entry.collection.variables).toEqual(expect.arrayContaining([
      { key: 'pickedValue', value: 'chosen', isSecret: false },
      { key: 'vaultSecret', value: '', isSecret: true },
      { key: 'folderVar', value: 'folder-value', isSecret: false },
      { key: 'dynamicVar', value: '{{ $customEdge }}', isSecret: false },
    ]))

    const requests = new Map(allRequests(entry.collection).map((request) => [request.name, request] as const))
    expect(requests.get('Auth Code')).toMatchObject({
      method: 'POST',
      auth: {
        type: 'oauth2',
        config: {
          grantType: 'authorization_code',
          clientId: 'web',
          clientSecret: 'secret',
          authUrl: 'https://auth.example.com/authorize',
          tokenUrl: 'https://auth.example.com/token',
          scopes: 'read profile',
          redirectUri: 'postly://callback',
        },
      },
    })
    expect(requests.get('Client Credentials')).toMatchObject({
      auth: {
        type: 'oauth2',
        config: {
          grantType: 'client_credentials',
          clientId: 'service',
          clientSecret: 'service-secret',
          authUrl: '',
          tokenUrl: 'https://auth.example.com/token',
          scopes: '',
          redirectUri: '',
        },
      },
    })
    expect(requests.get('Implicit')).toMatchObject({
      auth: {
        type: 'oauth2',
        config: {
          grantType: 'implicit',
          clientId: 'native',
          clientSecret: '',
          authUrl: 'https://auth.example.com/authorize',
          tokenUrl: '',
          scopes: '',
          redirectUri: 'postly://implicit',
        },
      },
    })
    expect(requests.get('Unsupported Flow')).toMatchObject({ auth: { type: 'none', config: {} } })
    expect(requests.get('Hawk')).toMatchObject({ auth: { type: 'none', config: {} } })
    expect(requests.get('Text Selected')).toMatchObject({ bodyType: 'raw-text', bodyContent: 'chosen' })
    expect(requests.get('XML Body')).toMatchObject({ bodyType: 'raw-xml', bodyContent: '<root />' })
    expect(requests.get('Sparql Body')).toMatchObject({ bodyType: 'raw-text', bodyContent: 'SELECT * WHERE { ?s ?p ?o }' })
    expect(requests.get('No Body')).toMatchObject({ bodyType: 'none', bodyContent: '' })
    expect(requests.get('Multipart Missing')).toMatchObject({ bodyType: 'form-data' })
    expect(rows(requests.get('Multipart Missing')?.bodyContent as string).map((row) => [row.key, row.value, row.fieldType ?? 'text'])).toEqual([
      ['title', 'hello', 'text'],
    ])
    expect(requests.get('GraphQL Object Vars')).toMatchObject({ bodyType: 'graphql' })
    expect(JSON.parse(requests.get('GraphQL Object Vars')?.bodyContent as string)).toEqual({
      query: 'query Users { users { id } }',
      variables: '{"limit":1}',
    })
    expect(parseRules(requests.get('GraphQL Object Vars')?.protocolConfig.extractRules as string).map((rule) => [rule.source, rule.expression, rule.variable])).toEqual([
      ['status', '', 'statusCode'],
      ['header', 'x-trace', 'trace'],
    ])
    expect(entry.warnings.join('\n')).toMatch(/"Unsupported Flow": OAuth 2.0 grant type "device_code" is not supported/)
    expect(entry.warnings.join('\n')).toMatch(/"Hawk": "hawk" authentication is not supported/)
    expect(entry.warnings.join('\n')).toMatch(/"Multipart Missing": one or more multipart file fields were not imported/)
    expect(entry.warnings.join('\n')).toMatch(/"GraphQL Object Vars": 1 post-response action could not be converted \(badHeader\)\./)
    expect(entry.warnings.join('\n')).toMatch(/1 environment was not imported \(prod\)/)
    expect(entry.warnings.join('\n')).toMatch(/2 folder variables were imported as collection variables/)
    expect(entry.warnings.join('\n')).toMatch(/Dynamic variables Postly does not provide are used and will stay unresolved: \{\{\$customEdge\}\}\./)
    expect(entry.warnings.join('\n')).toMatch(/OAuth 2.0 settings were not imported: state\./)
    expect(entry.warnings.join('\n')).toMatch(/Bruno request settings were not imported: followRedirects \(invalid values\), maxRedirects \(invalid values\), omitHeaders, timeout \(non-positive or out-of-range values\)\./)
    expect(entry.warnings.join('\n')).toMatch(/"folder\/not-an-object.yml": expected a YAML object\./)
    expect(entry.warnings.join('\n')).toMatch(/Documentation blocks were not imported/)
  })

  it('splits nested roots and keeps files with the closest root', () => {
    const entries = convertBrunoYamlFiles([
      { path: 'picked/root/opencollection.yml', text: 'opencollection: "1.0.0"\ninfo:\n  name: Root\n' },
      { path: 'picked/root/root.yml', text: 'info:\n  name: Root Request\n  type: http\nhttp:\n  method: GET\n  url: https://root.test\n' },
      { path: 'picked/root/nested/opencollection.yml', text: 'opencollection: "1.0.0"\ninfo:\n  name: Nested\n' },
      { path: 'picked/root/nested/child.yml', text: 'info:\n  name: Nested Request\n  type: http\nhttp:\n  method: GET\n  url: https://nested.test\n' },
      { path: 'picked/root/nested/deeper/grandchild.yml', text: 'info:\n  name: Deep Request\n  type: http\nhttp:\n  method: GET\n  url: https://deep.test\n' },
    ])

    expect(entries).toHaveLength(2)
    const byName = new Map(entries.map((entry) => [entry.collection.name, entry.collection] as const))
    expect(allRequests(byName.get('Root') as ExportCollection).map((request) => request.name)).toEqual(['Root Request'])
    expect(allRequests(byName.get('Nested') as ExportCollection).map((request) => request.name)).toEqual(['Nested Request', 'Deep Request'])
  })

  it('covers fallback variants, inferred request types, and inherited settings', () => {
    const [entry] = convertBrunoYamlFiles([
      {
        path: 'picked/root/opencollection.yml',
        text: `opencollection: "1.0.0"
info:
  summary: Summary only
request:
  auth:
    type: none
  variables:
    - name: boolVar
      value: true
    - name: numVar
      value: 7
    - name: firstVariant
      value:
        - value: first
    - name: dataVariant
      value:
        data: embedded
  settings:
    http: inherit
    graphql:
      followRedirects: true
      maxRedirects: 3
      timeout: 600
`,
      },
      {
        path: 'picked/root/folder.yml',
        text: `info:
  name: Folder
request:
  auth: inherit
  settings:
    http: inherit
docs:
  content: folder docs
`,
      },
      {
        path: 'picked/root/http-default.yml',
        text: `http:
  url: https://edge.example.com/users/{user-id}?inline=1
  params:
    - name: user-id
      type: path
      value: "12"
    - name: q
      value: ok
      disabled: true
  body:
    - body:
        type: json
        json: '{"picked":true}'
    - body:
        type: text
        data: ignored
runtime:
  actions:
    - type: open-url
      phase: after-response
`,
      },
      {
        path: 'picked/root/graphql-default.yml',
        text: `graphql:
  url: https://edge.example.com/graphql
  body:
    query: query Ping { ping }
    variables:
      limit: 1
runtime:
  scripts:
    - type: tests
      code: expect(true).toBe(true)
`,
      },
      {
        path: 'picked/root/socket.yml',
        text: `websocket:
  url: wss://edge.example.com/socket
`,
      },
    ])

    expect(entry.collection.name).toBe('root')
    expect(entry.collection.description).toBe('Summary only')
    expect(entry.collection.auth).toEqual({ type: 'none', config: {} })
    expect(entry.collection.network).toEqual({ followRedirects: true, maxRedirects: 3, timeout: 600 })
    expect(entry.collection.variables).toEqual(expect.arrayContaining([
      { key: 'boolVar', value: 'true', isSecret: false },
      { key: 'numVar', value: '7', isSecret: false },
      { key: 'firstVariant', value: 'first', isSecret: false },
      { key: 'dataVariant', value: 'embedded', isSecret: false },
    ]))

    const requests = new Map(allRequests(entry.collection).map((request) => [request.name, request] as const))
    expect(requests.get('http-default')).toMatchObject({
      method: 'GET',
      url: 'https://edge.example.com/users/{user-id}',
      bodyType: 'raw-json',
      auth: { type: 'inherit', config: {} },
    })
    expect(JSON.parse(requests.get('http-default')?.bodyContent as string)).toEqual({ picked: true })
    expect(rows(JSON.stringify(requests.get('http-default')?.params)).map((param) => [param.key, param.value, param.enabled])).toEqual([
      ['q', 'ok', false],
    ])
    expect(requests.get('graphql-default')).toMatchObject({
      method: 'POST',
      bodyType: 'graphql',
    })
    expect(JSON.parse(requests.get('graphql-default')?.bodyContent as string)).toEqual({
      query: 'query Ping { ping }',
      variables: '{"limit":1}',
    })

    expect(entry.warnings.join('\n')).toMatch(/Documentation blocks were not imported for 1 item \(Folder "Folder"\)\./)
    expect(entry.warnings.join('\n')).toMatch(/Scripts were not imported for 1 item \("graphql-default"\)\./)
    expect(entry.warnings.join('\n')).toMatch(/Actions other than after-response variable setters were not imported for 1 request \("http-default" \(1\)\)\./)
    expect(entry.warnings.join('\n')).toMatch(/Only HTTP and GraphQL requests were imported; 1 request was skipped \(socket\)\./)
  })

  it('covers secret markers, selected variants, oauth drops, and malformed folder defaults', () => {
    const [entry] = convertBrunoYamlFiles([
      {
        path: 'picked/root/opencollection.yml',
        text: `opencollection: "1.0.0"
request:
  headers:
    - name: X-Root
      value: "1"
  variables:
    - name: pathSecret
      path: /secret/path
    - name: vaultSecret
      vaultName: main
    - name: projectSecret
      projectId: project-1
    - name: duplicate
      value: root
  actions:
    - type: set-variable
      selector:
        expression: res.status
      variable:
        name: rootStatus
  scripts:
    - type: before-request
      code: console.log(1)
  auth: inherit
`,
      },
      {
        path: 'picked/root/folder.yml',
        text: '- malformed\n',
      },
      {
        path: 'picked/root/oauth.yml',
        text: `info:
  name: OAuth Request
  type: http
http:
  method: POST
  url: https://edge.example.com/oauth
  auth:
    type: oauth2
    flow: resource_owner_password_credentials
    authorizationUrl: https://auth.example.com/authorize
    accessTokenUrl: https://auth.example.com/token
    callbackUrl: postly://callback
    scope: read
    pkce:
      disabled: false
      method: S256
    credentials:
      clientId: cli
      clientSecret: sec
      placement: header
      id: cred-1
    tokenConfig:
      id: tok-1
      placement:
        in: header
      source: cache
    settings:
      autoFetchToken: true
      autoRefreshToken: true
    resourceOwner:
      username: demo
      password: pass
    additionalParameters:
      authorizationRequest:
        - name: audience
          value: api
      refreshTokenRequest:
        - name: refresh
          value: "1"
  body:
    type: multipartForm
    multipartForm:
      - name: file
        type: file
        value: one.txt
      - name: missing
        type: file
        value: []
      - name: note
        value: hi
  settings:
    followRedirects: inherit
    maxRedirects: inherit
    timeout: inherit
    omitHeaders: inherit
    customFlag: true
runtime:
  variables:
    - name: duplicate
      value: request
    - name: runtimeSecret
      secretName: api-token
  scripts:
    - type: after-response
      code: console.log(1)
  assertions:
    - type: status
  actions:
    - type: set-variable
      selector:
        expression: res.body.items[0]
      variable:
        name: firstItem
    - type: set-variable
      phase: before-request
      selector:
        expression: res.status
      variable:
        name: skipped
`,
      },
      {
        path: 'picked/root/graphql-picked.yml',
        text: `info:
  name: GraphQL Picked
  type: graphql
graphql:
  url: https://edge.example.com/graphql
  body:
    - body:
        query: query Old { old }
        variables: old
    - selected: true
      body:
        query: query New { new }
        variables:
          ok: true
`,
      },
    ])

    expect(entry.collection.auth).toEqual({ type: 'none', config: {} })
    expect(entry.collection.variables).toEqual(expect.arrayContaining([
      { key: 'pathSecret', value: '', isSecret: true },
      { key: 'vaultSecret', value: '', isSecret: true },
      { key: 'projectSecret', value: '', isSecret: true },
      { key: 'duplicate', value: 'root', isSecret: false },
      { key: 'runtimeSecret', value: '', isSecret: true },
    ]))

    const requests = new Map(allRequests(entry.collection).map((request) => [request.name, request] as const))
    expect(requests.get('OAuth Request')).toMatchObject({
      bodyType: 'form-data',
      auth: {
        type: 'oauth2',
        config: {
          grantType: 'password',
          clientId: 'cli',
          clientSecret: 'sec',
          authUrl: 'https://auth.example.com/authorize',
          tokenUrl: 'https://auth.example.com/token',
          scopes: 'read',
          redirectUri: 'postly://callback',
        },
      },
    })
    expect(rows(requests.get('OAuth Request')?.bodyContent as string).map((row) => [row.key, row.value, row.fieldType ?? 'text'])).toEqual([
      ['file', 'one.txt', 'file'],
      ['note', 'hi', 'text'],
    ])
    expect(parseRules(requests.get('OAuth Request')?.protocolConfig.extractRules as string).map((rule) => [rule.source, rule.expression, rule.variable])).toEqual([
      ['json', '$.items[0]', 'firstItem'],
    ])
    expect(JSON.parse(requests.get('GraphQL Picked')?.bodyContent as string)).toEqual({
      query: 'query New { new }',
      variables: '{"ok":true}',
    })

    expect(entry.warnings.join('\n')).toMatch(/"folder\.yml": expected a YAML object\./)
    expect(entry.warnings.join('\n')).toMatch(/Inherited headers were not imported for 1 item \(Collection\)/)
    expect(entry.warnings.join('\n')).toMatch(/Collection or folder post-response actions were not imported for 1 item \(Collection\)/)
    expect(entry.warnings.join('\n')).toMatch(/Scripts were not imported for 2 items \(Collection, "OAuth Request"\)\./)
    expect(entry.warnings.join('\n')).toMatch(/Tests and assertions were not imported for 1 request\./)
    expect(entry.warnings.join('\n')).toMatch(/1 request variable were imported as collection variables; first value won when names collided\./)
    expect(entry.warnings.join('\n')).toMatch(/one or more multipart file fields were not imported/)
    expect(entry.warnings.join('\n')).toMatch(/OAuth 2\.0 settings were not imported: PKCE, credentials placement \/ saved credentials, token placement \/ saved token source, automatic token fetch \/ refresh, additional auth\/token\/refresh parameters, password grant username \/ password\./)
    expect(entry.warnings.join('\n')).toMatch(/Actions other than after-response variable setters were not imported for 1 request \("OAuth Request" \(1\)\)\./)
    expect(entry.warnings.join('\n')).toMatch(/Unknown OpenCollection keys were ignored: oauth\.yml \(http\.settings\)\./)
  })

  it('returns nothing without a root file and falls back when the root YAML is not an object', () => {
    expect(convertBrunoYamlFiles([
      { path: 'picked/request.yml', text: 'info:\n  name: Loose\n  type: http\nhttp:\n  method: GET\n  url: https://x.test\n' },
    ])).toEqual([])

    const [entry] = convertBrunoYamlFiles([
      { path: 'picked/root/opencollection.yml', text: '- root\n- list\n' },
      { path: 'picked/root/sub/request.yml', text: 'info:\n  name: Nested\n  type: http\nhttp:\n  method: GET\n  url: https://nested.test\n' },
      { path: 'picked/root/environments/dev.yml', text: 'vars:\n  token: dev\n' },
      { path: 'picked/root/readme.txt', text: 'ignored\n' },
    ])

    expect(entry.collection.name).toBe('root')
    expect(entry.collection.requests).toEqual([])
    expect(entry.collection.folders[0].name).toBe('sub')
    expect(entry.collection.folders[0].requests[0]).toMatchObject({ name: 'Nested', url: 'https://nested.test' })
    expect(entry.warnings.join('\n')).toMatch(/1 environment was not imported \(dev\)/)
  })

  it('applies the import budget to deeply nested trees', () => {
    const deep = Array.from({ length: 66 }, (_, index) => `f${index}`).join('/')
    expect(() => convertBrunoYamlFiles([
      { path: 'c/opencollection.yml', text: 'opencollection: "1.0.0"\ninfo:\n  name: Budget\n' },
      { path: `c/${deep}/request.yml`, text: 'info:\n  name: R\n  type: http\nhttp:\n  method: GET\n  url: https://x.test\n' },
    ])).toThrow(/nested deeper than 64 levels/)
  })

  it('fails when the request count exceeds the import node limit', () => {
    const files = [
      { path: 'c/opencollection.yml', text: 'opencollection: "1.0.0"\ninfo:\n  name: Too Many\n' },
      ...Array.from({ length: 20_001 }, (_, index) => ({
        path: `c/r-${index}.yml`,
        text: `info:\n  name: R${index}\n  type: http\nhttp:\n  method: GET\n  url: https://limit.test/${index}\n`,
      })),
    ]
    expect(() => convertBrunoYamlFiles(files)).toThrow(/more than 20000 requests and folders/i)
  })
})
