import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test, expect } from './fixtures'

const stamp = Date.now()
const postmanName = `Postman ${stamp}`
const insomniaName = `Insomnia ${stamp}`
const brunoName = `Bruno ${stamp}`

const POSTMAN = {
  info: { name: postmanName, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  variable: [{ key: 'host', value: 'https://api.example.test' }],
  item: [{
    name: 'Users',
    item: [{
      name: 'Create user',
      request: {
        method: 'POST',
        url: { raw: '{{host}}/users?active=true', query: [{ key: 'active', value: 'true' }] },
        body: { mode: 'raw', raw: '{"a":1}', options: { raw: { language: 'json' } } },
        auth: { type: 'bearer', bearer: [{ key: 'token', value: 'abc' }] },
      },
      event: [{ listen: 'test', script: { exec: ['pm.environment.set("id", pm.response.json().id);'] } }, { listen: 'prerequest', script: { exec: ['console.log(1)'] } }],
    }],
  }],
}

const INSOMNIA = `type: collection.insomnia.rest/5.0
schema_version: "5.1"
name: ${insomniaName}
collection:
  - name: Pets
    children:
      - url: "{{ _.base_url }}/pets"
        name: List pets
        method: GET
        parameters:
          - { name: limit, value: "10" }
        scripts:
          afterResponse: insomnia.test('ok', () => {})
environments:
  name: Base Environment
  data:
    base_url: https://api.example.test
  subEnvironments:
    - name: Staging
      data: {}
`

test.afterAll(async ({ window }) => {
  await window.evaluate(async (names: string[]) => {
    const result = await window.api.folders.list() as { data?: Array<{ id: string; name: string; parentId?: string; parent_id?: string }> }
    for (const f of result.data ?? []) if (!(f.parentId ?? f.parent_id) && names.includes(f.name)) await window.api.folders.delete({ id: f.id })
  }, [postmanName, insomniaName, brunoName])
})

test.describe('Import Postman and Insomnia', () => {
  test('imports a Postman collection with its folders, variables and warnings', async ({ window }) => {
    await window.getByTestId('btn-import').click()
    await window.locator('input[type="file"]:not([data-testid="import-folder-input"])').setInputFiles({ name: 'c.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(POSTMAN)) })
    await expect(window.getByTestId('import-format')).toContainText('Postman')
    await expect(window.getByText('1 folder · 1 request')).toBeVisible()
    await expect(window.getByTestId('import-warnings')).toContainText('pre-request script')

    await window.getByRole('button', { name: /Import 1 collection/ }).click()
    await expect(window.getByRole('treeitem', { name: new RegExp(`^${postmanName}`) })).toBeVisible()

    const imported = await window.evaluate(async (name: string) => {
      type F = { id: string; name: string; parentId?: string; parent_id?: string }
      const folders = (await window.api.folders.list() as { data: F[] }).data
      const parent = (f: F) => f.parentId ?? f.parent_id
      const root = folders.find((f) => !parent(f) && f.name === name)!
      const sub = folders.find((f) => parent(f) === root.id)!
      const reqs = (await window.api.requests.list({ folderId: sub.id }) as { data: Array<{ url: string; method: string; bodyType?: string; body_type?: string }> }).data
      return reqs.map((r) => [r.method, r.url, r.bodyType ?? r.body_type])
    }, postmanName)
    expect(imported).toEqual([['POST', '{{host}}/users', 'raw-json']])
  })

  test('imports an Insomnia v5 file and reports what was left out', async ({ window }) => {
    await window.getByTestId('btn-import').click()
    await window.locator('input[type="file"]:not([data-testid="import-folder-input"])').setInputFiles({ name: 'i.yaml', mimeType: 'application/yaml', buffer: Buffer.from(INSOMNIA) })
    await expect(window.getByTestId('import-format')).toContainText('Insomnia')
    await expect(window.getByTestId('import-warnings')).toContainText('Scripts were not imported')
    await expect(window.getByTestId('import-warnings')).toContainText('sub-environment')

    await window.getByRole('button', { name: /Import 1 collection/ }).click()
    await expect(window.getByRole('treeitem', { name: new RegExp(`^${insomniaName}`) })).toBeVisible()
  })

  test('explains a Postman environment file', async ({ window }) => {
    await window.getByTestId('btn-import').click()
    await window.locator('input[type="file"]:not([data-testid="import-folder-input"])').setInputFiles({ name: 'env.json', mimeType: 'application/json', buffer: Buffer.from('{"name":"E","values":[],"_postman_variable_scope":"environment"}') })
    await expect(window.getByTestId('import-error')).toContainText('Postman environment')
  })

  test('imports a Bruno collection folder', async ({ window }) => {
    await window.getByTestId('btn-import').click()
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-'))
    fs.writeFileSync(path.join(dir, 'bruno.json'), JSON.stringify({ version: '1', name: brunoName, type: 'collection' }))
    fs.writeFileSync(path.join(dir, 'ping.bru'), 'meta {\n  name: Ping\n  type: http\n  seq: 1\n}\n\nget {\n  url: https://api.example.test/ping\n  body: none\n  auth: none\n}\n\nscript:pre-request {\n  console.log(1)\n}\n')
    await window.getByTestId('import-folder-input').setInputFiles(dir)
    await expect(window.getByTestId('import-format')).toContainText('Bruno')
    await expect(window.getByTestId('import-warnings')).toContainText('Scripts were not imported')
    await window.getByRole('button', { name: /Import 1 collection/ }).click()
    await expect(window.getByRole('treeitem', { name: new RegExp(`^${brunoName}`) })).toBeVisible()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const fixtures = path.join(__dirname, '..', 'src', 'main', 'services', '__tests__', 'fixtures')

  test('imports a Postman v3 (Native Git) folder', async ({ window }) => {
    await window.getByTestId('btn-import').click()
    await window.getByTestId('import-folder-input').setInputFiles(path.join(fixtures, 'postman-v3', 'workspace'))
    await expect(window.getByTestId('import-format')).toContainText('Postman')
    await expect(window.getByText('Native Git Sample')).toBeVisible()
    await expect(window.getByTestId('import-warnings')).toContainText('environment')
  })

  test('imports a Bruno YAML (OpenCollection) folder', async ({ window }) => {
    await window.getByTestId('btn-import').click()
    await window.getByTestId('import-folder-input').setInputFiles(path.join(fixtures, 'bruno-yaml', 'spec-complex'))
    await expect(window.getByTestId('import-format')).toContainText('Bruno')
  })
})
