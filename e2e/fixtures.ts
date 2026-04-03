import { test as base, _electron as electron, expect } from '@playwright/test'
import type { Page, ElectronApplication } from '@playwright/test'
import path from 'path'

const ROOT = path.join(__dirname, '..')
const MAIN = path.join(ROOT, 'out', 'main', 'index.js')
const RENDERER_URL = `file://${path.join(ROOT, 'out', 'renderer', 'index.html').replace(/\\/g, '/')}`

type Fixtures = {
  electronApp: ElectronApplication
  window: Page
}

/**
 * Both fixtures are worker-scoped so a single Electron instance is shared
 * across all tests in one file. This avoids the overhead (and flakiness) of
 * launching and tearing down a process for every test case.
 */
export const test = base.extend<Record<string, never>, Fixtures>({
  electronApp: [
    async ({}, use) => {
      const app = await electron.launch({
        args: [MAIN],
        // app.isPackaged is false when launched directly, so the main process
        // reads this env var to locate the renderer instead of hitting localhost.
        // PLAYWRIGHT suppresses DevTools so firstWindow() reliably returns the app window.
        env: { ...process.env, ELECTRON_RENDERER_URL: RENDERER_URL, PLAYWRIGHT: '1' },
      })
      await use(app)
      await app.close()
    },
    { scope: 'worker' },
  ],

  window: [
    async ({ electronApp }, use) => {
      const page = await electronApp.firstWindow()
      page.on('pageerror', (err) => console.error('[renderer]', err.message))
      await page.waitForLoadState('domcontentloaded')
      // Wait for React to mount before any test assertions run
      await page.waitForSelector('[data-testid="app-root"]', { timeout: 20_000 })
      await use(page)
    },
    { scope: 'worker' },
  ],
})

export { expect }
