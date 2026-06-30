/**
 * Request send & cancellation E2E tests
 *
 * Uses Mockly to serve controlled HTTP responses:
 *  - A fast endpoint returns immediately with JSON.
 *  - A slow endpoint delays 10s, letting us click Cancel before it completes.
 *
 * Requires a built app (`npm run build` before `npm run test:e2e`).
 * The Mockly binary is resolved automatically via @dever-labs/mockly-driver.
 */
import { test, expect } from './fixtures'
import { MocklyServer } from '../src/main/services/__tests__/helpers/mockly'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Poll Mockly's HTTP server until it actually accepts connections. */
async function waitForMocklyHttp(server: MocklyServer, timeoutMs = 8_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${server.httpBase}/fast`, { signal: AbortSignal.timeout(500) })
      if (r.status !== 0) return   // any HTTP response means the server is up
    } catch { /* not ready yet */ }
    await new Promise<void>((r) => setTimeout(r, 100))
  }
  throw new Error(`Mockly HTTP server did not become ready within ${timeoutMs}ms`)
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let mockly: MocklyServer
const MOCK_FAST_ID = 'get-fast'
const MOCK_SLOW_ID = 'get-slow'

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('Send & cancel request', () => {
  test.beforeAll(async ({ window }) => {
    mockly = await MocklyServer.ensure()

    await mockly.addMock({
      id: MOCK_FAST_ID,
      request: { method: 'GET', path: '/fast' },
      response: {
        status: 200,
        body: JSON.stringify({ message: 'hello from mockly' }),
        headers: { 'Content-Type': 'application/json' },
      },
    })

    await mockly.addMock({
      id: MOCK_SLOW_ID,
      request: { method: 'GET', path: '/slow' },
      response: {
        status: 200,
        body: JSON.stringify({ message: 'this should be cancelled' }),
        headers: { 'Content-Type': 'application/json' },
        delay: '10s',
      },
    })

    // Wait for Mockly HTTP server to be fully ready (management API readiness
    // does not guarantee HTTP server is accepting connections yet)
    await waitForMocklyHttp(mockly)

    // Seed a collection + request so the editor is ready
    const colId = await window.evaluate(async () => {
      const res = await window.api.collections.create({ name: 'E2E Send & Cancel' })
      return (res as { data: { id: string } }).data.id
    })
    const grpId = await window.evaluate(async (colId: string) => {
      const res = await window.api.groups.create({ collectionId: colId, name: 'Default' })
      return (res as { data: { id: string } }).data.id
    }, colId)
    await window.evaluate(async (grpId: string) => {
      await window.api.requests.create({ groupId: grpId, name: 'Mockly Request', method: 'GET' })
    }, grpId)

    await window.reload()
    await window.waitForSelector('[data-testid="app-root"]', { timeout: 20_000 })
  })

  test.afterAll(async () => {
    await mockly?.stop()
  })

  test.beforeEach(async ({ window }) => {
    test.skip(!mocklyAvailable, `Mockly binary not found at bin/${binName}`)
    await mockly.clearAllCalls()

    // Open the request in the editor
    await window.locator('text=E2E Send & Cancel').first().click()
    await window.locator('text=Mockly Request').first().click()
    const urlInput = window.locator('[data-testid="url-input"]')
    await urlInput.waitFor({ state: 'visible' })
    // Allow async draft loading (setActiveRequest) to settle before each test
    // fills the URL, so the draft doesn't overwrite the test's value.
    await window.waitForTimeout(400)
  })

  test('successful request shows response with status 200', async ({ window }) => {
    const url = `${mockly.httpBase}/fast`
    const urlInput = window.locator('[data-testid="url-input"]')
    await urlInput.fill(url)
    await expect(urlInput).toHaveValue(url)
    await window.waitForTimeout(200)   // wait for 100ms debounce to flush URL to store
    await window.locator('[data-testid="send-button"]').click()

    // Loading spinner should appear briefly then resolve
    await expect(window.locator('[data-testid="response-panel"]')).toBeVisible({ timeout: 10_000 })
    await expect(window.locator('[data-testid="response-status"]')).toContainText('200')

    // Mockly should have received exactly one call
    const calls = await mockly.waitForCalls(MOCK_FAST_ID, 1)
    expect(calls.calls).toHaveLength(1)
  })

  test('response body contains the JSON returned by mockly', async ({ window }) => {
    const url = `${mockly.httpBase}/fast`
    const urlInput = window.locator('[data-testid="url-input"]')
    await urlInput.fill(url)
    await expect(urlInput).toHaveValue(url)
    await window.waitForTimeout(200)   // flush debounce
    await window.locator('[data-testid="send-button"]').click()

    await expect(window.locator('[data-testid="response-panel"]')).toBeVisible({ timeout: 10_000 })
    // The pretty or raw tab should contain the response body
    await expect(window.locator('[data-testid="response-panel"]')).toContainText('hello from mockly')
  })

  test('send button is replaced by Cancel while a slow request is in flight', async ({ window }) => {
    const url = `${mockly.httpBase}/slow`
    const urlInput = window.locator('[data-testid="url-input"]')
    await urlInput.fill(url)
    await expect(urlInput).toHaveValue(url)
    await window.waitForTimeout(200)   // flush debounce
    await window.locator('[data-testid="send-button"]').click()

    // Cancel button must appear while the 10s delay is running
    await expect(window.locator('[data-testid="cancel-button"]')).toBeVisible({ timeout: 8_000 })
    await expect(window.locator('[data-testid="send-button"]')).not.toBeVisible()

    // Loading spinner shown in response panel
    await expect(window.locator('[data-testid="response-loading"]')).toBeVisible()

    // Clean up: cancel so the slow request doesn't block afterAll
    await window.locator('[data-testid="cancel-button"]').click()
    await expect(window.locator('[data-testid="send-button"]')).toBeVisible({ timeout: 10_000 })
  })

  test('clicking Cancel aborts the request and restores Send button', async ({ window }) => {
    const url = `${mockly.httpBase}/slow`
    const urlInput = window.locator('[data-testid="url-input"]')
    await urlInput.fill(url)
    await expect(urlInput).toHaveValue(url)
    await window.waitForTimeout(200)   // flush debounce
    await window.locator('[data-testid="send-button"]').click()

    await expect(window.locator('[data-testid="cancel-button"]')).toBeVisible({ timeout: 8_000 })
    await window.locator('[data-testid="cancel-button"]').click()

    // Send button returns
    await expect(window.locator('[data-testid="send-button"]')).toBeVisible({ timeout: 10_000 })

    // Response panel shows an error/cancelled state (not the empty placeholder)
    await expect(window.locator('[data-testid="response-empty"]')).not.toBeVisible()
    await expect(window.locator('[data-testid="response-panel"]')).toBeVisible()
  })

  test('pressing Enter in URL bar sends the request', async ({ window }) => {
    const url = `${mockly.httpBase}/fast`
    const urlInput = window.locator('[data-testid="url-input"]')
    await urlInput.fill(url)
    await expect(urlInput).toHaveValue(url)
    await urlInput.press('Enter')

    await expect(window.locator('[data-testid="response-panel"]')).toBeVisible({ timeout: 10_000 })
    await expect(window.locator('[data-testid="response-status"]')).toContainText('200')
  })

  test('second send is blocked while a request is in flight', async ({ window }) => {
    const url = `${mockly.httpBase}/slow`
    const urlInput = window.locator('[data-testid="url-input"]')
    await urlInput.fill(url)
    await expect(urlInput).toHaveValue(url)
    await window.waitForTimeout(200)   // flush debounce
    await window.locator('[data-testid="send-button"]').click()

    await expect(window.locator('[data-testid="cancel-button"]')).toBeVisible({ timeout: 8_000 })

    // The Send button is gone — there's nothing to double-click
    // Verify only one call was made so far despite showing Cancel
    const calls = await mockly.getCalls(MOCK_SLOW_ID)
    expect(calls.count).toBe(1)

    // Cancel and wait for idle
    await window.locator('[data-testid="cancel-button"]').click()
    await expect(window.locator('[data-testid="send-button"]')).toBeVisible({ timeout: 10_000 })
  })
})
