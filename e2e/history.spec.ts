import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, expect } from './fixtures'

test.describe('Request history', () => {
  let server: http.Server
  let base = ''

  test.beforeAll(async () => {
    server = http.createServer((_, res) => {
      res.setHeader('content-type', 'application/json')
      res.end('{"hello":"history"}')
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  test.afterAll(() => { server.close() })

  test.afterEach(async ({ window }) => {
    await window.evaluate(() => window.api.proxy.set({ mode: 'system', url: '', username: '', password: '', bypass: '' }))
  })

  test('sent requests are listed and can be reopened with their response', async ({ window }) => {
    const suffix = Date.now()
    const colName = `E2E History ${suffix}`
    const reqName = `History Request ${suffix}`
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
    const urlInput = window.locator('[data-testid="url-input"]')
    await urlInput.waitFor({ state: 'visible' })
    await window.waitForTimeout(400)
    await urlInput.fill(`${base}/thing`)
    await expect(urlInput).toHaveValue(`${base}/thing`)
    await window.waitForTimeout(200) // URL input debounces writes to the store
    await window.locator('[data-testid="send-button"]').click()
    await expect(window.getByTestId('response-status')).toContainText('200', { timeout: 10_000 })

    await window.getByTestId('tab-history').click()
    const item = window.getByTestId('history-item').filter({ hasText: `${base}/thing` })
    await expect(item).toHaveCount(1)

    await item.locator('button').first().click()
    await expect(window.getByTestId('history-banner')).toBeVisible()
    await expect(urlInput).toHaveValue(`${base}/thing`)
    await expect(window.getByTestId('response-status')).toContainText('200')

    await item.hover()
    await item.getByRole('button', { name: 'Delete entry' }).click()
    await expect(window.getByTestId('history-item').filter({ hasText: `${base}/thing` })).toHaveCount(0)
  })
})
