import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseBru } from '../bru-lang'
import { previewBrunoFolder, previewImport } from '../import-formats'
import { convertBrunoFiles } from '../import-bruno'

const FIX = path.join(__dirname, 'fixtures', 'bruno')

function folder(name: string): Array<{ path: string; text: string }> {
  const walk = (dir: string): Array<{ path: string; text: string }> =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name)
      return e.isDirectory() ? walk(p) : [{ path: `${name}/${path.relative(path.join(FIX, name), p).split(path.sep).join('/')}`, text: fs.readFileSync(p, 'utf-8') }]
    })
  return walk(path.join(FIX, name))
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
    const preview = previewBrunoFolder(folder('real-testbench'))
    expect(preview.format).toBe('bruno')
    const reqs = convertBrunoFiles(folder('real-testbench'))[0].collection.requests
    const byName = (n: string) => reqs.find((r) => r.name === n)
    expect(byName('mutation')?.bodyType).toBe('graphql')
    expect(byName('multipart-mixed-form-data-file')?.bodyType).toBe('form-data')
    expect(preview.warnings.join('\n')).toMatch(/environments were not imported/)
  })

  it('rejects a folder with no Bruno files', () => {
    expect(() => previewBrunoFolder([{ path: 'x/readme.md', text: '' }])).toThrow(/No Bruno/)
  })

  it('explains that the YAML format is unsupported', () => {
    expect(() => previewBrunoFolder([{ path: 'c/opencollection.yml', text: 'opencollection: 1.0.0' }])).toThrow(/YAML/)
  })
})

describe('Bruno JSON export', () => {
  it('is detected and converted', async () => {
    const preview = await previewImport(fs.readFileSync(path.join(FIX, 'real-export.json'), 'utf-8'))
    expect(preview.format).toBe('bruno')
    expect(preview.collections[0].collection.name).toBe('test_collection')
    expect(preview.collections[0].requests).toBe(1)
  })
})
