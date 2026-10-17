import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseRules } from '../../../shared/extract'
import { convertPostmanV3Files, isPostmanV3Folder } from '../import-postman-v3'

const FIX = path.join(__dirname, 'fixtures', 'postman-v3')
const rows = (text: string) => JSON.parse(text) as Array<{ key: string; value: string; enabled: boolean; fieldType?: string }>

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

  it('applies the import budget to deep folder trees', () => {
    const request = '$kind: http-request\nname: Leaf\nurl: https://x.test\nmethod: GET\n'
    const deep = Array.from({ length: 66 }, (_, i) => `f${i}`).join('/')
    expect(() => convertPostmanV3Files([
      { path: '.resources/definition.yaml', text: '$kind: collection\nname: Deep\n' },
      { path: `${deep}/Leaf.request.yaml`, text: request },
    ])).toThrow(/nested deeper than 64 levels/i)
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
