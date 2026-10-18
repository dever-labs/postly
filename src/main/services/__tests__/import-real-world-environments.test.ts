import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseRules } from '../../../shared/extract'
import type { ExportCollection, ExportFolder, ExportRequest } from '../../ipc/export-import'
import { previewFolder, previewImport } from '../import-formats'

const FIX = path.join(__dirname, 'fixtures', 'real-world-env')

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

const text = (name: string) => fs.readFileSync(path.join(FIX, name), 'utf-8')

const allRequests = (tree: RequestTree): ExportRequest[] => [
  ...tree.requests,
  ...tree.folders.flatMap((child) => allRequests(child)),
]

function requestByName(collection: ExportCollection, name: string): ExportRequest {
  const request = allRequests(collection).find((entry) => entry.name === name)
  expect(request, `request ${name} to exist`).toBeTruthy()
  return request as ExportRequest
}

describe('real-world environment import fixtures', () => {
  it('previews every committed sample without crashing', async () => {
    const folderFixtures = [
      'bruno-bru-usebruno-secret',
      'bruno-yaml-usebruno-secret',
      'postman-v3-workslocal',
    ]
    const fileFixtures = [
      'insomnia-v4-kong.json',
      'insomnia-v5-kong-environment-cascade.yaml',
      'openapi-oai-uspto.yaml',
      'swagger-v2-petstore.json',
    ]

    for (const name of folderFixtures) {
      const preview = previewFolder(folder(name))
      expect(preview.collections.length, name).toBeGreaterThan(0)
    }
    for (const name of fileFixtures) {
      const preview = await previewImport(text(name))
      expect(preview.collections.length, name).toBeGreaterThan(0)
    }
  })

  it('maps a real Bruno .bru secret environment', () => {
    const preview = previewFolder(folder('bruno-bru-usebruno-secret'))
    expect(preview.format).toBe('bruno')

    const collection = preview.collections[0].collection
    expect(collection.environments).toEqual([
      {
        name: 'Local',
        variables: [
          { key: 'baseUrl', value: 'http://localhost:8081', isSecret: false },
          { key: 'apiToken', value: '', isSecret: true },
        ],
      },
    ])

    const readSecret = requestByName(collection, 'read-secret')
    expect(readSecret.url).toBe('{{baseUrl}}/query')
    expect(readSecret.params).toEqual([
      expect.objectContaining({ key: 'token', value: '{{apiToken}}', enabled: true }),
    ])
    expect(preview.warnings.join('\n')).toMatch(/secret variable.*blank values/i)
  })

  it('maps a real Bruno YAML secret environment', () => {
    const preview = previewFolder(folder('bruno-yaml-usebruno-secret'))
    expect(preview.format).toBe('bruno')

    const collection = preview.collections[0].collection
    expect(collection.environments).toEqual([
      {
        name: 'Local',
        variables: [
          { key: 'baseUrl', value: 'http://localhost:8081', isSecret: false },
          { key: 'apiToken', value: '', isSecret: true },
        ],
      },
    ])

    expect(requestByName(collection, 'read-secret').url).toBe('{{baseUrl}}/query')
    expect(preview.warnings.join('\n')).toMatch(/secret variable.*blank values/i)
  })

  it('maps a real Postman v3 environment alongside the collection folder', () => {
    const preview = previewFolder(folder('postman-v3-workslocal'))
    expect(preview.format).toBe('postman')

    const collection = preview.collections[0].collection
    expect(collection.name).toBe('WorksLocal API')
    expect(collection.environments).toEqual([
      {
        name: 'WorksLocal - Local',
        variables: [
          { key: 'base_url', value: 'http://localhost:8787', isSecret: false },
          { key: 'auth_token', value: '', isSecret: false },
          { key: 'key_id', value: '', isSecret: false },
        ],
      },
    ])

    const create = requestByName(collection, 'Create API Key')
    expect(create.url).toBe('{{base_url}}/api/v1/keys')
    expect(parseRules(create.protocolConfig.extractRules as string).map((rule) => [rule.source, rule.expression, rule.variable])).toEqual([
      ['json', '$.data.id', 'key_id'],
    ])
  })

  it('maps a real Insomnia v4 base and child environment export', async () => {
    const preview = await previewImport(text('insomnia-v4-kong.json'))
    expect(preview.format).toBe('insomnia')

    const collection = preview.collections[0].collection
    expect(collection.variables).toEqual(expect.arrayContaining([
      { key: 'base_url', value: '{{scheme}}://{{host}}{{base_path}}', isSecret: false },
    ]))
    expect(collection.environments).toEqual([
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
  })

  it('maps a real Insomnia v5 export with sub-environments', async () => {
    const preview = await previewImport(text('insomnia-v5-kong-environment-cascade.yaml'))
    expect(preview.format).toBe('insomnia')

    const collection = preview.collections[0].collection
    expect(collection.variables).toEqual(expect.arrayContaining([
      { key: 'cascadeVar', value: 'fromFolder', isSecret: false },
      { key: 'subOnlyVar', value: 'subOnly_base', isSecret: false },
      { key: 'folderOverride', value: 'fromInnerFolder', isSecret: false },
    ]))
    expect(collection.environments).toEqual([
      {
        name: 'Base Environment',
        variables: [
          { key: 'cascadeVar', value: 'fromBase', isSecret: false },
          { key: 'subOnlyVar', value: 'subOnly_base', isSecret: false },
        ],
      },
      {
        name: 'SubEnvA',
        variables: [
          { key: 'cascadeVar', value: 'fromSubA', isSecret: false },
          { key: 'subOnlyVar', value: 'subOnly_A', isSecret: false },
        ],
      },
      {
        name: 'SubEnvB',
        variables: [
          { key: 'cascadeVar', value: 'fromSubB', isSecret: false },
          { key: 'subOnlyVar', value: 'subOnly_B', isSecret: false },
        ],
      },
    ])
  })

  it('maps a real OpenAPI 3 server variable into the collection baseUrl', async () => {
    const preview = await previewImport(text('openapi-oai-uspto.yaml'))
    expect(preview.format).toBe('openapi')

    const collection = preview.collections[0].collection
    expect(collection.variables).toEqual(expect.arrayContaining([
      { key: 'baseUrl', value: 'https://developer.uspto.gov/ds-api', isSecret: false },
    ]))
    expect(collection.environments).toBeUndefined()
  })

  it('maps a real Swagger 2 multi-scheme spec into environments', async () => {
    const preview = await previewImport(text('swagger-v2-petstore.json'))
    expect(preview.format).toBe('openapi')

    const collection = preview.collections[0].collection
    expect(collection.variables).toEqual(expect.arrayContaining([
      { key: 'baseUrl', value: 'https://petstore.swagger.io/v2', isSecret: false },
    ]))
    expect(collection.environments).toEqual([
      {
        name: 'petstore.swagger.io (https)',
        variables: [{ key: 'baseUrl', value: 'https://petstore.swagger.io/v2', isSecret: false }],
      },
      {
        name: 'petstore.swagger.io (http)',
        variables: [{ key: 'baseUrl', value: 'http://petstore.swagger.io/v2', isSecret: false }],
      },
    ])
  })
})
