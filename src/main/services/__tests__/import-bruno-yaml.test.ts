import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseRules } from '../../../shared/extract'
import { convertBrunoYamlFiles, isBrunoYamlFolder } from '../import-bruno-yaml'

const FIX = path.join(__dirname, 'fixtures', 'bruno-yaml')
const rows = (v: string) => JSON.parse(v) as Array<{ key: string; value: string; enabled: boolean; fieldType?: string }>

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

  it('applies the import budget to deeply nested trees', () => {
    const deep = Array.from({ length: 66 }, (_, index) => `f${index}`).join('/')
    expect(() => convertBrunoYamlFiles([
      { path: 'c/opencollection.yml', text: 'opencollection: "1.0.0"\ninfo:\n  name: Budget\n' },
      { path: `c/${deep}/request.yml`, text: 'info:\n  name: R\n  type: http\nhttp:\n  method: GET\n  url: https://x.test\n' },
    ])).toThrow(/nested deeper than 64 levels/)
  })
})
