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
