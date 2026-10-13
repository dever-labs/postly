import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, expect } from './fixtures'

const stamp = Date.now()
const title = `Spec API ${stamp}`

const SPEC = `
openapi: 3.0.0
info:
  title: ${title}
  version: '1'
servers:
  - url: https://api.example.test/v1
paths:
  /widgets:
    get:
      tags: [widgets]
      summary: List widgets ${stamp}
      parameters:
        - { name: page, in: query, schema: { type: integer } }
        - { name: sid, in: cookie, schema: { type: string } }
`

let server: http.Server
let base = ''

test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/openapi.yaml') {
      res.writeHead(200, { 'Content-Type': 'application/yaml' })
      res.end(SPEC)
    } else if (req.url === '/huge') {
      // chunked, no Content-Length: the size cap must stop the download
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      const chunk = Buffer.alloc(1024 * 1024, 'a')
      const timer = setInterval(() => { if (!res.write(chunk)) return }, 1)
      res.on('close', () => clearInterval(timer))
    } else {
      res.writeHead(404).end()
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

test.afterAll(async ({ window }) => {
  server.closeAllConnections()
  server.close()
  await window.evaluate(async (name: string) => {
    const result = await window.api.folders.list() as { data?: Array<{ id: string; name: string; parentId?: string; parent_id?: string }> }
    for (const f of result.data ?? []) if (!(f.parentId ?? f.parent_id) && f.name === name) await window.api.folders.delete({ id: f.id })
  }, title)
})

test.describe('Import OpenAPI', () => {
  test('previews a file with warnings, then imports it as a collection', async ({ window }) => {
    await window.getByTestId('btn-import').click()
    await window.locator('input[type="file"]').setInputFiles({ name: 'api.yaml', mimeType: 'application/yaml', buffer: Buffer.from(SPEC) })

    await expect(window.getByTestId('import-format')).toContainText('OpenAPI')
    await expect(window.getByText(title)).toBeVisible()
    await expect(window.getByText('1 folder · 1 request')).toBeVisible()
    await expect(window.getByTestId('import-warnings')).toContainText('cookie parameters')

    await window.getByRole('button', { name: /Import 1 collection/ }).click()
    await expect(window.getByRole('treeitem', { name: new RegExp(`^${title}`) })).toBeVisible()

    const urls = await window.evaluate(async (name: string) => {
      type F = { id: string; name: string; parentId?: string; parent_id?: string }
      const folders = (await window.api.folders.list() as { data: F[] }).data
      const parent = (f: F) => f.parentId ?? f.parent_id
      const root = folders.find((f) => !parent(f) && f.name === name)!
      const sub = folders.find((f) => parent(f) === root.id)!
      const reqs = (await window.api.requests.list({ folderId: sub.id }) as { data: Array<{ url: string; name: string }> }).data
      return reqs.map((r) => r.url)
    }, title)
    expect(urls).toEqual(['{{baseUrl}}/widgets'])
  })

  test('fetches a document from a URL and shows an error for a bad one', async ({ window }) => {
    await window.getByTestId('btn-import').click()
    await window.getByTestId('import-url').fill(`${base}/missing.yaml`)
    await window.getByTestId('import-url-fetch').click()
    await expect(window.getByTestId('import-error')).toContainText('404')

    await window.getByTestId('import-url').fill(`${base}/huge`)
    await window.getByTestId('import-url-fetch').click()
    await expect(window.getByTestId('import-error')).toContainText('larger than 20 MB')

    await window.getByTestId('import-url').fill('ftp://example.com/x')
    await window.getByTestId('import-url-fetch').click()
    await expect(window.getByTestId('import-error')).toContainText('http')

    await window.getByTestId('import-url').fill(`${base}/openapi.yaml`)
    await window.getByTestId('import-url-fetch').click()
    await expect(window.getByTestId('import-format')).toContainText('OpenAPI')
  })

  test('rejects a file in an unknown format', async ({ window }) => {
    await window.getByTestId('btn-import').click()
    await window.locator('input[type="file"]').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') })
    await expect(window.getByTestId('import-error')).toContainText('Unrecognised format')
  })
})
