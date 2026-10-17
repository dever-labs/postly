import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseRules } from '../../../shared/extract'
import type { ExportCollection, ExportFolder, ExportRequest } from '../../ipc/export-import'
import { previewFolder } from '../import-formats'

const FIX = path.join(__dirname, 'fixtures', 'real-world')

type RequestTree = Pick<ExportCollection, 'requests' | 'folders'> | Pick<ExportFolder, 'requests' | 'folders'>

function folder(name: string): Array<{ path: string; text: string }> {
  const root = path.join(FIX, name)
  const walk = (dir: string): Array<{ path: string; text: string }> =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const next = path.join(dir, entry.name)
      return entry.isDirectory()
        ? walk(next)
        : [{ path: `picked/${path.relative(root, next).split(path.sep).join('/')}`, text: fs.readFileSync(next, 'utf-8') }]
    })
  return walk(root)
}

const allRequests = (tree: RequestTree): ExportRequest[] => [
  ...tree.requests,
  ...tree.folders.flatMap((child) => allRequests(child)),
]

function requestByName(collection: ExportCollection, name: string): ExportRequest {
  const request = allRequests(collection).find((entry) => entry.name === name)
  expect(request, `request ${name} to exist`).toBeTruthy()
  return request as ExportRequest
}

describe('real-world import fixtures', () => {
  it('previews all committed real-world folders without crashing', () => {
    for (const name of [
      'postman-v3-executor-mcp',
      'postman-v3-workslocal',
      'bruno-yaml-usebruno-typed',
      'bruno-yaml-usebruno-ntlm',
      'bruno-yaml-kimun',
    ]) {
      const preview = previewFolder(folder(name))
      expect(preview.collections.length, name).toBeGreaterThan(0)
      expect(preview.collections[0].requests + preview.collections[0].folders, name).toBeGreaterThan(0)
    }
  })

  it('maps a real Postman v3 Native Git GraphQL plugin folder', () => {
    const preview = previewFolder(folder('postman-v3-executor-mcp'))
    expect(preview.format).toBe('postman')

    const collection = preview.collections[0].collection
    expect(collection.name).toBe('executor-mcp')
    expect(collection.auth).toEqual({ type: 'bearer', config: { token: '{{executor-token}}' } })
    expect(collection.folders.map((entry) => entry.name)).toEqual(['11 - Plugin GraphQL'])

    const add = requestByName(collection, '01 - POST add GraphQL integration (mutating)')
    expect(add).toMatchObject({
      method: 'POST',
      url: '{{base_url}}/api/graphql/integrations',
      bodyType: 'raw-json',
      auth: { type: 'inherit', config: {} },
    })
    expect(add.bodyContent).toContain('https://api.github.com/graphql')

    const config = requestByName(collection, '04 - POST configure GraphQL integration')
    expect(config.bodyContent).toContain('"mode": "merge"')

    expect(preview.warnings.join('\n')).toMatch(/4 saved response examples across 4 requests were not imported/)
    expect(preview.warnings.join('\n')).toMatch(/script line could not be converted/)
  })

  it('maps a real Postman v3 API keys folder, including object-form auth credentials', () => {
    const preview = previewFolder(folder('postman-v3-workslocal'))
    expect(preview.format).toBe('postman')

    const collection = preview.collections[0].collection
    expect(collection.name).toBe('WorksLocal API')
    expect(collection.folders[0].auth).toEqual({ type: 'bearer', config: { token: '{{auth_token}}' } })

    const create = requestByName(collection, 'Create API Key')
    expect(create).toMatchObject({
      method: 'POST',
      url: '{{base_url}}/api/v1/keys',
      bodyType: 'raw-json',
      auth: { type: 'inherit', config: {} },
    })
    expect(create.bodyContent).toContain('"name": "my-api-key"')
    expect(parseRules(create.protocolConfig.extractRules as string).map((rule) => [rule.source, rule.expression, rule.variable])).toEqual([
      ['json', '$.data.id', 'key_id'],
    ])

    expect(requestByName(collection, 'Revoke API Key').url).toBe('{{base_url}}/api/v1/keys/{{key_id}}')
    expect(preview.warnings.join('\n')).toMatch(/1 collection script scope was not imported/)
    expect(preview.warnings.join('\n')).toMatch(/3 saved response examples across 3 requests were not imported/)
  })

  it('maps a real Bruno OpenCollection typed-variable fixture with folder bodies and environment warnings', () => {
    const preview = previewFolder(folder('bruno-yaml-usebruno-typed'))
    expect(preview.format).toBe('bruno')

    const collection = preview.collections[0].collection
    expect(collection.name).toBe('bruno-yml-testbench')
    expect(collection.variables).toEqual(expect.arrayContaining([
      { key: 'coll_num', value: '100', isSecret: false },
      { key: 'fold_num', value: '200', isSecret: false },
      { key: 'req_num', value: '42', isSecret: false },
    ]))
    expect(collection.folders.map((entry) => entry.name)).toEqual(['variable-datatypes'])

    expect(requestByName(collection, 'typed vars').bodyType).toBe('raw-json')
    expect(requestByName(collection, 'form-urlencoded').bodyType).toBe('x-www-form-urlencoded')
    expect(requestByName(collection, 'multipart').bodyType).toBe('form-data')

    expect(collection.environments?.map((e) => e.name)).toEqual(['Local'])
    expect(preview.warnings.join('\n')).not.toMatch(/environment.* not imported/)
    expect(preview.warnings.join('\n')).toMatch(/4 folder variables and 15 request variables were imported as collection variables/)
    expect(preview.warnings.join('\n')).toMatch(/timeout \(non-positive or out-of-range values\)/)
  })

  it('maps a real Bruno OpenCollection NTLM fixture even when bruno.json is present', () => {
    const preview = previewFolder(folder('bruno-yaml-usebruno-ntlm'))
    expect(preview.format).toBe('bruno')

    const collection = preview.collections[0].collection
    expect(collection.name).toBe('ntlm')
    expect(collection.requests).toHaveLength(7)

    const api = requestByName(collection, 'api')
    expect(api.auth).toEqual({
      type: 'ntlm',
      config: { username: 'ntlm-user', password: 'redacted-password', domain: '', workstation: '' },
    })

    const redirect = requestByName(collection, 'redirect')
    expect(redirect.params).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'to', value: '{{process.env.NTLM_BASE_URL}}/landing', enabled: true }),
    ]))

    const body = requestByName(collection, 'body')
    expect(body).toMatchObject({ method: 'POST', bodyType: 'raw-json' })
    expect(body.headers).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'Content-Type', value: 'application/json', enabled: true }),
      expect.objectContaining({ key: 'X-Dropped', value: 'dropped', enabled: true }),
    ]))

    expect(preview.warnings.join('\n')).toMatch(/Bruno request settings were not imported: forwardAuthorizationHeader/)
  })

  it('maps a real Bruno OpenCollection app folder with network settings', () => {
    const preview = previewFolder(folder('bruno-yaml-kimun'))
    expect(preview.format).toBe('bruno')

    const collection = preview.collections[0].collection
    expect(collection.name).toBe('Kimun')
    expect(collection.requests).toHaveLength(4)

    const ask = requestByName(collection, 'Ask a question')
    expect(ask).toMatchObject({
      method: 'POST',
      url: 'http://127.0.0.1:8080/api/answer',
      bodyType: 'raw-json',
      network: { followRedirects: true, maxRedirects: 5 },
    })
    expect(ask.bodyContent).toContain('{{?question}}')
    expect(requestByName(collection, 'Check a Job').url).toBe('http://127.0.0.1:8080/api/job/{{job_id}}')

    expect(preview.warnings.join('\n')).toMatch(/Scripts were not imported for 1 item \("Ask a question"\)/)
    expect(preview.warnings.join('\n')).toMatch(/encodeUrl, timeout \(non-positive or out-of-range values\)/)
  })
})
