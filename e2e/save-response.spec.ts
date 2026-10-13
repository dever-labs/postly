import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { test, expect } from './fixtures'

// A tiny valid PNG (1x1 red pixel); contains bytes that are not valid UTF-8
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64')

test.describe('Save response', () => {
  let server: http.Server
  let base = ''
  let dir = ''

  test.beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postly-e2e-save-'))
    server = http.createServer((req, res) => {
      if (req.url === '/logo.png') {
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Disposition': 'attachment; filename="pixel.png"' })
        res.end(PNG)
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{"hello":"world"}')
      }
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  test.afterAll(() => {
    server.closeAllConnections()
    server.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test.afterEach(async ({ window }) => {
    await window.evaluate(() => window.api.proxy.set({ mode: 'system', url: '', username: '', password: '', bypass: '' }))
  })

  test('a binary response is previewed and saved byte-exact', async ({ window, electronApp }) => {
    const suffix = Date.now()
    const colName = `E2E Save ${suffix}`
    const reqName = `Save Request ${suffix}`
    await window.evaluate(() => window.api.proxy.set({ mode: 'none', url: '', username: '', password: '', bypass: '' }))
    const colId = await window.evaluate(async (name: string) => {
      const res = await window.api.collections.create({ name })
      return (res as { data: { id: string } }).data.id
    }, colName)
    const grpId = await window.evaluate(async (id: string) => {
      const res = await window.api.folders.create({ parentId: id, name: 'Default' })
      return (res as { data: { id: string } }).data.id
    }, colId)
    await window.evaluate(async ([id, name]: [string, string]) => {
      await window.api.requests.create({ folderId: id, name, method: 'GET' })
    }, [grpId, reqName] as [string, string])
    await window.reload()
    await window.waitForSelector('[data-testid="app-root"]', { timeout: 20_000 })
    await window.getByText(colName).first().click()
    await window.getByText(reqName).first().click()
    const urlInput = window.getByTestId('url-input')
    await urlInput.waitFor({ state: 'visible' })
    await window.waitForTimeout(400)

    // The native save dialog cannot be driven, so answer it from the main process
    const target = path.join(dir, 'saved.png')
    await electronApp.evaluate(({ dialog }, filePath) => {
      ;(globalThis as { __saveDefault?: string }).__saveDefault = undefined
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        const options = (args[args.length - 1] ?? {}) as { defaultPath?: string }
        ;(globalThis as { __saveDefault?: string }).__saveDefault = options.defaultPath
        return { canceled: false, filePath }
      }) as typeof dialog.showSaveDialog
    }, target)

    await urlInput.fill(`${base}/logo.png`)
    await window.waitForTimeout(200)
    await window.getByTestId('send-button').click()

    await expect(window.getByTestId('response-notice')).toContainText('Binary response')
    await expect(window.getByTestId('response-copy')).toBeDisabled()

    await window.getByRole('tab', { name: 'Preview' }).click()
    const image = window.getByAltText('Response preview')
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1)

    await window.getByTestId('response-save').click()
    await expect.poll(() => fs.existsSync(target)).toBe(true)
    expect(Buffer.compare(fs.readFileSync(target), PNG)).toBe(0)
    expect(await electronApp.evaluate(() => (globalThis as { __saveDefault?: string }).__saveDefault)).toBe('pixel.png')
    await expect(window.getByText(`Saved to ${target}`)).toBeVisible()
  })
})
