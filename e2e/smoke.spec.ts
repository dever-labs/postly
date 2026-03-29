import { test, expect } from './fixtures'

test.describe('App launch', () => {
  test('opens a window', async ({ electronApp }) => {
    // firstWindow() waits until the window is actually created
    const win = await electronApp.firstWindow()
    expect(win).toBeTruthy()
  })

  test('window has correct title', async ({ window }) => {
    const title = await window.title()
    expect(title).toMatch(/[Pp]ostly/)
  })

  test('app root element is visible', async ({ window }) => {
    await expect(window.locator('[data-testid="app-root"]')).toBeVisible()
  })

  test('app takes up the full viewport', async ({ window }) => {
    const root = window.locator('[data-testid="app-root"]')
    const box = await root.boundingBox()
    expect(box).not.toBeNull()
    // Should occupy a substantial portion of the window
    expect(box!.width).toBeGreaterThan(800)
    expect(box!.height).toBeGreaterThan(400)
  })
})
