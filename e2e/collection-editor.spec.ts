/**
 * Collection & Group editor E2E tests
 *
 * Covers dirty indicator (orange dot in sidebar), save button state,
 * discard button, draft persistence across reload, and Ctrl+Z undo.
 *
 * Requires a built app (`npm run build` before `npm run test:e2e`).
 */
import { test, expect } from './fixtures'

const SAVED_NAME = `E2E Col`
const EDITED_NAME = `E2E Col Edited`

let collectionId: string
let groupId: string
let collectionName: string
let groupName: string

test.describe('Collection editor', () => {
  test.beforeAll(async ({ window }) => {
    const ts = Date.now()
    collectionName = `${SAVED_NAME} ${ts}`
    groupName = `E2E Grp ${ts}`

    collectionId = await window.evaluate(async (name: string) => {
      const res = await window.api.collections.create({ name })
      return (res as { data: { id: string } }).data.id
    }, collectionName)

    groupId = await window.evaluate(
      async ({ colId, name }: { colId: string; name: string }) => {
        const res = await window.api.groups.create({ collectionId: colId, name })
        return (res as { data: { id: string } }).data.id
      },
      { colId: collectionId, name: groupName }
    )

    await window.reload()
    await window.waitForSelector('[data-testid="app-root"]', { timeout: 20_000 })

    // Open the collection editor by clicking the collection name
    await window.locator(`text=${collectionName}`).first().click()
    await window.locator('[data-testid="collection-name-input"]').waitFor({ state: 'visible' })
  })

  test('save button starts clean when collection is opened', async ({ window }) => {
    const saveBtn = window.locator('[data-testid="collection-save-button"]')
    await expect(saveBtn).toBeVisible()
    await expect(saveBtn).not.toHaveClass(/bg-blue-600/)
  })

  test('sidebar shows no dirty dot on clean collection', async ({ window }) => {
    await expect(window.locator('[data-testid="collection-dirty-dot"]')).not.toBeVisible()
  })

  test('editing name makes save button blue', async ({ window }) => {
    const nameInput = window.locator('[data-testid="collection-name-input"]')
    await nameInput.fill(EDITED_NAME)
    await expect(window.locator('[data-testid="collection-save-button"]')).toHaveClass(/bg-blue-600/)
  })

  test('dirty dot appears in sidebar after edit', async ({ window }) => {
    await expect(window.locator('[data-testid="collection-dirty-dot"]')).toBeVisible()
  })

  test('discard button appears when dirty', async ({ window }) => {
    await expect(window.locator('[data-testid="collection-discard-button"]')).toBeVisible()
  })

  test('draft persists after reload', async ({ window }) => {
    const nameInput = window.locator('[data-testid="collection-name-input"]')
    await nameInput.fill(EDITED_NAME)
    await window.waitForTimeout(700) // wait for 500ms draft debounce

    await window.reload()
    await window.waitForSelector('[data-testid="app-root"]', { timeout: 20_000 })

    await window.locator(`text=${collectionName}`).first().click()
    await nameInput.waitFor({ state: 'visible' })

    await expect(nameInput).toHaveValue(EDITED_NAME)
  })

  test('dirty indicator shown after reload with draft', async ({ window }) => {
    await expect(window.locator('[data-testid="collection-dirty-dot"]')).toBeVisible()
    await expect(window.locator('[data-testid="collection-save-button"]')).toHaveClass(/bg-blue-600/)
  })

  test('Ctrl+Z undoes name change', async ({ window }) => {
    const nameInput = window.locator('[data-testid="collection-name-input"]')
    await nameInput.fill('Temporary name')
    // Defocus the input so the onKeyDown handler on the container fires
    await window.evaluate(() => { (document.activeElement as HTMLElement)?.blur() })
    await window.keyboard.press('Control+z')
    const value = await nameInput.inputValue()
    expect(value).not.toBe('Temporary name')
  })

  test('save clears dirty and removes dot', async ({ window }) => {
    const nameInput = window.locator('[data-testid="collection-name-input"]')
    await nameInput.fill(EDITED_NAME)
    await window.locator('[data-testid="collection-save-button"]').click()

    await expect(window.locator('[data-testid="collection-save-button"]')).not.toHaveClass(/bg-blue-600/, { timeout: 5_000 })
    await expect(window.locator('[data-testid="collection-dirty-dot"]')).not.toBeVisible()
    await expect(window.locator('[data-testid="collection-discard-button"]')).not.toBeVisible()
  })

  test('discard reverts name to saved state', async ({ window }) => {
    const nameInput = window.locator('[data-testid="collection-name-input"]')
    await nameInput.fill('Unsaved name change')
    await expect(window.locator('[data-testid="collection-discard-button"]')).toBeVisible()
    await window.locator('[data-testid="collection-discard-button"]').click()

    await expect(nameInput).toHaveValue(EDITED_NAME)
    await expect(window.locator('[data-testid="collection-save-button"]')).not.toHaveClass(/bg-blue-600/)
    await expect(window.locator('[data-testid="collection-dirty-dot"]')).not.toBeVisible()
  })
})

test.describe('Group editor', () => {
  const EDITED_GROUP_NAME = 'E2E Grp Edited'

  test.beforeAll(async ({ window }) => {
    // Reload to start from a clean state after the collection editor tests
    await window.reload()
    await window.waitForSelector('[data-testid="app-root"]', { timeout: 20_000 })

    // Expand the collection only if it isn't already expanded
    const content = window.locator(`[data-testid="collection-content-${collectionId}"]`)
    const isExpanded = await content.isVisible()
    if (!isExpanded) {
      await window.locator(`[data-testid="collection-toggle-${collectionId}"]`).click()
    }
    await window.locator(`text=${groupName}`).first().waitFor({ state: 'visible' })
    await window.locator(`text=${groupName}`).first().click()
    await window.locator('[data-testid="group-name-input"]').waitFor({ state: 'visible' })
  })

  test('save button starts clean when group is opened', async ({ window }) => {
    const saveBtn = window.locator('[data-testid="group-save-button"]')
    await expect(saveBtn).toBeVisible()
    await expect(saveBtn).not.toHaveClass(/bg-blue-600/)
  })

  test('sidebar shows no dirty dot on clean group', async ({ window }) => {
    await expect(window.locator('[data-testid="group-dirty-dot"]')).not.toBeVisible()
  })

  test('editing name makes save button blue', async ({ window }) => {
    const nameInput = window.locator('[data-testid="group-name-input"]')
    await nameInput.fill(EDITED_GROUP_NAME)
    await expect(window.locator('[data-testid="group-save-button"]')).toHaveClass(/bg-blue-600/)
  })

  test('dirty dot appears in sidebar after group edit', async ({ window }) => {
    await expect(window.locator('[data-testid="group-dirty-dot"]')).toBeVisible()
  })

  test('discard button appears when group is dirty', async ({ window }) => {
    await expect(window.locator('[data-testid="group-discard-button"]')).toBeVisible()
  })

  test('group draft persists after reload', async ({ window }) => {
    const nameInput = window.locator('[data-testid="group-name-input"]')
    await nameInput.fill(EDITED_GROUP_NAME)
    await window.waitForTimeout(700)

    await window.reload()
    await window.waitForSelector('[data-testid="app-root"]', { timeout: 20_000 })

    const content = window.locator(`[data-testid="collection-content-${collectionId}"]`)
    const isExpanded = await content.isVisible()
    if (!isExpanded) {
      await window.locator(`[data-testid="collection-toggle-${collectionId}"]`).click()
    }
    await window.locator(`text=${groupName}`).first().waitFor({ state: 'visible' })
    await window.locator(`text=${groupName}`).first().click()
    await nameInput.waitFor({ state: 'visible' })

    await expect(nameInput).toHaveValue(EDITED_GROUP_NAME)
  })

  test('dirty indicator shown after reload with group draft', async ({ window }) => {
    await expect(window.locator('[data-testid="group-dirty-dot"]')).toBeVisible()
    await expect(window.locator('[data-testid="group-save-button"]')).toHaveClass(/bg-blue-600/)
  })

  test('Ctrl+Z undoes group name change', async ({ window }) => {
    const nameInput = window.locator('[data-testid="group-name-input"]')
    await nameInput.fill('Temporary group name')
    await window.evaluate(() => { (document.activeElement as HTMLElement)?.blur() })
    await window.keyboard.press('Control+z')
    const value = await nameInput.inputValue()
    expect(value).not.toBe('Temporary group name')
  })

  test('save clears group dirty and removes dot', async ({ window }) => {
    const nameInput = window.locator('[data-testid="group-name-input"]')
    await nameInput.fill(EDITED_GROUP_NAME)
    await window.locator('[data-testid="group-save-button"]').click()

    await expect(window.locator('[data-testid="group-save-button"]')).not.toHaveClass(/bg-blue-600/, { timeout: 5_000 })
    await expect(window.locator('[data-testid="group-dirty-dot"]')).not.toBeVisible()
    await expect(window.locator('[data-testid="group-discard-button"]')).not.toBeVisible()
  })

  test('discard reverts group name to saved state', async ({ window }) => {
    const nameInput = window.locator('[data-testid="group-name-input"]')
    await nameInput.fill('Unsaved group name')
    await expect(window.locator('[data-testid="group-discard-button"]')).toBeVisible()
    await window.locator('[data-testid="group-discard-button"]').click()

    await expect(nameInput).toHaveValue(EDITED_GROUP_NAME)
    await expect(window.locator('[data-testid="group-save-button"]')).not.toHaveClass(/bg-blue-600/)
    await expect(window.locator('[data-testid="group-dirty-dot"]')).not.toBeVisible()
  })
})
