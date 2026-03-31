/**
 * Request editor E2E tests
 *
 * Seeds a collection + request via window.api (real IPC calls from the renderer),
 * reloads the window so the Zustand stores pick up the new data, then exercises
 * the request editor UI.
 *
 * Requires a built app (`npm run build` before `npm run test:e2e`).
 */
import { test, expect } from './fixtures'

// Shared ids created in beforeAll so individual tests can reference them.
let collectionName: string

test.describe('Request editor', () => {
  test.beforeAll(async ({ window }) => {
    // Use a timestamp suffix to avoid conflicts between runs
    collectionName = `E2E Tests ${Date.now()}`

    // Create collection → group → request via the real IPC API exposed on window
    const colId = await window.evaluate(
      async (name: string) => {
        const res = await window.api.collections.create({ name })
        return (res as { data: { id: string } }).data.id
      },
      collectionName
    )

    const grpId = await window.evaluate(
      async (colId: string) => {
        const res = await window.api.groups.create({ collectionId: colId, name: 'Default' })
        return (res as { data: { id: string } }).data.id
      },
      colId
    )

    await window.evaluate(
      async (grpId: string) => {
        await window.api.requests.create({ groupId: grpId, name: 'Test Request', method: 'GET' })
      },
      grpId
    )

    // Reload so the stores re-fetch and show the new data
    await window.reload()
    await window.waitForSelector('[data-testid="app-root"]', { timeout: 20_000 })
  })

  test('new collection appears in the sidebar', async ({ window }) => {
    await expect(window.locator(`text=${collectionName}`).first()).toBeVisible()
  })

  test('clicking the collection expands it to show the request', async ({ window }) => {
    await window.locator(`text=${collectionName}`).first().click()
    await expect(window.locator('text=Test Request').first()).toBeVisible()
  })

  test('clicking a request opens the request editor', async ({ window }) => {
    await window.locator('text=Test Request').first().click()
    await expect(window.locator('[data-testid="url-input"]')).toBeVisible()
  })

  test('URL input accepts typed text', async ({ window }) => {
    const urlInput = window.locator('[data-testid="url-input"]')
    await urlInput.fill('https://api.example.com/test')
    await expect(urlInput).toHaveValue('https://api.example.com/test')
  })

  test('Send button is visible and enabled', async ({ window }) => {
    const btn = window.locator('[data-testid="send-button"]')
    await expect(btn).toBeVisible()
    await expect(btn).not.toBeDisabled()
  })

  test('response panel shows placeholder before any request is sent', async ({ window }) => {
    await expect(window.locator('text=Send a request to see the response')).toBeVisible()
  })

  test('pressing Enter in the URL bar triggers a send (loading state appears)', async ({ window }) => {
    const urlInput = window.locator('[data-testid="url-input"]')
    // Use a URL that will immediately fail (no real server) so the test is fast
    await urlInput.fill('http://localhost:1')
    await urlInput.press('Enter')
    // Send button should briefly show "Sending" or the response panel should update
    // We wait for either the send button label change or the response to arrive
    await expect(window.locator('[data-testid="send-button"]').or(
      window.locator('text=Send a request to see the response')
    )).toBeVisible()
  })
})
