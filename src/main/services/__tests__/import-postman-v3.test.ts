import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseRules } from '../../../shared/extract'
import type { ExportCollection, ExportFolder, ExportRequest } from '../../ipc/export-import'
import { convertPostmanV3Files, isPostmanV3Folder } from '../import-postman-v3'

const FIX = path.join(__dirname, 'fixtures', 'postman-v3')
const rows = (text: string) => JSON.parse(text) as Array<{ key: string; value: string; enabled: boolean; fieldType?: string }>
type RequestTree = Pick<ExportCollection, 'requests' | 'folders'> | Pick<ExportFolder, 'requests' | 'folders'>
const allRequests = (collection: RequestTree): ExportRequest[] => [
  ...collection.requests,
  ...collection.folders.flatMap((folder) => allRequests(folder)),
]

function folder(name: string): Array<{ path: string; text: string }> {
  const root = path.join(FIX, name)
  const walk = (dir: string): Array<{ path: string; text: string }> =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const next = path.join(dir, entry.name)
      return entry.isDirectory()
        ? walk(next)
        : [{ path: path.relative(root, next).split(path.sep).join('/'), text: fs.readFileSync(next, 'utf-8') }]
    })
  return walk(root)
}

describe('Postman v3 folder detection', () => {
  it('detects a Native Git workspace and a single-file collection', () => {
    expect(isPostmanV3Folder(folder('workspace'))).toBe(true)
    expect(isPostmanV3Folder([{ path: 'collection.yaml', text: fs.readFileSync(path.join(FIX, 'single-file.yaml'), 'utf-8') }])).toBe(true)
    expect(isPostmanV3Folder([{ path: 'readme.md', text: '# nope' }])).toBe(false)
  })
})

describe('convertPostmanV3Files', () => {
  it('imports a Native Git workspace collection and aggregates warnings', () => {
    const [entry] = convertPostmanV3Files(folder('workspace').map((file) => ({ ...file, path: file.path.replace(/\//g, '\\') })))
    expect(entry.collection.name).toBe('Native Git Sample')
    expect(entry.collection.auth).toEqual({ type: 'bearer', config: { token: '{{secretToken}}' } })
    expect(entry.collection.variables).toEqual(expect.arrayContaining([
      { key: 'baseUrl', value: 'https://api.example.com', isSecret: false },
      { key: 'secretToken', value: '', isSecret: true },
      { key: 'folderOnly', value: 'from-folder', isSecret: false },
      { key: 'id', value: '42', isSecret: false },
    ]))

    const create = entry.collection.requests.find((request) => request.name === 'Create user')
    expect(create).toBeTruthy()
    expect(create?.url).toBe('{{baseUrl}}/users/{{id}}')
    expect(rows(create?.params ? JSON.stringify(create.params) : '[]').map((row) => [row.key, row.value, row.enabled])).toEqual([
      ['draft', '1', true],
      ['verbose', '0', false],
    ])
    expect(create?.auth).toEqual({ type: 'apikey', config: { key: 'X-Api-Key', value: 'abc123', in: 'query' } })
    expect(create?.ssl).toBe('disabled')
    expect(create?.network).toEqual({ followRedirects: false, maxRedirects: 2 })
    expect(create?.bodyType).toBe('raw-json')
    expect(parseRules(create?.protocolConfig.extractRules as string)).toHaveLength(1)

    const users = entry.collection.folders[0]
    expect(users.name).toBe('Users')
    expect(users.auth.type).toBe('none')
    expect(users.requests.find((request) => request.name === 'Search users')?.bodyType).toBe('graphql')

    expect(entry.warnings.join('\n')).toMatch(/collection script scope/i)
    expect(entry.warnings.join('\n')).toMatch(/folder script scope/i)
    expect(entry.warnings.join('\n')).toMatch(/3 saved response example/i)
    expect(entry.warnings.join('\n')).toMatch(/1 Postman environment file/i)
    expect(entry.warnings.join('\n')).toMatch(/Unsupported Postman request kinds were skipped: 1 WebSocket request/i)
    expect(entry.warnings.join('\n')).toMatch(/Unknown keys were ignored/i)
    expect(entry.warnings.join('\n')).toMatch(/unsupported request settings were ignored: disableCookies/i)
    expect(entry.warnings.join('\n')).toMatch(/1 folder variable was imported as collection variables/i)
  })

  it('warns per malformed file instead of failing the import', () => {
    const [entry] = convertPostmanV3Files(folder('broken'))
    expect(entry.collection.name).toBe('Broken Sample')
    expect(entry.collection.requests).toEqual([])
    expect(entry.warnings.join('\n')).toMatch(/Bad.request.yaml/i)
  })

  it('imports a single-file v3 collection definition', () => {
    const [entry] = convertPostmanV3Files([{ path: 'collection.yaml', text: fs.readFileSync(path.join(FIX, 'single-file.yaml'), 'utf-8') }])
    expect(entry.collection.name).toBe('Single file sample')
    expect(entry.collection.folders[0].name).toBe('Admin')
    expect(entry.collection.folders[0].requests[0].url).toBe('{{baseUrl}}/audit/{{id}}')
    expect(entry.collection.variables).toEqual(expect.arrayContaining([{ key: 'baseUrl', value: 'https://single.example.com', isSecret: false }]))
    expect(entry.collection.variables).toEqual(expect.arrayContaining([{ key: 'id', value: '99', isSecret: false }]))
  })

  it('maps every auth type, every body mode, conditional auth, and inline ordering', () => {
    const doc = {
      $kind: 'collection',
      name: 'Inline sample',
      auth: { type: 'inherit' },
      variables: [{ key: 'baseUrl', value: 'https://inline.example.com' }],
      items: [
        {
          $kind: 'folder',
          name: 'Nested',
          auth: { type: 'noauth' },
          items: [
            {
              $kind: 'http-request',
              name: 'Token JSON',
              method: 'POST',
              url: '{{baseUrl}}/users/:userId?from=url',
              pathVariables: [{ key: 'userId', value: '7' }],
              auth: { type: 'bearer', credentials: [{ key: 'token', value: 'token-1' }] },
              body: { type: 'json', content: '{"ok":true}' },
            },
            {
              $kind: 'http-request',
              name: 'Basic XML',
              url: '{{baseUrl}}/xml',
              auth: { type: 'basic', credentials: [{ key: 'username', value: 'ada' }, { key: 'password', value: 'lovelace' }] },
              body: { type: 'xml', content: '<user />' },
            },
            {
              $kind: 'http-request',
              name: 'Digest HTML',
              url: '{{baseUrl}}/html',
              auth: { type: 'digest', credentials: [{ key: 'username', value: 'd' }, { key: 'password', value: 'p' }] },
              body: { type: 'html', content: '<p>ok</p>' },
            },
            {
              $kind: 'http-request',
              name: 'NTLM JS',
              url: '{{baseUrl}}/js',
              auth: { type: 'ntlm', credentials: [{ key: 'username', value: 'u' }, { key: 'password', value: 'p' }, { key: 'domain', value: 'DOM' }, { key: 'workstation', value: 'WS' }] },
              body: { type: 'javascript', content: 'console.log(1)' },
            },
            {
              $kind: 'http-request',
              name: 'API key text',
              url: '{{baseUrl}}/text',
              auth: { type: 'apikey', credentials: [{ key: 'key', value: 'X-Api-Key' }, { key: 'value', value: 'value-1' }, { key: 'in', value: 'query' }] },
              body: { type: 'text', content: 'hello' },
            },
          ],
        },
        {
          $kind: 'http-request',
          name: 'AWS form',
          url: '{{baseUrl}}/form',
          auth: { type: 'awsv4', credentials: [{ key: 'accessKey', value: 'AK' }, { key: 'secretKey', value: 'SK' }, { key: 'sessionToken', value: 'ST' }, { key: 'region', value: 'eu-west-1' }, { key: 'service', value: 'execute-api' }] },
          body: { type: 'urlencoded', content: [{ key: 'first', value: '1' }, { key: 'second', value: '2', disabled: true }] },
        },
        {
          $kind: 'http-request',
          name: 'OAuth PKCE form-data',
          url: '{{baseUrl}}/multipart',
          auth: {
            type: 'oauth2',
            credentials: [
              { key: 'grantType', value: 'authorization_code_with_pkce' },
              { key: 'clientId', value: 'cid' },
              { key: 'clientSecret', value: 'csecret' },
              { key: 'authorizationUrl', value: 'https://auth.example.com/authorize' },
              { key: 'tokenUrl', value: 'https://auth.example.com/token' },
              { key: 'scopes', value: 'read write' },
              { key: 'redirectUri', value: 'postly://callback' },
            ],
          },
          body: {
            type: 'formdata',
            content: [
              { key: 'file', type: 'file', src: ['report.csv'] },
              { key: 'note', value: 'hi', disabled: true },
            ],
          },
        },
        {
          $kind: 'http-request',
          name: 'OAuth client credentials graphql',
          url: '{{baseUrl}}/graphql?debug=true',
          auth: {
            type: 'oauth2',
            credentials: [
              { key: 'grant_type', value: 'client_credentials' },
              { key: 'clientId', value: 'svc' },
              { key: 'clientSecret', value: 'svc-secret' },
              { key: 'authUrl', value: 'https://auth.example.com/authorize' },
              { key: 'accessTokenUrl', value: 'https://auth.example.com/token' },
              { key: 'scope', value: 'admin' },
            ],
          },
          body: { type: 'graphql', content: { query: 'query Q { ping }', variables: '{"debug":true}' } },
        },
        {
          $kind: 'http-request',
          name: 'OAuth password file',
          url: '{{baseUrl}}/upload',
          auth: {
            type: 'oauth2',
            credentials: [
              { key: 'grantType', value: 'password_credentials' },
              { key: 'clientId', value: 'pw-client' },
              { key: 'clientSecret', value: 'pw-secret' },
              { key: 'tokenUrl', value: 'https://auth.example.com/token' },
            ],
          },
          body: { type: 'file', content: { src: 'payload.bin' } },
        },
        {
          $kind: 'http-request',
          name: 'OAuth implicit fallback text',
          url: '{{baseUrl}}/fallback',
          headers: [{ key: 'X-Dyn', value: '{{ $custom }}' }],
          auth: {
            type: 'oauth2',
            credentials: [
              { key: 'grantType', value: 'implicit' },
              { key: 'clientId', value: 'implicit-client' },
              { key: 'redirect_uri', value: 'postly://implicit' },
            ],
          },
          body: { type: 'custom', content: 'leave me raw' },
        },
        {
          $kind: 'http-request',
          name: 'Unsupported body',
          url: '{{baseUrl}}/unsupported',
          headers: [{ key: 'Content-Type', value: 'application/octet-stream' }],
          body: { type: 'proto', content: 'bytes' },
          auth: [{ type: 'basic', rules: [{ key: 'url', value: 'https://inline.example.com/unsupported' }], credentials: [{ key: 'username', value: 'match' }, { key: 'password', value: 'secret' }] }],
        },
        {
          $kind: 'http-request',
          name: 'Unsupported auth',
          url: '{{baseUrl}}/auth',
          auth: { type: 'hawk' },
          body: { type: 'none' },
        },
      ],
    }

    const [entry] = convertPostmanV3Files([{ path: 'collection.yaml', text: JSON.stringify(doc) }])
    expect(entry.collection.auth).toEqual({ type: 'none', config: {} })
    expect(entry.collection.variables).toEqual(expect.arrayContaining([{ key: 'userId', value: '7', isSecret: false }]))
    expect(entry.collection.folders.map((folder) => folder.name)).toEqual(['Nested'])
    expect(entry.collection.folders[0].auth).toEqual({ type: 'none', config: {} })

    const requests = new Map(allRequests(entry.collection).map((request) => [request.name, request] as const))
    expect([...requests.keys()]).toEqual([
      'AWS form',
      'OAuth PKCE form-data',
      'OAuth client credentials graphql',
      'OAuth password file',
      'OAuth implicit fallback text',
      'Unsupported body',
      'Unsupported auth',
      'Token JSON',
      'Basic XML',
      'Digest HTML',
      'NTLM JS',
      'API key text',
    ])

    expect(requests.get('Token JSON')).toMatchObject({
      method: 'POST',
      url: '{{baseUrl}}/users/{{userId}}',
      bodyType: 'raw-json',
      auth: { type: 'bearer', config: { token: 'token-1' } },
    })
    expect(rows(JSON.stringify(requests.get('Token JSON')?.params)).map((row) => [row.key, row.value])).toEqual([['from', 'url']])
    expect(requests.get('Basic XML')).toMatchObject({ bodyType: 'raw-xml', auth: { type: 'basic', config: { username: 'ada', password: 'lovelace' } } })
    expect(requests.get('Digest HTML')).toMatchObject({ bodyType: 'raw-html', auth: { type: 'digest', config: { username: 'd', password: 'p' } } })
    expect(requests.get('NTLM JS')).toMatchObject({ bodyType: 'raw-javascript', auth: { type: 'ntlm', config: { username: 'u', password: 'p', domain: 'DOM', workstation: 'WS' } } })
    expect(requests.get('API key text')).toMatchObject({ bodyType: 'raw-text', auth: { type: 'apikey', config: { key: 'X-Api-Key', value: 'value-1', in: 'query' } } })
    expect(requests.get('AWS form')).toMatchObject({ bodyType: 'x-www-form-urlencoded', auth: { type: 'awsv4', config: { accessKey: 'AK', secretKey: 'SK', sessionToken: 'ST', region: 'eu-west-1', service: 'execute-api' } } })
    expect(rows(requests.get('AWS form')?.bodyContent as string).map((row) => [row.key, row.enabled])).toEqual([['first', true], ['second', false]])
    expect(requests.get('OAuth PKCE form-data')).toMatchObject({
      bodyType: 'form-data',
      auth: {
        type: 'oauth2',
        config: {
          grantType: 'authorization_code',
          clientId: 'cid',
          clientSecret: 'csecret',
          authUrl: 'https://auth.example.com/authorize',
          tokenUrl: 'https://auth.example.com/token',
          scopes: 'read write',
          redirectUri: 'postly://callback',
        },
      },
    })
    expect(rows(requests.get('OAuth PKCE form-data')?.bodyContent as string).map((row) => [row.key, row.value, row.enabled, row.fieldType ?? 'text'])).toEqual([
      ['file', 'report.csv', true, 'file'],
      ['note', 'hi', false, 'text'],
    ])
    expect(requests.get('OAuth client credentials graphql')).toMatchObject({
      bodyType: 'graphql',
      auth: {
        type: 'oauth2',
        config: {
          grantType: 'client_credentials',
          clientId: 'svc',
          clientSecret: 'svc-secret',
          authUrl: 'https://auth.example.com/authorize',
          tokenUrl: 'https://auth.example.com/token',
          scopes: 'admin',
          redirectUri: '',
        },
      },
    })
    expect(JSON.parse(requests.get('OAuth client credentials graphql')?.bodyContent as string)).toEqual({ query: 'query Q { ping }', variables: '{"debug":true}' })
    expect(rows(JSON.stringify(requests.get('OAuth client credentials graphql')?.params)).map((row) => [row.key, row.value])).toEqual([['debug', 'true']])
    expect(requests.get('OAuth password file')).toMatchObject({
      bodyType: 'binary',
      auth: {
        type: 'oauth2',
        config: {
          grantType: 'password',
          clientId: 'pw-client',
          clientSecret: 'pw-secret',
          authUrl: '',
          tokenUrl: 'https://auth.example.com/token',
          scopes: '',
          redirectUri: '',
        },
      },
    })
    expect(requests.get('OAuth implicit fallback text')).toMatchObject({
      bodyType: 'raw-text',
      auth: {
        type: 'oauth2',
        config: {
          grantType: 'implicit',
          clientId: 'implicit-client',
          clientSecret: '',
          authUrl: '',
          tokenUrl: '',
          scopes: '',
          redirectUri: 'postly://implicit',
        },
      },
    })
    expect(requests.get('Unsupported body')).toMatchObject({
      bodyType: 'none',
      auth: { type: 'basic', config: { username: 'match', password: 'secret' } },
    })
    expect(requests.get('Unsupported auth')).toMatchObject({ bodyType: 'none', auth: { type: 'none', config: {} } })
    expect(entry.warnings.join('\n')).toMatch(/"OAuth password file": the username and password of the OAuth 2.0 password grant were not mapped\./)
    expect(entry.warnings.join('\n')).toMatch(/"OAuth password file": the file for the binary body was not imported/)
    expect(entry.warnings.join('\n')).toMatch(/"Unsupported body": conditional auth rules are not supported; only one credential set was imported\./)
    expect(entry.warnings.join('\n')).toMatch(/"Unsupported body": body type "proto" is not supported\./)
    expect(entry.warnings.join('\n')).toMatch(/"Unsupported auth": "hawk" authentication is not supported/)
    expect(entry.warnings.join('\n')).toMatch(/Postman dynamic variables Postly does not provide are used and will stay unresolved: \{\{\$custom\}\}\./)
  })

  it('imports multiple folder roots and sorts folder requests by path', () => {
    const entries = convertPostmanV3Files([
      { path: 'Beta/B.request.yaml', text: '$kind: http-request\nname: B\nauth:\n  type: noauth\nurl: https://beta.test\n' },
      { path: 'Alpha/.resources/definition.yaml', text: '$kind: collection\nname: Alpha\n' },
      { path: 'Alpha/z-last.request.yaml', text: '$kind: http-request\nname: Z last\nurl: https://alpha.test/z\n' },
      { path: 'Alpha/a-first.request.yaml', text: '$kind: http-request\nname: A first\nurl: https://alpha.test/a\n' },
    ])

    expect(entries.map((entry) => entry.collection.name)).toEqual(['Alpha', 'Beta'])
    expect(entries[0].collection.requests.map((request) => request.name)).toEqual(['A first', 'Z last'])
    expect(entries[1].collection.requests[0]).toMatchObject({ name: 'B', auth: { type: 'none', config: {} } })
  })

  it('applies the import budget to deep folder trees', () => {
    const request = '$kind: http-request\nname: Leaf\nurl: https://x.test\nmethod: GET\n'
    const deep = Array.from({ length: 66 }, (_, i) => `f${i}`).join('/')
    expect(() => convertPostmanV3Files([
      { path: '.resources/definition.yaml', text: '$kind: collection\nname: Deep\n' },
      { path: `${deep}/Leaf.request.yaml`, text: request },
    ])).toThrow(/nested deeper than 64 levels/i)
  })

  it('fails when a single-file collection exceeds the import node limit', () => {
    const doc = {
      $kind: 'collection',
      name: 'Too many',
      items: Array.from({ length: 20_001 }, (_, i) => ({
        $kind: 'http-request',
        name: `Request ${i}`,
        url: `https://limit.test/${i}`,
      })),
    }
    expect(() => convertPostmanV3Files([{ path: 'collection.yaml', text: JSON.stringify(doc) }])).toThrow(/more than 20000 requests and folders/i)
  })
})

describe('paths as sent by the folder picker', () => {
  it('detects the layout when every path starts with the picked folder name', () => {
    const files = folder('workspace').map((f) => ({ ...f, path: `workspace/${f.path}` }))
    const [entry] = convertPostmanV3Files(files)
    expect(entry.collection.name).toBe('Native Git Sample')
    expect(entry.warnings.join('\n')).toMatch(/environment/i)
    expect(entry.warnings.join('\n')).not.toContain('workspace/postman')
  })
})
