import { test, expect } from './fixtures'

// On macOS the window uses titleBarStyle: 'hiddenInset', which overlays the
// traffic-light buttons (close/minimise/maximise) at roughly y=13–25px inside
// the window. The sidebar tab switcher must be pushed below that zone so the
// buttons remain clickable and visible.
//
// The sidebar starts with a drag strip (h-8, 28 px) on every platform so the
// draggable title area is consistent from left to right. The tab buttons
// therefore always start at y ≥ 28 px, clear of the traffic lights.

test.describe('Sidebar — traffic light clearance (macOS)', () => {
  test('APIs tab is positioned below the title strip', async ({ window }) => {
    const apisTab = window.locator('[data-testid="tab-apis"]')
    await expect(apisTab).toBeVisible()

    const box = await apisTab.boundingBox()
    expect(box).not.toBeNull()

    // Traffic lights occupy roughly y: 13–25 px with hiddenInset.
    expect(box!.y).toBeGreaterThanOrEqual(28)
  })

  test('Environments tab is positioned below the title strip', async ({ window }) => {
    const envTab = window.locator('[data-testid="tab-environments"]')
    await expect(envTab).toBeVisible()

    const box = await envTab.boundingBox()
    expect(box).not.toBeNull()

    expect(box!.y).toBeGreaterThanOrEqual(28)
  })

  test('tab buttons remain clickable after the drag strip is applied', async ({ window }) => {
    // Verify the tabs still function correctly — not just visible but interactive.
    const envTab = window.locator('[data-testid="tab-environments"]')
    await envTab.click()
    await expect(envTab).toHaveClass(/border-blue-500/)

    const apisTab = window.locator('[data-testid="tab-apis"]')
    await apisTab.click()
    await expect(apisTab).toHaveClass(/border-blue-500/)
  })
})
