/**
 * Title bar layout: with the native title bar hidden, the update banner and the window controls
 * must not overlap, and the banner must be usable to drag the window.
 */
import { test, expect } from './fixtures'

test.describe('update banner and window controls', () => {
  test('controls stay in the top-right corner and clear the banner', async ({ electronApp, window }) => {
    test.skip(process.platform === 'darwin', 'macOS uses the native traffic lights')

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('postly:updater:event', { type: 'available', version: '9.9.9' })
    })
    const banner = window.locator('[data-testid="update-banner"]')
    await expect(banner).toBeVisible()

    const geometry = await window.evaluate(() => {
      const rect = (el: Element | null) => { const r = el!.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, height: r.height } }
      const banner = document.querySelector('[data-testid="update-banner"]')!
      const close = document.querySelector('button[aria-label="Close"][title="Close"]')
      const dismiss = [...banner.querySelectorAll('button')].pop()!
      const dismissRect = dismiss.getBoundingClientRect()
      const hit = document.elementFromPoint(dismissRect.left + dismissRect.width / 2, dismissRect.top + dismissRect.height / 2)
      return {
        viewport: window.innerWidth,
        banner: rect(banner),
        close: rect(close),
        dismissReachable: hit === dismiss || dismiss.contains(hit),
        bannerRegion: getComputedStyle(banner).getPropertyValue('-webkit-app-region'),
      }
    })

    expect(geometry.close.top).toBe(0)
    expect(Math.round(geometry.close.right)).toBe(geometry.viewport)
    expect(geometry.banner.top).toBe(0)
    expect(geometry.close.bottom).toBe(geometry.banner.bottom) // same height as the banner
    expect(geometry.dismissReachable).toBe(true)
    expect(geometry.bannerRegion).toBe('drag')
  })
})
