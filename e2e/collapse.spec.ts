/**
 * Sidebar expand/collapse persistence E2E tests (Issue #11)
 *
 * Verifies that collection and source section collapse state survives a window
 * reload (simulating an app restart — the DB and localStorage persist across
 * reloads just as they do across process restarts).
 *
 * Requires a built app (`npm run build` before `npm run test:e2e`).
 */
import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'

// ── Helpers ──────────────────────────────────────────────────────────────────

async function createCollection(window: Page, name: string): Promise<string> {
  return window.evaluate(async (n: string) => {
    const res = await window.api.collections.create({ name: n })
    return (res as { data: { id: string } }).data.id
  }, name)
}

async function reload(window: Page): Promise<void> {
  await window.reload()
  await window.waitForSelector('[data-testid="app-root"]', { timeout: 20_000 })
}

// ── Collection collapse persistence ──────────────────────────────────────────

test.describe('Sidebar — collection collapse persistence', () => {
  let collectionId: string
  let collectionName: string

  test.beforeAll(async ({ window }) => {
    collectionName = `Collapse Test ${Date.now()}`
    collectionId = await createCollection(window, collectionName)
    await reload(window)
  })

  test('collection is expanded by default after creation', async ({ window }) => {
    await expect(window.locator(`[data-testid="collection-content-${collectionId}"]`)).toBeVisible()
  })

  test('clicking toggle collapses the collection', async ({ window }) => {
    await window.locator(`[data-testid="collection-toggle-${collectionId}"]`).click()
    await expect(window.locator(`[data-testid="collection-content-${collectionId}"]`)).not.toBeVisible()
  })

  test('collapsed state persists after reload', async ({ window }) => {
    await reload(window)
    await expect(window.locator(`[data-testid="collection-content-${collectionId}"]`)).not.toBeVisible()
  })

  test('clicking toggle expands the collection again', async ({ window }) => {
    await window.locator(`[data-testid="collection-toggle-${collectionId}"]`).click()
    await expect(window.locator(`[data-testid="collection-content-${collectionId}"]`)).toBeVisible()
  })

  test('expanded state persists after reload', async ({ window }) => {
    await reload(window)
    await expect(window.locator(`[data-testid="collection-content-${collectionId}"]`)).toBeVisible()
  })
})

// ── Source collapse persistence ───────────────────────────────────────────────

test.describe('Sidebar — source collapse persistence', () => {
  test.beforeAll(async ({ window }) => {
    // Ensure there is at least one local collection so the local source section is rendered
    const existing = await window.evaluate(async () => {
      const res = await window.api.collections.list()
      const data = res as { data: { collections: { id: string; source: string }[] } }
      return data.data.collections.filter((c) => c.source === 'local').length
    })
    if (existing === 0) {
      await createCollection(window, `Source Test ${Date.now()}`)
      await reload(window)
    }
  })

  test('local source section is visible by default', async ({ window }) => {
    await expect(window.locator('[data-testid="source-content-local"]')).toBeVisible()
  })

  test('clicking source toggle collapses the local section', async ({ window }) => {
    await window.locator('[data-testid="source-toggle-local"]').click()
    await expect(window.locator('[data-testid="source-content-local"]')).not.toBeVisible()
  })

  test('collapsed source state persists after reload', async ({ window }) => {
    await reload(window)
    await expect(window.locator('[data-testid="source-content-local"]')).not.toBeVisible()
  })

  test('clicking source toggle expands the section again', async ({ window }) => {
    await window.locator('[data-testid="source-toggle-local"]').click()
    await expect(window.locator('[data-testid="source-content-local"]')).toBeVisible()
  })

  test('expanded source state persists after reload', async ({ window }) => {
    await reload(window)
    await expect(window.locator('[data-testid="source-content-local"]')).toBeVisible()
  })
})
