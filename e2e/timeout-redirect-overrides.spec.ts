import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, expect } from './fixtures'

test.describe('Timeout & redirect overrides', () => {
  let server: http.Server
  let base = ''

  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/slow') {
        setTimeout(() => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('finally') }, 500)
      } else if (req.url === '/hop') {
        res.writeHead(302, { Location: '/slow' })
        res.end()
      } else {
        res.writeHead(404); res.end()
      }
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  test.afterAll(() => { server.closeAllConnections(); server.close() })

  test.beforeEach(async ({ window }) => {
    await window.evaluate(() => window.api.proxy.set({ mode: 'none', url: '', username: '', password: '', bypass: '' }))
  })

  test.afterEach(async ({ window }) => {
    await window.evaluate(() => window.api.proxy.set({ mode: 'system', url: '', username: '', password: '', bypass: '' }))
  })

  test('collection, folder and request overrides apply in order and are explained in the Console', async ({ window }) => {
    const suffix = Date.now()
    const colName = `E2E Net ${suffix}`
    const grpName = `Slow folder ${suffix}`
    const reqName = `Net Request ${suffix}`
    const colId = await window.evaluate(async (name: string) => {
      const res = await window.api.collections.create({ name })
      return (res as { data: { id: string } }).data.id
    }, colName)
    const grpId = await window.evaluate(async ([id, name]: [string, string]) => {
      const res = await window.api.folders.create({ parentId: id, name })
      return (res as { data: { id: string } }).data.id
    }, [colId, grpName] as [string, string])
    await window.evaluate(async ([id, name]: [string, string]) => {
      await window.api.requests.create({ folderId: id, name, method: 'GET' })
    }, [grpId, reqName] as [string, string])
    await window.reload()
    await window.waitForSelector('[data-testid="app-root"]', { timeout: 20_000 })

    // Collection: a short timeout, saved and still there after a reload
    await window.getByText(colName).first().click()
    const editor = window.getByTestId('network-editor')
    await editor.waitFor({ state: 'visible' })
    await expect(editor.getByTestId('timeout-inherited')).toContainText('30 s from the global setting')
    await editor.getByTestId('timeout-mode-custom').click()
    await editor.getByTestId('timeout-value').fill('0.15')
    await window.getByTestId('collection-save-button').click()
    await expect(window.getByTestId('collection-dirty-dot')).not.toBeVisible()
    await window.reload()
    await window.waitForSelector('[data-testid="app-root"]', { timeout: 20_000 })
    await window.getByText(colName).first().click()
    await expect(window.getByTestId('timeout-value')).toHaveValue('0.15')

    // A request in the folder inherits it, so the slow endpoint times out and the Console names the source
    const sendSlow = async () => {
      const urlInput = window.getByTestId('url-input')
      await urlInput.waitFor({ state: 'visible' })
      await urlInput.fill(`${base}/slow`)
      await urlInput.press('Enter')
    }
    await window.getByText(grpName).first().click()
    await expect(window.getByTestId('timeout-inherited')).toContainText(`150 ms from collection "${colName}"`)
    await window.getByText(reqName).first().click()
    await sendSlow()
    await expect(window.getByTestId('response-status')).toContainText('timeout of 150ms exceeded', { timeout: 10_000 })
    await window.getByRole('tab', { name: /Console/ }).click()
    await expect(window.getByText(`Timeout: 150ms (collection "${colName}")`)).toBeVisible()

    // The folder overrides the collection
    await window.getByText(grpName).first().click()
    const folderEditor = window.getByTestId('network-editor')
    await folderEditor.waitFor({ state: 'visible' })
    await folderEditor.getByTestId('timeout-mode-custom').click()
    await folderEditor.getByTestId('timeout-value').fill('5')
    await window.getByTestId('group-save-button').click()
    await expect(window.getByTestId('group-save-button')).not.toHaveClass(/bg-blue-600/)
    await window.getByText(reqName).first().click()
    await window.getByTestId('send-button').click()
    await expect(window.getByTestId('response-status')).toContainText('200', { timeout: 10_000 })
    await window.getByRole('tab', { name: /Console/ }).click()
    await expect(window.getByText(`Timeout: 5000ms (folder "${grpName}")`)).toBeVisible()

    // The request overrides both
    await window.getByRole('tab', { name: 'Settings' }).click()
    const requestEditor = window.getByTestId('network-editor')
    await requestEditor.getByTestId('timeout-mode-custom').click()
    await requestEditor.getByTestId('timeout-value').fill('0.1')
    await window.getByTestId('send-button').click()
    await expect(window.getByTestId('response-status')).toContainText('timeout of 100ms exceeded', { timeout: 10_000 })
    await window.getByRole('tab', { name: /Console/ }).click()
    await expect(window.getByText('Timeout: 100ms (request)')).toBeVisible()
  })

  test('redirects can be switched off for a request', async ({ window }) => {
    const suffix = Date.now()
    const colName = `E2E Redirect ${suffix}`
    const reqName = `Redirect Request ${suffix}`
    const colId = await window.evaluate(async (name: string) => {
      const res = await window.api.collections.create({ name })
      return (res as { data: { id: string } }).data.id
    }, colName)
    await window.evaluate(async ([id, name]: [string, string]) => {
      await window.api.requests.create({ folderId: id, name, method: 'GET' })
    }, [colId, reqName] as [string, string])
    await window.reload()
    await window.waitForSelector('[data-testid="app-root"]', { timeout: 20_000 })
    await window.getByText(colName).first().click()
    await window.getByText(reqName).first().click()
    const urlInput = window.getByTestId('url-input')
    await urlInput.waitFor({ state: 'visible' })
    await urlInput.fill(`${base}/hop`)
    await window.getByRole('tab', { name: 'Settings' }).click()
    await window.getByTestId('redirects-mode-off').click()
    await urlInput.press('Enter')
    await expect(window.getByTestId('response-status')).toContainText('302', { timeout: 10_000 })

    await window.getByTestId('redirects-mode-inherit').click()
    await window.getByTestId('send-button').click()
    await expect(window.getByTestId('response-status')).toContainText('200', { timeout: 10_000 })
  })
})
