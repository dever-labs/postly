import { test, expect } from './fixtures'

// Reset to a known state before each test: APIs tab active, search cleared
test.beforeEach(async ({ window }) => {
  // Ensure we're on the APIs tab
  const apisTab = window.locator('[data-testid="tab-apis"]')
  const isActive = await apisTab.evaluate((el) => el.className.includes('border-blue-500'))
  if (!isActive) await apisTab.click()
  // Clear any leftover search value
  const search = window.locator('[data-testid="sidebar-search"]')
  const val = await search.inputValue()
  if (val) await search.clear()
})

test.describe('Sidebar — tabs', () => {
  test('sidebar is visible on load', async ({ window }) => {
    await expect(window.locator('[data-testid="sidebar"]')).toBeVisible()
  })

  test('APIs tab is active by default', async ({ window }) => {
    const apisTab = window.locator('[data-testid="tab-apis"]')
    await expect(apisTab).toBeVisible()
    // Active tab has the blue border-bottom class
    await expect(apisTab).toHaveClass(/border-blue-500/)
  })

  test('Environments tab is visible', async ({ window }) => {
    await expect(window.locator('[data-testid="tab-environments"]')).toBeVisible()
  })

  test('clicking Environments tab makes it active', async ({ window }) => {
    const envTab = window.locator('[data-testid="tab-environments"]')
    await envTab.click()
    await expect(envTab).toHaveClass(/border-blue-500/)
    // APIs tab loses active state
    const apisTab = window.locator('[data-testid="tab-apis"]')
    await expect(apisTab).not.toHaveClass(/border-blue-500/)
  })

  test('clicking APIs tab restores it as active', async ({ window }) => {
    // Switch to environments first
    await window.locator('[data-testid="tab-environments"]').click()
    // Then switch back
    const apisTab = window.locator('[data-testid="tab-apis"]')
    await apisTab.click()
    await expect(apisTab).toHaveClass(/border-blue-500/)
  })
})

test.describe('Sidebar — search', () => {
  test('search input is visible in APIs tab', async ({ window }) => {
    await expect(window.locator('[data-testid="sidebar-search"]')).toBeVisible()
  })

  test('search input accepts text', async ({ window }) => {
    const input = window.locator('[data-testid="sidebar-search"]')
    await input.fill('pets')
    await expect(input).toHaveValue('pets')
  })

  test('clear button appears when input has a value', async ({ window }) => {
    const input = window.locator('[data-testid="sidebar-search"]')
    await input.fill('hello')
    // X clear button should appear
    await expect(window.locator('[data-testid="sidebar-search"] ~ button')).toBeVisible()
  })

  test('search input is hidden when switching to Environments tab', async ({ window }) => {
    await window.locator('[data-testid="tab-environments"]').click()
    await expect(window.locator('[data-testid="sidebar-search"]')).not.toBeVisible()
  })
})

test.describe('Sidebar — footer', () => {
  test('footer is visible in APIs tab', async ({ window }) => {
    await expect(window.locator('[data-testid="sidebar-footer"]')).toBeVisible()
  })

  test('export button is visible', async ({ window }) => {
    await expect(window.locator('[data-testid="btn-export"]')).toBeVisible()
  })

  test('import button is visible', async ({ window }) => {
    await expect(window.locator('[data-testid="btn-import"]')).toBeVisible()
  })

  test('settings button is visible', async ({ window }) => {
    await expect(window.locator('[data-testid="btn-settings"]')).toBeVisible()
  })

  test('settings button opens settings modal', async ({ window }) => {
    await window.locator('[data-testid="btn-settings"]').click()
    await expect(window.locator('[data-testid="settings-modal"]')).toBeVisible()
    // Close the modal so subsequent tests start with a clean state
    await window.locator('[data-testid="settings-modal"] button[aria-label="Close"]').click()
    await expect(window.locator('[data-testid="settings-modal"]')).not.toBeVisible()
  })
})

test.describe('Sidebar — connect source', () => {
  test('"Connect a source" button is visible in APIs tab', async ({ window }) => {
    await expect(window.locator('text=Connect a source')).toBeVisible()
  })
})
