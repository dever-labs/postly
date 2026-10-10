import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, expect } from './fixtures'

test.describe('Extract values', () => {
  let server: http.Server
  let base = ''
  const seen: { url: string; token: string }[] = []

  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      seen.push({ url: req.url ?? '', token: String(req.headers['x-token'] ?? '') })
      res.setHeader('Content-Type', 'application/json')
      res.setHeader('X-Session', 'sess-42')
      res.end(JSON.stringify({ data: { token: 'tok-123' } }))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  test.afterAll(() => { server.close() })

  let envId = ''
  test.afterEach(async ({ window }) => {
    await window.evaluate(() => window.api.proxy.set({ mode: 'system', url: '', username: '', password: '', bypass: '' }))
    if (envId) await window.evaluate((id: string) => window.api.environments.delete({ id }), envId)
    envId = ''
  })

  test('a login response fills variables that the next request uses', async ({ window }) => {
    const suffix = Date.now()
    const colName = `E2E Extract ${suffix}`
    await window.evaluate(() => window.api.proxy.set({ mode: 'none', url: '', username: '', password: '', bypass: '' }))
    envId = await window.evaluate(async (name: string) => {
      const env = (await window.api.environments.create({ name })) as { data: { id: string } }
      await window.api.environments.setActive({ id: env.data.id })
      return env.data.id
    }, `Extract Env ${suffix}`)
    const colId = await window.evaluate(async (name: string) => {
      const res = await window.api.collections.create({ name })
      return (res as { data: { id: string } }).data.id
    }, colName)
    const grpId = await window.evaluate(async (id: string) => {
      const res = await window.api.folders.create({ parentId: id, name: 'Default' })
      return (res as { data: { id: string } }).data.id
    }, colId)
    await window.evaluate(async ([id]: [string]) => {
      await window.api.requests.create({ folderId: id, name: 'Login', method: 'POST' })
      await window.api.requests.create({ folderId: id, name: 'Me', method: 'GET' })
    }, [grpId] as [string])
    await window.reload()
    await window.waitForSelector('[data-testid="app-root"]', { timeout: 20_000 })

    // Login: add rules in the Extract tab
    await window.getByText(colName).first().click()
    await window.getByText('Login', { exact: true }).first().click()
    const urlInput = window.getByTestId('url-input')
    await urlInput.waitFor({ state: 'visible' })
    await window.waitForTimeout(400)
    await urlInput.fill(`${base}/login`)
    await window.waitForTimeout(200)

    await window.getByTestId('extract-trigger').click()
    await window.getByTestId('extract-add').click()
    await window.getByTestId('extract-expression').fill('$..token')
    await window.getByTestId('extract-variable').fill('token')
    await expect(window.getByTestId('extract-error')).toContainText('not supported')
    await window.getByTestId('extract-expression').fill('$.data.token')
    await expect(window.getByTestId('extract-error')).toHaveCount(0)
    await window.getByTestId('extract-scope').selectOption('collection')

    await window.getByTestId('extract-add').click()
    const second = window.getByTestId('extract-rule').nth(1)
    await second.getByTestId('extract-source').selectOption('header')
    await second.getByTestId('extract-expression').fill('x-session')
    await second.getByTestId('extract-variable').fill('session')

    await window.getByTestId('send-button').click()
    await expect(window.getByTestId('response-status')).toContainText('200', { timeout: 10_000 })
    await window.getByRole('tab', { name: /Console/ }).click()
    await expect(window.getByText('Extract: token ← tok-123 (collection)')).toBeVisible()
    await expect(window.getByText('Extract: session ← sess-42 (environment)')).toBeVisible()

    // Me: use both extracted values
    await window.getByText('Me', { exact: true }).first().click()
    const meUrl = window.getByTestId('url-input')
    await meUrl.waitFor({ state: 'visible' })
    await window.waitForTimeout(400)
    await meUrl.fill(`${base}/me/{{session}}`)
    await window.waitForTimeout(200)
    await window.getByRole('tab', { name: 'Headers' }).click()
    await window.getByRole('button', { name: 'Add header' }).click()
    await window.getByPlaceholder('Header name').fill('X-Token')
    await window.getByPlaceholder('Value').first().fill('{{token}}')
    await window.waitForTimeout(300)
    await window.getByTestId('send-button').click()
    await expect(window.getByTestId('response-status')).toContainText('200', { timeout: 10_000 })

    expect(seen.at(-1)).toEqual({ url: '/me/sess-42', token: 'tok-123' })
  })
})
