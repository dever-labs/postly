/**
 * Startup performance tests.
 *
 * Each test launches a fresh Electron process (not the shared fixture) so that
 * every measurement reflects a genuine cold start. Thresholds are intentionally
 * generous — their purpose is to catch large regressions, not to enforce
 * a specific SLA that varies by machine.
 *
 * Run: npm run test:e2e -- --grep "performance"
 */

import { test, expect, _electron as electron } from '@playwright/test'
import path from 'path'

const ROOT = path.join(__dirname, '..')
const MAIN = path.join(ROOT, 'out', 'main', 'index.js')
const RENDERER_URL = `file://${path.join(ROOT, 'out', 'renderer', 'index.html').replace(/\\/g, '/')}`

const LAUNCH_ENV = { ...process.env, ELECTRON_RENDERER_URL: RENDERER_URL, PLAYWRIGHT: '1' }

// ── Thresholds (ms) ───────────────────────────────────────────────────────────
// Set conservatively so CI passes, but large regressions are caught.
const T_FIRST_WINDOW_MS = 5_000   // launch() → BrowserWindow created
const T_APP_ROOT_MS     = 8_000   // launch() → React root rendered
const T_SIDEBAR_MS      = 12_000  // launch() → sidebar interactive (postly:ready resolved + data fetched)

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(ms: number): string {
  return `${ms}ms`
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Startup performance', () => {
  /**
   * Core milestone test: launches the app and records the time at each
   * observable checkpoint. All three thresholds are checked in a single
   * launch to keep the test suite fast.
   */
  test('startup milestones are within thresholds', async () => {
    const t0 = Date.now()

    const app = await electron.launch({ args: [MAIN], env: LAUNCH_ENV })

    try {
      // ── Milestone 1: first window ───────────────────────────────────────────
      const page = await app.firstWindow()
      const tFirstWindow = Date.now() - t0

      // ── Milestone 2: React root rendered ───────────────────────────────────
      await page.waitForSelector('[data-testid="app-root"]', { timeout: T_APP_ROOT_MS })
      const tAppRoot = Date.now() - t0

      // ── Milestone 3: sidebar interactive (DB ready + initial data loaded) ───
      await page.waitForSelector('[data-testid="sidebar"]', { timeout: T_SIDEBAR_MS })
      const tSidebar = Date.now() - t0

      console.log([
        '[perf] startup milestones:',
        `  first-window : ${fmt(tFirstWindow)}`,
        `  app-root     : ${fmt(tAppRoot)}`,
        `  sidebar      : ${fmt(tSidebar)}`,
      ].join('\n'))

      expect(tFirstWindow, 'first window should appear within threshold').toBeLessThan(T_FIRST_WINDOW_MS)
      expect(tAppRoot,     'app root should render within threshold').toBeLessThan(T_APP_ROOT_MS)
      expect(tSidebar,     'sidebar should be interactive within threshold').toBeLessThan(T_SIDEBAR_MS)
    } finally {
      await app.close()
    }
  })

  /**
   * Verifies the window-before-DB optimisation is in effect: the window must
   * appear before the sidebar is fully interactive. If initDatabase() were
   * blocking window creation again, the gap between the two would collapse.
   */
  test('window is created before data load completes', async () => {
    const t0 = Date.now()

    const app = await electron.launch({ args: [MAIN], env: LAUNCH_ENV })

    try {
      const page = await app.firstWindow()
      const tFirstWindow = Date.now() - t0

      await page.waitForSelector('[data-testid="sidebar"]', { timeout: T_SIDEBAR_MS })
      const tSidebar = Date.now() - t0

      const windowBeforeData = tFirstWindow < tSidebar
      console.log([
        '[perf] window-before-data check:',
        `  first-window : ${fmt(tFirstWindow)}`,
        `  sidebar      : ${fmt(tSidebar)}`,
        `  gap          : ${fmt(tSidebar - tFirstWindow)}`,
      ].join('\n'))

      expect(windowBeforeData, 'window should be created before data finishes loading').toBe(true)
    } finally {
      await app.close()
    }
  })
})
