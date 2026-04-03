/**
 * Draft cache, undo history and dirty indicator E2E tests
 *
 * Seeds a collection + group + request via window.api, then exercises the
 * draft cache (auto-save on change, restore after reload), dirty indicator
 * (amber save button, sidebar orange dot), Ctrl+Z undo, save and discard.
 *
 * Requires a built app (`npm run build` before `npm run test:e2e`).
 */
import { test, expect } from './fixtures'

const SAVED_URL = 'https://api.example.com/saved'
const DRAFT_URL = 'https://api.example.com/draft'

let collectionName: string
let requestName: string

test.describe('Draft cache & dirty indicator', () => {
  test.beforeAll(async ({ window }) => {
    const ts = Date.now()
    collectionName = `Draft Col ${ts}`
    requestName = `Draft Req ${ts}`

    const colId = await window.evaluate(async (name: string) => {
      const res = await window.api.collections.create({ name })
      return (res as { data: { id: string } }).data.id
    }, collectionName)

    const grpId = await window.evaluate(async (colId: string) => {
      const res = await window.api.groups.create({ collectionId: colId, name: 'Default' })
      return (res as { data: { id: string } }).data.id
    }, colId)

    await window.evaluate(
      async ({ grpId, name, url }: { grpId: string; name: string; url: string }) => {
        const res = await window.api.requests.create({ groupId: grpId, name, method: 'GET' })
        const id = (res as { data: { id: string } }).data.id
        await window.api.requests.update({ id, url })
      },
      { grpId, name: requestName, url: SAVED_URL }
    )

    await window.reload()
    await window.waitForSelector('[data-testid="app-root"]', { timeout: 20_000 })

    // Expand the collection, then click the request item
    await window.locator(`text=${collectionName}`).first().click()
    await window.locator(`text=${requestName}`).first().waitFor({ state: 'visible' })
    await window.locator(`text=${requestName}`).first().click()
    await window.locator('[data-testid="url-input"]').waitFor({ state: 'visible' })
  })

  test('save button starts clean (not amber)', async ({ window }) => {
    const saveBtn = window.locator('[data-testid="request-save-button"]')
    await expect(saveBtn).toBeVisible()
    await expect(saveBtn).not.toHaveClass(/text-amber-400/)
  })

  test('sidebar shows no dirty dot on clean request', async ({ window }) => {
    await expect(window.locator('[data-testid="request-dirty-dot"]')).not.toBeVisible()
  })

  test('editing URL makes save button amber', async ({ window }) => {
    const urlInput = window.locator('[data-testid="url-input"]')
    await urlInput.fill(DRAFT_URL)
    const saveBtn = window.locator('[data-testid="request-save-button"]')
    await expect(saveBtn).toHaveClass(/text-amber-400/)
  })

  test('dirty dot appears in sidebar after edit', async ({ window }) => {
    await expect(window.locator('[data-testid="request-dirty-dot"]')).toBeVisible()
  })

  test('discard button appears when dirty', async ({ window }) => {
    await expect(window.locator('[data-testid="request-discard-button"]')).toBeVisible()
  })

  test('draft persists after page reload', async ({ window }) => {
    // Ensure the DRAFT_URL is set and wait for the 500ms debounce to persist to SQLite
    const urlInput = window.locator('[data-testid="url-input"]')
    await urlInput.fill(DRAFT_URL)
    await window.waitForTimeout(700)

    // Reload simulates reopening the app — the draft should be restored
    await window.reload()
    await window.waitForSelector('[data-testid="app-root"]', { timeout: 20_000 })

    await window.locator(`text=${collectionName}`).first().click()
    await window.locator(`text=${requestName}`).first().waitFor({ state: 'visible' })
    await window.locator(`text=${requestName}`).first().click()
    await urlInput.waitFor({ state: 'visible' })

    await expect(urlInput).toHaveValue(DRAFT_URL)
  })

  test('dirty indicator is still shown after reload with draft', async ({ window }) => {
    await expect(window.locator('[data-testid="request-dirty-dot"]')).toBeVisible()
    await expect(window.locator('[data-testid="request-save-button"]')).toHaveClass(/text-amber-400/)
  })

  test('Ctrl+Z undoes the URL change', async ({ window }) => {
    // Start from a known dirty state: fill the URL then undo without leaving the input
    const urlInput = window.locator('[data-testid="url-input"]')
    await urlInput.fill('https://api.example.com/to-undo')
    // Ctrl+Z fires the window-level handler — note: focus remains in the url input
    // but we removed the input-guard from RequestEditor so it fires from anywhere
    await window.keyboard.press('Control+z')
    // After undo, value should change (not necessarily to DRAFT_URL; depends on stack)
    const value = await urlInput.inputValue()
    expect(value).not.toBe('https://api.example.com/to-undo')
  })

  test('save button clears dirty and removes dot', async ({ window }) => {
    // Make a clean edit then save via Ctrl+S
    const urlInput = window.locator('[data-testid="url-input"]')
    await urlInput.fill(DRAFT_URL)
    await window.keyboard.press('Control+s')

    const saveBtn = window.locator('[data-testid="request-save-button"]')
    await expect(saveBtn).not.toHaveClass(/text-amber-400/, { timeout: 5_000 })
    await expect(window.locator('[data-testid="request-dirty-dot"]')).not.toBeVisible()
    await expect(window.locator('[data-testid="request-discard-button"]')).not.toBeVisible()
  })

  test('discard reverts URL to saved state', async ({ window }) => {
    const urlInput = window.locator('[data-testid="url-input"]')
    // Edit the URL to make it dirty again
    await urlInput.fill('https://api.example.com/unsaved')
    // Wait for dirty state
    await expect(window.locator('[data-testid="request-discard-button"]')).toBeVisible()
    // Click discard
    await window.locator('[data-testid="request-discard-button"]').click()
    // Should revert to the last saved URL (DRAFT_URL, which we saved above)
    await expect(urlInput).toHaveValue(DRAFT_URL)
    await expect(window.locator('[data-testid="request-save-button"]')).not.toHaveClass(/text-amber-400/)
    await expect(window.locator('[data-testid="request-dirty-dot"]')).not.toBeVisible()
  })
})
