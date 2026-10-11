import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, expect } from './fixtures'

test.describe('Cookie jar', () => {
  let server: http.Server
  let base = ''
  const cookieName = `sid${Date.now()}`

  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/login') res.setHeader('Set-Cookie', `${cookieName}=topsecret; Path=/; HttpOnly`)
      res.end('ok')
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  test.afterAll(() => { server.close() })

  test.afterEach(async ({ window }) => {
    await window.evaluate(() => window.api.proxy.set({ mode: 'system', url: '', username: '', password: '', bypass: '' }))
    await window.evaluate(() => window.api.cookies.clear())
  })

  test('cookies from a response are shown, sent on the next request and managed in Settings', async ({ window }) => {
    const suffix = Date.now()
    const colName = `E2E Cookies ${suffix}`
    const reqName = `Cookie Request ${suffix}`
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

    const send = async (path: string) => {
      await urlInput.fill(`${base}${path}`)
      await window.waitForTimeout(200) // URL input debounces writes to the store
      await window.getByTestId('send-button').click()
      await expect(window.getByTestId('response-status')).toContainText('200', { timeout: 10_000 })
    }

    // The login response sets a cookie; the tab lists it with the value masked
    await send('/login')
    await window.getByTestId('cookies-tab').click()
    const table = window.getByTestId('cookies-table')
    await expect(table).toContainText(cookieName)
    await expect(table).not.toContainText('topsecret')
    await window.getByTestId('cookies-reveal').click()
    await expect(table).toContainText('topsecret')

    // The next request sends it automatically; the Console shows the name but never the value
    await send('/profile')
    await window.getByRole('tab', { name: /Console/ }).click()
    await expect(window.getByText(`sending 1 from the jar (${cookieName})`)).toBeVisible()
    await expect(window.getByText('topsecret')).toHaveCount(0)

    // The manager lists, edits and deletes it
    await window.keyboard.press('Control+,')
    await window.getByTestId('settings-modal').getByRole('button', { name: 'Cookies' }).click()
    const row = window.getByTestId('cookie-row').filter({ hasText: cookieName })
    await expect(row).toHaveCount(1)
    await expect(row).not.toContainText('topsecret')
    await row.getByRole('button', { name: `Edit ${cookieName}` }).click()
    await window.getByTestId('cookie-value').fill('edited')
    await window.getByTestId('cookie-save').click()
    await window.getByTestId('cookie-reveal').check()
    await expect(window.getByTestId('cookie-row').filter({ hasText: cookieName })).toContainText('edited')

    await window.getByRole('button', { name: `Delete ${cookieName}` }).click()
    await expect(window.getByTestId('cookie-row').filter({ hasText: cookieName })).toHaveCount(0)
    await window.keyboard.press('Escape')

    // With the cookie gone nothing is sent
    await send('/profile')
    await window.getByRole('tab', { name: /Console/ }).click()
    await expect(window.getByText(/Cookies: sending/)).toHaveCount(0)
  })
})
