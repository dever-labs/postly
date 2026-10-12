import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, expect } from './fixtures'

test.describe('API key authentication', () => {
  let server: http.Server
  let base = ''
  const seen: Array<{ url: string; key?: string }> = []
  let digestChallenges = 0
  let digestAnswers = 0

  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/digest') {
        if (req.headers.authorization?.startsWith('Digest ') && /username="alice"/.test(req.headers.authorization)) {
          digestAnswers++
          res.end('digest ok')
        } else {
          digestChallenges++
          res.writeHead(401, { 'WWW-Authenticate': 'Digest realm="r", nonce="n1", qop="auth"' })
          res.end('challenge')
        }
        return
      }
      seen.push({ url: req.url ?? '', key: req.headers['x-api-key'] as string | undefined })
      res.end('ok')
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  test.afterAll(() => { server.close() })

  test.afterEach(async ({ window }) => {
    await window.evaluate(() => window.api.proxy.set({ mode: 'system', url: '', username: '', password: '', bypass: '' }))
  })

  test('the key is added as a header or query parameter and never shown in the Console', async ({ window }) => {
    const suffix = Date.now()
    const colName = `E2E Auth ${suffix}`
    const reqName = `Auth Request ${suffix}`
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
    await urlInput.fill(`${base}/things`)
    await window.waitForTimeout(200)

    await window.getByRole('tab', { name: 'Auth' }).click()
    await window.getByRole('button', { name: 'API Key' }).click()
    const form = window.getByTestId('auth-apikey')
    await form.getByPlaceholder('X-API-Key').fill('X-Api-Key')
    await form.getByPlaceholder(/Value/).fill('super-secret-key')

    await window.getByTestId('send-button').click()
    await expect(window.getByTestId('response-status')).toContainText('200', { timeout: 10_000 })
    expect(seen.at(-1)).toMatchObject({ url: '/things', key: 'super-secret-key' })

    await window.getByTestId('auth-apikey-query').click()
    await window.waitForTimeout(300)
    await window.getByTestId('send-button').click()
    await expect(window.getByTestId('response-status')).toContainText('200', { timeout: 10_000 })
    expect(seen.at(-1)).toMatchObject({ url: '/things?X-Api-Key=super-secret-key' })

    await window.getByRole('tab', { name: /Console/ }).click()
    await expect(window.getByText('as a query parameter')).toBeVisible()
    await expect(window.getByText('super-secret-key')).toHaveCount(0)

    // Digest: the 401 challenge is answered automatically
    await urlInput.fill(`${base}/digest`)
    await window.waitForTimeout(200)
    await window.getByRole('tab', { name: 'Auth' }).click()
    await window.getByRole('button', { name: 'Digest' }).click()
    const digest = window.getByTestId('auth-digest')
    await digest.getByPlaceholder('Username').fill('alice')
    await digest.getByPlaceholder('Password').fill('wonderland-pass')
    await window.getByTestId('send-button').click()
    await expect(window.getByTestId('response-status')).toContainText('200', { timeout: 10_000 })
    expect(digestChallenges).toBe(1)
    expect(digestAnswers).toBe(1)
    await window.getByRole('tab', { name: /Console/ }).click()
    await expect(window.getByText(/answering the challenge/)).toBeVisible()
    await expect(window.getByText('wonderland-pass')).toHaveCount(0)
  })
})
