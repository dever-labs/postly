import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_FOLDER_FILES, MAX_IMPORT_BYTES, previewFolder, previewImport } from '../import-formats'

const FIX = path.join(__dirname, 'fixtures')

const read = (...parts: string[]) => fs.readFileSync(path.join(FIX, ...parts), 'utf-8')

function bruRequest(name: string, url: string): string {
  return `meta {
  name: ${name}
  type: http
}

get {
  url: ${url}
}
`
}

describe('previewImport', () => {
  it('rejects empty content, invalid JSON, and non-object payloads', async () => {
    await expect(previewImport('   ')).rejects.toThrow(/file is empty/)
    await expect(previewImport('{ nope')).rejects.toThrow(/Invalid JSON/)
    await expect(previewImport('- a\n- b\n')).rejects.toThrow(/expected a JSON or YAML object/)
    await expect(previewImport('{"hello":"world"}')).rejects.toThrow(/Unrecognised format/)
  })

  it('detects single-file Postman v3 collections from YAML text', async () => {
    const preview = await previewImport(read('postman-v3', 'single-file.yaml'))
    expect(preview.format).toBe('postman')
    expect(preview.collections[0].collection.name).toBe('Single file sample')
    expect(preview.collections[0].collection.folders[0].requests[0]).toMatchObject({
      name: 'Get audit',
      url: '{{baseUrl}}/audit/{{id}}',
    })
  })

  it('enforces the 20 MB import cap before parsing', async () => {
    await expect(previewImport('x'.repeat(MAX_IMPORT_BYTES + 1))).rejects.toThrow(/larger than 20 MB/)
  })

  it('keeps top-level Postly environments alongside collections in previews', async () => {
    const preview = await previewImport(JSON.stringify({
      $schema: 'postly/v1',
      exportedAt: '2026-10-17T00:00:00.000Z',
      collections: [{
        name: 'Imported API',
        description: '',
        source: 'local',
        auth: { type: 'none', config: {} },
        ssl: 'inherit',
        requests: [],
        folders: [],
      }],
      environments: [{
        name: 'Shared',
        variables: [{ key: 'base_url', value: 'https://api.example.test', isSecret: false }],
      }],
    }))

    expect(preview).toMatchObject({
      format: 'postly',
      collections: [expect.objectContaining({ collection: expect.objectContaining({ name: 'Imported API' }) })],
      environments: [{ name: 'Shared', variables: [{ key: 'base_url', value: 'https://api.example.test', isSecret: false }] }],
      warnings: [],
    })
  })

  it('normalizes malformed Postly preview environments for the renderer', async () => {
    const preview = await previewImport(JSON.stringify({
      $schema: 'postly/v1',
      exportedAt: '2026-10-17T00:00:00.000Z',
      collections: [],
      environments: [
        null,
        {
          name: 123,
          variables: [
            null,
            { key: 7, value: false, isSecret: 'yes' },
            'skip-me',
          ],
        },
        {
          variables: 'bad-shape',
        },
      ],
    }))

    expect(preview.environments).toEqual([
      {
        name: '123',
        variables: [{ key: '7', value: 'false', isSecret: false }],
      },
      {
        name: 'Imported',
        variables: [],
      },
    ])
  })

  it('rejects Bruno environment exports with more than 5000 environments', async () => {
    await expect(previewImport(JSON.stringify({
      info: { type: 'bruno-environment' },
      environments: Array.from({ length: 5001 }, (_, index) => ({
        name: `Env ${index + 1}`,
        variables: [],
      })),
    }))).rejects.toThrow(/more than 5000 environments/i)
  })

  it('accepts previews exactly at the 5000-environment limit', async () => {
    const preview = await previewImport(JSON.stringify({
      $schema: 'postly/v1',
      exportedAt: '2026-10-17T00:00:00.000Z',
      collections: [],
      environments: Array.from({ length: 5000 }, (_, index) => ({
        name: `Env ${index + 1}`,
        variables: [],
      })),
    }))

    expect(preview.format).toBe('postly')
    expect(preview.collections).toEqual([])
    expect(preview.environments).toHaveLength(5000)
    expect(preview.environments?.[0]).toEqual({ name: 'Env 1', variables: [] })
    expect(preview.environments?.[4999]).toEqual({ name: 'Env 5000', variables: [] })
  })

  it('rejects Postly previews with more than 5000 total environments', async () => {
    await expect(previewImport(JSON.stringify({
      $schema: 'postly/v1',
      exportedAt: '2026-10-17T00:00:00.000Z',
      collections: [{
        name: 'Imported API',
        description: '',
        source: 'local',
        auth: { type: 'none', config: {} },
        ssl: 'inherit',
        requests: [],
        folders: [],
        environments: Array.from({ length: 2501 }, (_, index) => ({ name: `Collection ${index + 1}`, variables: [] })),
      }],
      environments: Array.from({ length: 2500 }, (_, index) => ({ name: `Top ${index + 1}`, variables: [] })),
    }))).rejects.toThrow(/more than 5000 environments/i)
  })

  it('rejects other previews with more than 5000 environments', async () => {
    await expect(previewImport(JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Too many servers', version: '1' },
      servers: Array.from({ length: 5001 }, (_, index) => ({ url: `https://server-${index + 1}.example.test` })),
      paths: { '/ping': { get: { responses: {} } } },
    }))).rejects.toThrow(/more than 5000 environments/i)
  })

  it('keeps standalone Insomnia environment exports as environment previews', async () => {
    const preview = await previewImport(JSON.stringify({
      _type: 'export',
      __export_format: 4,
      resources: [
        {
          _id: 'env_base',
          _type: 'environment',
          parentId: 'wrk_1',
          name: 'Base',
          isPrivate: false,
          data: { base_url: 'https://api.example.test' },
        },
        {
          _id: 'env_dev',
          _type: 'environment',
          parentId: 'env_base',
          name: 'Dev',
          isPrivate: true,
          data: { token: 'secret-token', nested: { region: 'eu-west-1' } },
        },
      ],
    }))

    expect(preview).toEqual({
      format: 'insomnia-environment',
      collections: [],
      environments: [
        {
          name: 'Base',
          variables: [{ key: 'base_url', value: 'https://api.example.test', isSecret: false }],
        },
        {
          name: 'Dev',
          variables: [
            { key: 'token', value: 'secret-token', isSecret: true },
            { key: 'nested.region', value: 'eu-west-1', isSecret: true },
          ],
        },
      ],
      warnings: [],
    })
  })

  it('keeps standalone Insomnia v5 environment files as environment previews', async () => {
    const preview = await previewImport(`
type: environment.insomnia.rest/5.0
schema_version: "5.1"
name: Standalone environments
meta:
  id: wrk_env
environments:
  name: Base
  meta:
    id: env_base
  data:
    base_url: https://api.example.test
  subEnvironments:
    - name: Dev
      meta:
        id: env_dev
      data:
        token: "{% prompt 'token' %}"
`)

    expect(preview).toEqual({
      format: 'insomnia-environment',
      collections: [],
      environments: [
        {
          name: 'Base',
          variables: [{ key: 'base_url', value: 'https://api.example.test', isSecret: false }],
        },
        {
          name: 'Dev',
          variables: [{ key: 'token', value: "{% prompt 'token' %}", isSecret: false }],
        },
      ],
      warnings: [`Dev: uses Insomnia template tags that were left as text ({% prompt 'token' %}).`],
    })
  })
})

describe('previewFolder', () => {
  it('prefers Bruno .bru folders over Bruno YAML and Postman v3 content', () => {
    const preview = previewFolder([
      { path: 'mixed/request.bru', text: bruRequest('Bru request', 'https://bru.example.com/items') },
      { path: 'mixed/opencollection.yml', text: read('bruno-yaml', 'real-runner', 'opencollection.yml') },
      { path: 'mixed/get-users.yml', text: read('bruno-yaml', 'real-runner', 'get-users.yml') },
      { path: 'mixed/collection.yaml', text: read('postman-v3', 'single-file.yaml') },
    ])
    expect(preview.format).toBe('bruno')
    expect(preview.collections[0].collection.name).toBe('mixed')
    expect(preview.collections[0].collection.requests[0]).toMatchObject({ name: 'Bru request', url: 'https://bru.example.com/items' })
  })

  it('falls back to Bruno YAML before Postman v3 when no .bru files exist', () => {
    const preview = previewFolder([
      { path: 'yaml/opencollection.yml', text: read('bruno-yaml', 'real-runner', 'opencollection.yml') },
      { path: 'yaml/get-users.yml', text: read('bruno-yaml', 'real-runner', 'get-users.yml') },
      { path: 'yaml/collection.yaml', text: read('postman-v3', 'single-file.yaml') },
    ])
    expect(preview.format).toBe('bruno')
    expect(preview.collections[0].collection.name).toBe('Test OpenCollection')
    expect(preview.collections[0].collection.requests[0]).toMatchObject({ name: 'Get Users', url: 'https://api.example.com/users' })
  })

  it('imports Postman v3 folders when Bruno formats are absent', () => {
    const preview = previewFolder([{ path: 'postman/collection.yaml', text: read('postman-v3', 'single-file.yaml') }])
    expect(preview.format).toBe('postman')
    expect(preview.collections[0].collection.name).toBe('Single file sample')
    expect(preview.collections[0].collection.folders[0].requests[0].url).toBe('{{baseUrl}}/audit/{{id}}')
  })

  it('enforces file count and byte limits and explains empty folders', () => {
    expect(() => previewFolder(Array.from({ length: MAX_FOLDER_FILES + 1 }, (_, i) => ({ path: `c/${i}.bru`, text: '' })))).toThrow(
      new RegExp(`more than ${MAX_FOLDER_FILES} collection files`),
    )
    expect(() => previewFolder([{ path: 'c/request.bru', text: 'x'.repeat(MAX_IMPORT_BYTES + 1) }])).toThrow(/folder is larger than 20 MB/)
    expect(() => previewFolder([])).toThrow(/No Bruno \(\.bru or YAML\) or Postman v3 collection files were found/)
  })
})

describe('standalone Bruno environment export', () => {
  it('imports the environments, copies inherited variables and keeps secrets blank', async () => {
    const text = fs.readFileSync(path.join(FIX, 'real-world-env', 'bruno-collection-environments.json'), 'utf-8')
    const preview = await previewImport(text)
    expect(preview.format).toBe('bruno-environment')
    expect(preview.collections).toEqual([])
    const derived = preview.environments?.find((e) => e.name === 'derived')
    expect(derived?.variables.map((v) => v.key)).toEqual(expect.arrayContaining(['host', 'secretToken', 'region']))
    expect(derived?.variables.find((v) => v.key === 'secretToken')).toMatchObject({ value: '', isSecret: true })
    expect(preview.warnings.join('\n')).toMatch(/extends another/)
  })
})
