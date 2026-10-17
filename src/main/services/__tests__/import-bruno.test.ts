import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseBru } from '../bru-lang'
import { previewFolder, previewImport } from '../import-formats'
import { convertBrunoExport, convertBrunoFiles } from '../import-bruno'

const FIX = path.join(__dirname, 'fixtures', 'bruno')
const rows = (v: string) => JSON.parse(v) as Array<{ key: string; value: string; enabled: boolean; fieldType?: string }>

function folder(name: string): Array<{ path: string; text: string }> {
  const walk = (dir: string): Array<{ path: string; text: string }> =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name)
      return e.isDirectory() ? walk(p) : [{ path: `${name}/${path.relative(path.join(FIX, name), p).split(path.sep).join('/')}`, text: fs.readFileSync(p, 'utf-8') }]
    })
  return walk(path.join(FIX, name))
}

function requestText(extra = ''): string {
  return `meta {
  name: Sample
  type: http
}

get {
  url: https://example.com/items
}

${extra}`
}

describe('parseBru', () => {
  it('reads the real bruno-lang request fixture', () => {
    const doc = parseBru(fs.readFileSync(path.join(FIX, 'real-request.bru'), 'utf-8'))
    expect(doc.dicts.get('meta')?.length).toBeGreaterThan(0)
    expect(doc.dicts.has('headers')).toBe(true)
  })

  it('keeps disabled rows and multi-line values', () => {
    const doc = parseBru("headers {\n  ~off: 1\n  on: 2\n}\n\nbody:json {\n  {\n    \"a\": 1\n  }\n}\n")
    expect(doc.dicts.get('headers')).toMatchObject([{ name: 'off', enabled: false }, { name: 'on', enabled: true }])
    expect(JSON.parse(doc.texts.get('body:json') ?? '')).toEqual({ a: 1 })
  })

  it('parses annotations without failing', () => {
    expect(() => parseBru(fs.readFileSync(path.join(FIX, 'real-annotations.bru'), 'utf-8'))).not.toThrow()
  })

  it('parses legacy query blocks and meta tags lists', () => {
    const doc = parseBru(`meta {
  name: Tagged
  tags: [
    smoke
    regression
  ]
}

query {
  page: 1
}
`)
    expect(doc.dicts.get('query')).toMatchObject([{ name: 'page', value: '1', enabled: true }])
    expect(doc.dicts.get('meta')).toMatchObject([{ name: 'name', value: 'Tagged' }, { name: 'tags', value: 'smoke\nregression' }])
  })
})

describe('Bruno folder import', () => {
  it('imports a real collection with folders, requests, auth and variables', () => {
    const [entry] = convertBrunoFiles(folder('real-collection').map((f) => ({ ...f, path: f.path.replace('real-collection/', 'c/') })))
    expect(entry.collection.requests.length).toBeGreaterThan(0)
    expect(entry.collection.folders.length).toBeGreaterThan(0)
    expect(entry.collection.auth.type).toBe('basic')
    expect(entry.warnings.join('\n')).toMatch(/Scripts were not imported/)
  })

  it('maps graphql, multipart, binary and digest requests and warns about environments', () => {
    const preview = previewFolder(folder('real-testbench'))
    expect(preview.format).toBe('bruno')
    const reqs = convertBrunoFiles(folder('real-testbench'))[0].collection.requests
    const byName = (n: string) => reqs.find((r) => r.name === n)
    expect(byName('mutation')?.bodyType).toBe('graphql')
    expect(byName('multipart-mixed-form-data-file')?.bodyType).toBe('form-data')
    expect(preview.warnings.join('\n')).toMatch(/environments were not imported/)
  })

  it('maps legacy query blocks, warns about unknown blocks, and reports tags once', () => {
    const [entry] = convertBrunoFiles([{ path: 'picked/request.bru', text: `meta {
  name: Legacy Query
  tags: [
    smoke
  ]
}

get {
  url: https://example.com/items
}

query {
  page: 1
}

frobnicate {
  mode: on
}
` }])
    expect(entry.collection.name).toBe('picked')
    expect((entry.collection.requests[0].params as Array<{ key: string; value: string }>).map((p) => [p.key, p.value])).toEqual([['page', '1']])
    expect(entry.warnings.join('\n')).toMatch(/Unsupported Bruno blocks were ignored: frobnicate\./)
    expect(entry.warnings.join('\n')).toMatch(/Tags on the collection, folders, or requests were not imported\./)
    expect(entry.warnings.join('\n')).not.toMatch(/query/)
  })

  it('detects the root without bruno.json regardless of order and normalizes windows paths', () => {
    const files = [
      { path: 'picked\\sub\\deeper\\a.bru', text: requestText() },
      { path: 'picked\\sub\\b.bru', text: requestText() },
    ]
    const [entry] = convertBrunoFiles(files.reverse())
    expect(entry.collection.name).toBe('sub')
    expect(entry.collection.requests.map((r) => r.name)).toEqual(['Sample'])
    expect(entry.collection.folders[0].requests.map((r) => r.name)).toEqual(['Sample'])
  })

  it('treats a top-level .bru file as the root when there is no bruno.json', () => {
    const [entry] = convertBrunoFiles([
      { path: 'picked/sub/nested.bru', text: requestText() },
      { path: 'picked/root.bru', text: requestText('meta {\n  name: Root\n  type: http\n}\n\nget {\n  url: https://example.com/root\n}\n') },
    ])
    expect(entry.collection.name).toBe('picked')
    expect(entry.collection.requests.map((r) => r.url)).toContain('https://example.com/root')
  })

  it('maps supported request settings to network overrides and warns about unsupported ones', () => {
    const [entry] = convertBrunoFiles([{ path: 'picked/request.bru', text: `meta {
  name: Settings
  type: http
}

get {
  url: https://example.com/items
}

settings {
  followRedirects: false
  maxRedirects: 2
  timeout: 1500
  encodeUrl: true
}
` }])
    expect(entry.collection.requests[0].network).toEqual({ followRedirects: false, maxRedirects: 2, timeout: 1500 })
    expect(entry.warnings.join('\n')).toMatch(/Bruno request settings were not imported: encodeUrl\./)
  })

  it('splits multipart files, strips content types, and warns once about dropped part content types', () => {
    const [entry] = convertBrunoFiles([{ path: 'picked/request.bru', text: `meta {
  name: Upload
  type: http
}

post {
  url: https://example.com/upload
  body: multipartForm
}

body:multipart-form {
  caption: hello @contentType(text/plain)
  file: @file(one.txt|two.txt) @contentType(image/png)
}
` }])
    expect(rows(entry.collection.requests[0].bodyContent).map((r) => [r.key, r.value, r.fieldType ?? 'text'])).toEqual([
      ['caption', 'hello', 'text'],
      ['file', 'one.txt', 'file'],
      ['file', 'two.txt', 'file'],
    ])
    expect(entry.warnings.join('\n')).toMatch(/Multipart part content types were not imported/)
  })

  it('rejects a folder with no Bruno files', () => {
    expect(() => previewFolder([{ path: 'x/readme.md', text: '' }])).toThrow(/No Bruno/)
  })

  it('reads the YAML (OpenCollection) format', () => {
    const preview = previewFolder([
      { path: 'c/opencollection.yml', text: ['opencollection: 1.0.0', 'info:', '  name: Y', ''].join('\n') },
      { path: 'c/ping.yml', text: ['info:', '  name: Ping', '  type: http', 'http:', '  method: GET', '  url: https://x.test', ''].join('\n') },
    ])
    expect(preview.format).toBe('bruno')
  })

  it('applies the import budget to folder trees', () => {
    const deep = Array.from({ length: 66 }, (_, i) => `f${i}`).join('/')
    expect(() => convertBrunoFiles([
      { path: 'picked/root.bru', text: requestText() },
      { path: `picked/${deep}/request.bru`, text: requestText() },
    ])).toThrow(/nested deeper than 64 levels/)
  })
})

describe('Bruno JSON export', () => {
  it('is detected and converted', async () => {
    const preview = await previewImport(fs.readFileSync(path.join(FIX, 'real-export.json'), 'utf-8'))
    expect(preview.format).toBe('bruno')
    expect(preview.collections[0].collection.name).toBe('test_collection')
    expect(preview.collections[0].requests).toBe(1)
  })

  it('maps multipart file arrays, OAuth 2.0 fields, settings, and tags from JSON exports', () => {
    const entry = convertBrunoExport(JSON.parse(fs.readFileSync(path.join(FIX, 'edge-export.json'), 'utf-8')) as Record<string, unknown>)
    const request = entry.collection.requests[0]
    expect(request.network).toEqual({ followRedirects: false, maxRedirects: 7, timeout: 1200 })
    expect(rows(request.bodyContent).map((r) => [r.key, r.value, r.fieldType ?? 'text'])).toEqual([
      ['file', 'a.txt', 'file'],
      ['file', 'b.txt', 'file'],
      ['caption', 'hello', 'text'],
    ])
    expect(request.auth).toEqual({
      type: 'oauth2',
      config: {
        grantType: 'password',
        clientId: 'id',
        clientSecret: 'secret',
        authUrl: 'https://auth.example.com/authorize',
        tokenUrl: 'https://auth.example.com/token',
        scopes: 'read write',
        redirectUri: 'https://app.example.com/callback',
      },
    })
    expect(entry.warnings.join('\n')).toMatch(/OAuth 2\.0 settings were not imported: .*refresh token URL.*state.*PKCE.*password grant username \/ password/)
    expect(entry.warnings.join('\n')).toMatch(/Bruno request settings were not imported: encodeUrl\./)
    expect(entry.warnings.join('\n')).toMatch(/Tags on the collection, folders, or requests were not imported\./)
    expect(entry.warnings.join('\n')).toMatch(/Multipart part content types were not imported/)
  })

  it('applies the import budget to exported trees', () => {
    let cursor: Record<string, unknown> = {
      type: 'folder',
      name: 'f0',
      seq: 0,
      root: {},
      items: [],
    }
    const doc: Record<string, unknown> = { name: 'Budget', version: '1', items: [cursor], environments: [], brunoConfig: {} }
    for (let i = 1; i <= 65; i++) {
      const next: Record<string, unknown> = { type: 'folder', name: `f${i}`, seq: i, root: {}, items: [] }
      ;(cursor.items as Array<Record<string, unknown>>).push(next)
      cursor = next
    }
    expect(() => convertBrunoExport(doc)).toThrow(/nested deeper than 64 levels/)
  })
})
