import { test, expect } from './fixtures'

test.describe('Request history', () => {
  test.afterEach(async ({ window }) => {
    await window.evaluate(() => window.api.proxy.set({ mode: 'system', url: '', username: '', password: '', bypass: '' }))
  })

  test('sent requests are listed and can be reopened with their response', async ({ window, server }) => {
    const suffix = Date.now()
    const colName = `E2E History ${suffix}`
    const reqName = `History Request ${suffix}`
    const endpointId = `history-${suffix}`
    const requestUrl = `${server.httpBase}/thing`
    await server.addMock({
      id: endpointId,
      request: { method: 'GET', path: '/thing' },
      response: {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: '{"hello":"history"}',
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
    const urlInput = window.locator('[data-testid="url-input"]')
    await urlInput.waitFor({ state: 'visible' })
    await urlInput.fill(requestUrl)
    await expect(urlInput).toHaveValue(requestUrl)
    await urlInput.press('Enter')
    await expect(window.getByTestId('response-status')).toContainText('200', { timeout: 10_000 })
    expect((await server.waitForCalls(endpointId, 1)).count).toBe(1)

    await window.getByTestId('tab-history').click()
    const item = window.getByTestId('history-item').filter({ hasText: requestUrl })
    await expect(item).toHaveCount(1)

    await item.locator('button').first().click()
    await expect(window.getByTestId('history-banner')).toBeVisible()
    await expect(urlInput).toHaveValue(requestUrl)
    await expect(window.getByTestId('response-status')).toContainText('200')

    await item.hover()
    await item.getByRole('button', { name: 'Delete entry' }).click()
    await expect(window.getByTestId('history-item').filter({ hasText: requestUrl })).toHaveCount(0)
  })
})
