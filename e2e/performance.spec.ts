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
import fs from 'fs'
import path from 'path'

const ROOT = path.join(__dirname, '..')
const MAIN = path.join(ROOT, 'out', 'main', 'index.js')
const RENDERER_URL = `file://${path.join(ROOT, 'out', 'renderer', 'index.html').replace(/\\/g, '/')}`

const LAUNCH_ENV = { ...process.env, ELECTRON_RENDERER_URL: RENDERER_URL, PLAYWRIGHT: '1' }

// ── Thresholds (ms) ───────────────────────────────────────────────────────────
// Set conservatively so CI passes, but large regressions are caught.
// Local measurements are ~0.5s / ~0.65s / ~0.67s; budgets leave ~4x headroom for slow CI runners.
// Override with E2E_PERF_SCALE (e.g. 2) on slower machines.
const SCALE = Number(process.env.E2E_PERF_SCALE ?? 1) || 1
const T_FIRST_WINDOW_MS = 2_000 * SCALE   // launch() → BrowserWindow created
const T_APP_ROOT_MS     = 3_000 * SCALE   // launch() → React root rendered
const T_SIDEBAR_MS      = 4_000 * SCALE   // launch() → sidebar interactive (postly:ready resolved + data fetched)
const T_MEDIAN_SIDEBAR_MS = 3_000 * SCALE // median of 3 cold starts to sidebar
// Renderer JS parsed before first paint must stay small: Monaco must be lazy-loaded.
const MAX_INITIAL_JS_BYTES = 3 * 1024 * 1024

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

  /** Median of several cold starts is far less noisy than a single sample. */
  test('median cold start to sidebar is within budget', async () => {
    const samples: number[] = []
    for (let i = 0; i < 3; i++) {
      const t0 = Date.now()
      const app = await electron.launch({ args: [MAIN], env: LAUNCH_ENV })
      try {
        const page = await app.firstWindow()
        await page.waitForSelector('[data-testid="sidebar"]', { timeout: T_SIDEBAR_MS * 2 })
        samples.push(Date.now() - t0)
      } finally {
        await app.close()
      }
    }
    samples.sort((a, b) => a - b)
    const median = samples[1]
    console.log(`[perf] sidebar samples: ${samples.map(fmt).join(', ')} (median ${fmt(median)})`)
    expect(median, 'median startup to sidebar').toBeLessThan(T_MEDIAN_SIDEBAR_MS)
  })

  /**
   * Guards against heavy code creeping back onto the critical path: Monaco and
   * the update check must not run during startup.
   */
  test('heavy modules stay off the startup path', async () => {
    const app = await electron.launch({ args: [MAIN], env: LAUNCH_ENV })
    try {
      const page = await app.firstWindow()
      await page.waitForSelector('[data-testid="sidebar"]', { timeout: T_SIDEBAR_MS })

      // file:// loads expose no resource timing entries, so read the entry's script/preload tags.
      const urls = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('script[src], link[rel="modulepreload"]'))
          .map((el) => (el as HTMLScriptElement).src || (el as HTMLLinkElement).href)
      )
      const resources = urls.map((u) => {
        const file = path.join(ROOT, 'out', 'renderer', new URL(u).pathname.split('/out/renderer/')[1] ?? '')
        return { name: u, size: fs.existsSync(file) ? fs.statSync(file).size : 0 }
      })
      const totalJs = resources.reduce((n, r) => n + r.size, 0)
      const monaco = resources.filter((r) => /monaco|editor\.api|\.worker/i.test(r.name))
      console.log(`[perf] initial renderer JS: ${(totalJs / 1024).toFixed(0)} KB in ${resources.length} files`)

      expect(monaco.map((r) => r.name), 'Monaco must not load at startup').toEqual([])
      expect(totalJs, 'initial renderer JS size').toBeLessThan(MAX_INITIAL_JS_BYTES)

      const loaded = await app.evaluate(() => {
        const cache = (process.mainModule as unknown as { constructor: { _cache: Record<string, unknown> } }).constructor._cache
        const keys = Object.keys(cache)
        return ['electron-updater', 'mqtt', '@grpc/grpc-js', 'swagger-parser', '/ws/']
          .filter((m) => keys.some((k) => k.includes(m)))
      })
      expect(loaded, 'main-process modules that must be lazy').toEqual([])
    } finally {
      await app.close()
    }
  })
})
