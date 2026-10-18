import { test, expect } from './fixtures'

test.describe('Cookie jar', () => {
  const cookieName = `sid${Date.now()}`

  test.afterEach(async ({ window }) => {
    await window.evaluate(() => window.api.proxy.set({ mode: 'system', url: '', username: '', password: '', bypass: '' }))
    await window.evaluate(() => window.api.cookies.clear())
  })

  test('cookies from a response are shown, sent on the next request and managed in Settings', async ({ window, server }) => {
    const suffix = Date.now()
    const colName = `E2E Cookies ${suffix}`
    const reqName = `Cookie Request ${suffix}`
    const loginId = `cookie-login-${suffix}`
    const profileId = `cookie-profile-${suffix}`
    await server.addMock({
      id: loginId,
      request: { method: 'GET', path: '/login' },
      response: {
        status: 200,
        headers: {
          'Content-Type': 'text/plain',
          'Set-Cookie': `${cookieName}=topsecret; Path=/; HttpOnly`,
        },
        body: 'ok',
      },
    })
    await server.addMock({
      id: profileId,
      request: { method: 'GET', path: '/profile' },
      response: {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
        body: 'ok',
      },
    })
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
    const callCounts: Record<string, number> = { [loginId]: 0, [profileId]: 0 }

    const send = async (path: string, mockId: string) => {
      await urlInput.fill(`${server.httpBase}${path}`)
      await urlInput.press('Enter')
      await expect(window.getByTestId('response-status')).toContainText('200', { timeout: 10_000 })
      const nextCount = callCounts[mockId] + 1
      expect((await server.waitForCalls(mockId, nextCount)).count).toBe(nextCount)
      callCounts[mockId] = nextCount
    }

    // The login response sets a cookie; the tab lists it with the value masked
    await send('/login', loginId)
    await window.getByTestId('cookies-tab').click()
    const table = window.getByTestId('cookies-table')
    await expect(table).toContainText(cookieName)
    await expect(table).not.toContainText('topsecret')
    await window.getByTestId('cookies-reveal').click()
    await expect(table).toContainText('topsecret')

    // The next request sends it automatically; the Console shows the name but never the value
    await send('/profile', profileId)
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
    await send('/profile', profileId)
    await window.getByRole('tab', { name: /Console/ }).click()
    await expect(window.getByText(/Cookies: sending/)).toHaveCount(0)
  })
})
