import { test, expect } from './fixtures'

// On macOS the window uses titleBarStyle: 'hiddenInset', which overlays the
// traffic-light buttons (close/minimise/maximise) at roughly y=13–25px inside
// the window. The sidebar tab switcher must be pushed below that zone so the
// buttons remain clickable and visible.
//
// The fix adds `pt-8` (32 px) to the tab container on darwin. This test
// verifies the resulting layout on every platform:
//   • macOS  → tab buttons must start at y ≥ 28 px (clear of traffic lights)
//   • others → tab buttons start near y = 0 (no unnecessary extra padding)

test.describe('Sidebar — traffic light clearance (macOS)', () => {
  test('APIs tab is positioned below the traffic-light zone on macOS', async ({ window }) => {
    const apisTab = window.locator('[data-testid="tab-apis"]')
    await expect(apisTab).toBeVisible()

    const box = await apisTab.boundingBox()
    expect(box).not.toBeNull()

    if (process.platform === 'darwin') {
      // Traffic lights occupy roughly y: 13–25 px with hiddenInset.
      // pt-8 (32 px) on the container means the tab button starts at ≥ 32 px.
      expect(box!.y).toBeGreaterThanOrEqual(28)
    } else {
      // No extra padding on other platforms — tabs sit near the top.
      expect(box!.y).toBeLessThan(28)
    }
  })

  test('Environments tab is positioned below the traffic-light zone on macOS', async ({ window }) => {
    const envTab = window.locator('[data-testid="tab-environments"]')
    await expect(envTab).toBeVisible()

    const box = await envTab.boundingBox()
    expect(box).not.toBeNull()

    if (process.platform === 'darwin') {
      expect(box!.y).toBeGreaterThanOrEqual(28)
    } else {
      expect(box!.y).toBeLessThan(28)
    }
  })

  test('tab buttons remain clickable after macOS padding is applied', async ({ window }) => {
    // Verify the tabs still function correctly — not just visible but interactive.
    const envTab = window.locator('[data-testid="tab-environments"]')
    await envTab.click()
    await expect(envTab).toHaveClass(/border-blue-500/)

    const apisTab = window.locator('[data-testid="tab-apis"]')
    await apisTab.click()
    await expect(apisTab).toHaveClass(/border-blue-500/)
  })
})
