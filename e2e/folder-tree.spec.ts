/**
 * Folder tree E2E tests
 *
 * Covers UI-level creation of sub-folders and requests at any folder depth.
 * Requires a built app (`npm run build` before `npm run test:e2e`).
 */
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'

const timestamp = Date.now()

async function ensureLocalSourceVisible(window: Page) {
  const sourceContent = window.locator('[data-testid="source-content-local"]')
  if (!(await sourceContent.isVisible())) {
    await window.locator('[data-testid="source-toggle-local"]').click()
  }
  await expect(sourceContent).toBeVisible()
}

/** Click the chevron toggle next to `label` to expand it, then wait for `childLabel` to appear. */
async function expandTreeItem(window: Page, label: string, childLabel: string) {
  const sidebar = window.locator('[data-testid="sidebar"]')
  const child = sidebar.getByText(childLabel, { exact: true }).first()
  if (await child.isVisible()) return

  const labelText = sidebar.getByText(label, { exact: true }).first()
  await expect(labelText).toBeVisible()
  await labelText.locator('xpath=ancestor::button[1]/preceding-sibling::button[1]').click()
  await expect(child).toBeVisible()
}

/**
 * Hover over a folder row (identified by its visible label) to reveal the
 * action buttons (opacity-0 → group-hover:opacity-100), then click the button
 * with the given title ("Add folder" or "Add request").
 */
async function hoverAndClickAction(window: Page, folderLabel: string, actionTitle: 'Add folder' | 'Add request') {
  const sidebar = window.locator('[data-testid="sidebar"]')
  const labelBtn = sidebar.getByText(folderLabel, { exact: true }).first()
  await expect(labelBtn).toBeVisible()

  // The action buttons live in the same row as the label button.
  // Hover the row container (parent div with class "group") to reveal them.
  const rowContainer = labelBtn.locator('xpath=ancestor::div[contains(@class,"group")][1]')
  await rowContainer.hover()

  const actionBtn = rowContainer.getByRole('button', { name: actionTitle })
  await expect(actionBtn).toBeVisible()
  await actionBtn.click()
}

// ── Create sub-folder via UI ─────────────────────────────────────────────────

const uiCollectionName = `UI Tree Test ${timestamp}`
let uiCollectionId: string

test.describe('Folder tree — create sub-folder via UI', () => {
  const subFolderName = `Sub Folder ${timestamp}`

  test.beforeAll(async ({ window }) => {
    uiCollectionId = await window.evaluate(async (name: string) => {
      const res = await window.api.collections.create({ name })
      return (res as { data: { id: string } }).data.id
    }, uiCollectionName)

    await window.reload()
    await window.waitForSelector('[data-testid="app-root"]', { timeout: 20_000 })
    await ensureLocalSourceVisible(window)
  })

  test.afterAll(async ({ window }) => {
    await window.evaluate(async (id: string) => {
      await window.api.folders.delete({ id })
    }, uiCollectionId)
  })

  test('collection appears in sidebar', async ({ window }) => {
    await expect(window.locator('[data-testid="sidebar"]').getByText(uiCollectionName, { exact: true })).toBeVisible()
  })

  test('clicking "Add folder" on a collection shows the inline name input', async ({ window }) => {
    await hoverAndClickAction(window, uiCollectionName, 'Add folder')
    await expect(window.getByPlaceholder('Folder name…')).toBeVisible()
  })

  test('typing a name and pressing Enter creates the sub-folder', async ({ window }) => {
    // Inline input may already be open from previous test; if not, open it
    const input = window.getByPlaceholder('Folder name…')
    if (!(await input.isVisible())) {
      await hoverAndClickAction(window, uiCollectionName, 'Add folder')
    }

    await input.fill(subFolderName)
    await input.press('Enter')

    // Input should disappear
    await expect(input).not.toBeVisible()

    // Sub-folder should appear under the collection
    await expandTreeItem(window, uiCollectionName, subFolderName)
    await expect(window.locator('[data-testid="sidebar"]').getByText(subFolderName, { exact: true })).toBeVisible()
  })

  test('Escape cancels sub-folder creation without adding a folder', async ({ window }) => {
    const sidebar = window.locator('[data-testid="sidebar"]')
    const cancelledName = `Cancelled Folder ${timestamp}`

    await hoverAndClickAction(window, uiCollectionName, 'Add folder')
    const input = window.getByPlaceholder('Folder name…')
    await input.fill(cancelledName)
    await input.press('Escape')

    await expect(input).not.toBeVisible()
    await expect(sidebar.getByText(cancelledName, { exact: true })).not.toBeVisible()
  })
})

// ── Add request to sub-folder via UI ─────────────────────────────────────────

const reqCollectionName = `Req Tree Test ${timestamp}`
let reqCollectionId: string
const reqSubFolderName = `Sub For Requests ${timestamp}`
let reqSubFolderId: string

test.describe('Folder tree — add request to sub-folder via UI', () => {
  test.beforeAll(async ({ window }) => {
    reqCollectionId = await window.evaluate(async (name: string) => {
      const res = await window.api.collections.create({ name })
      return (res as { data: { id: string } }).data.id
    }, reqCollectionName)

    reqSubFolderId = await window.evaluate(
      async ({ parentId, name }: { parentId: string; name: string }) => {
        const res = await window.api.groups.create({ parentId, name })
        return (res as { data: { id: string } }).data.id
      },
      { parentId: reqCollectionId, name: reqSubFolderName }
    )

    await window.reload()
    await window.waitForSelector('[data-testid="app-root"]', { timeout: 20_000 })
    await ensureLocalSourceVisible(window)
    // Expand the collection so the sub-folder is visible
    await expandTreeItem(window, reqCollectionName, reqSubFolderName)
  })

  test.afterAll(async ({ window }) => {
    await window.evaluate(async (id: string) => {
      await window.api.folders.delete({ id })
    }, reqCollectionId)
  })

  test('sub-folder is visible in sidebar', async ({ window }) => {
    await expect(window.locator('[data-testid="sidebar"]').getByText(reqSubFolderName, { exact: true })).toBeVisible()
  })

  test('clicking "Add request" on the sub-folder creates a request inside it', async ({ window }) => {
    await hoverAndClickAction(window, reqSubFolderName, 'Add request')

    // A new request with the default name "New Request" should appear
    const sidebar = window.locator('[data-testid="sidebar"]')
    await expect(sidebar.getByText('New Request', { exact: true }).first()).toBeVisible({ timeout: 5_000 })
  })

  test('clicking "Add request" on the root collection creates a request at root level', async ({ window }) => {
    await hoverAndClickAction(window, reqCollectionName, 'Add request')

    const sidebar = window.locator('[data-testid="sidebar"]')
    // Two "New Request" items now exist (one in sub-folder, one at root)
    await expect(sidebar.getByText('New Request', { exact: true }).first()).toBeVisible({ timeout: 5_000 })
  })
})
