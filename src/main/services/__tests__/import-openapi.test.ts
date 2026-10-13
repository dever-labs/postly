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
    expect(warnings.some((w) => w.includes('2 servers') && w.includes('staging.example.com'))).toBe(true)
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
    expect(warnings.some((w) => w.includes('"oauth"') && w.includes('not mapped'))).toBe(true)
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
