import { test, expect } from './fixtures'
import { reloadApp } from './helpers'

const runId = Date.now()
const initialEnvironmentName = `Env ${runId}`
const renamedEnvironmentName = `Env Renamed ${runId}`

test.describe('Environment and settings persistence', () => {
  test.describe.configure({ mode: 'serial' })

  test.afterAll(async ({ window }) => {
    await window.evaluate(async () => {
      await window.api.settings.set({
        key: 'general',
        value: {
          theme: 'dark',
          defaultTimeout: 30000,
          followRedirects: true,
          sslVerification: true,
          autoUpdate: true,
          historyEnabled: true,
          historyLimit: 500,
          cookiesEnabled: true,
        },
      })
    })
  })

  test('environment CRUD and activation survive an app reload', async ({ window }) => {
    await window.getByTestId('tab-environments').click()
    await window.getByRole('button', { name: 'New Environment' }).click()
    await window.getByPlaceholder('Environment name…').fill(initialEnvironmentName)
    await window.getByPlaceholder('Environment name…').press('Enter')

    await window.getByText(initialEnvironmentName, { exact: true }).click()
    const nameInput = window.locator('.drag-region input').first()
    await nameInput.fill(renamedEnvironmentName)
    await nameInput.press('Enter')
    await expect(window.getByText(renamedEnvironmentName, { exact: true })).toBeVisible()

    await window.getByRole('button', { name: 'Add variable' }).click()
    await window.getByPlaceholder('VARIABLE_NAME').fill('BASE_URL')
    await window.getByPlaceholder('value').fill('https://env.example.test')
    await window.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(window.getByRole('button', { name: 'Saved', exact: true })).toBeVisible()

    await window.getByRole('button', { name: `Set ${renamedEnvironmentName} as active` }).click()
    await expect(window.getByRole('button', { name: `Active environment: ${renamedEnvironmentName}` })).toBeVisible()

    await reloadApp(window)
    await window.getByTestId('tab-environments').click()
    await expect(window.getByRole('button', { name: `Active environment: ${renamedEnvironmentName}` })).toBeVisible()
    await window.getByText(renamedEnvironmentName, { exact: true }).click()
    await expect(window.locator('.drag-region input').first()).toHaveValue(renamedEnvironmentName)
    await expect(window.locator('input[value="BASE_URL"]')).toBeVisible()
    await expect(window.locator('input[value="https://env.example.test"]')).toBeVisible()

    await window.getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(window.getByText(renamedEnvironmentName, { exact: true })).toHaveCount(0)
  })

  test('general and history settings persist across reload and affect history capture', async ({ window, server }) => {
    const requestName = `History Disabled ${runId}`
    const collectionName = `History Settings ${runId}`
    const endpointId = `history-disabled-${runId}`
    const requestUrl = `${server.httpBase}/history-disabled`

    await server.addMock({
      id: endpointId,
      request: { method: 'GET', path: '/history-disabled' },
      response: {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true }),
      },
    })
    await window.evaluate(async () => {
      await window.api.history.clear()
    })

    await window.keyboard.press('Control+,')
    const modal = window.getByTestId('settings-modal')
    await expect(modal).toBeVisible()
    await modal.locator('#general-default-timeout-ms').fill('1234')
    await modal.getByTestId('history-enabled').uncheck()
    await window.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)

    await reloadApp(window)

    await window.keyboard.press('Control+,')
    const reopened = window.getByTestId('settings-modal')
    await expect(reopened.locator('#general-default-timeout-ms')).toHaveValue('1234')
    await expect(reopened.getByTestId('history-enabled')).not.toBeChecked()
    await window.keyboard.press('Escape')

    const collectionId = await window.evaluate(async (name: string) => {
      const collection = await window.api.collections.create({ name }) as { data: { id: string } }
      return collection.data.id
    }, collectionName)
    await window.evaluate(async ([collectionId, url, name]: [string, string, string]) => {
      const created = await window.api.requests.create({ folderId: collectionId, name, method: 'GET' }) as { data: { id: string } }
      await window.api.requests.update({ id: created.data.id, url })
    }, [collectionId, requestUrl, requestName] as [string, string, string])

    await reloadApp(window)
    await window.getByText(collectionName, { exact: true }).first().click()
    await window.getByText(requestName, { exact: true }).first().click()
    await window.getByTestId('send-button').click()
    await expect(window.getByTestId('response-status')).toContainText('200', { timeout: 10_000 })

    const calls = await server.waitForCalls(endpointId, 1)
    expect(calls.count).toBe(1)

    await window.getByTestId('tab-history').click()
    await expect(window.getByTestId('history-item').filter({ hasText: requestUrl })).toHaveCount(0)
  })
})
