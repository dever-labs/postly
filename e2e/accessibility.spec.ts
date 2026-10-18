import http from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { runAxe } from './axe'

let server: http.Server
let base = ''

test.beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end('{"ok":true}')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

test.afterAll(() => { server.closeAllConnections(); server.close() })

/** The profile is shared between specs, so only violations inside the screen under test count. */
async function expectNoSeriousViolations(page: Page, screen: string, scope?: string) {
  const violations = (await runAxe(page, scope)).filter((v) => v.impact === 'serious' || v.impact === 'critical')
  const report = violations.map((v) => `${v.id}: ${v.help} -> ${v.nodes.slice(0, 3).join(' | ')}`)
  expect(report, `${screen} has serious accessibility violations`).toEqual([])
}

async function seed(page: Page, name: string) {
  await page.evaluate(async (colName: string) => {
    const c = await window.api.collections.create({ name: colName }) as { data: { id: string } }
    const f = await window.api.folders.create({ parentId: c.data.id, name: `${colName} folder` }) as { data: { id: string } }
    await window.api.requests.create({ folderId: f.data.id, name: `${colName} ping`, method: 'GET' })
  }, name)
  await page.reload()
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 20_000 })
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`Accessibility (${theme})`, () => {
    test.beforeAll(async ({ window }) => {
      await window.evaluate((t) => localStorage.setItem('postly-theme', t), theme)
    })
    test.afterAll(async ({ window }) => {
      await window.evaluate(() => localStorage.removeItem('postly-theme'))
    })

    test('main screens have no serious or critical violations', async ({ window }) => {
      test.setTimeout(90_000)
      const name = `A11y ${theme} ${Date.now()}`
      await seed(window, name)
      await expectNoSeriousViolations(window, 'home')

      await window.getByTestId('tab-environments').click()
      await expectNoSeriousViolations(window, 'environments')
      await window.getByTestId('tab-history').click()
      await expectNoSeriousViolations(window, 'history')
      await window.getByTestId('tab-apis').click()

      await window.getByRole('treeitem', { name: new RegExp(`^${name} local`) }).click()
      await expectNoSeriousViolations(window, 'collection editor')

      await window.getByRole('treeitem', { name: new RegExp(`^GET ${name} ping`) }).click()
      await window.getByTestId('url-input').waitFor({ state: 'visible' })
      await window.getByTestId('url-input').fill(`${base}/ping`)
      await window.getByTestId('send-button').click()
      await expect(window.getByTestId('response-status')).toBeVisible({ timeout: 10_000 })
      await expectNoSeriousViolations(window, 'request with response')

      for (const tab of ['Params', 'Headers', 'Body', 'Auth', 'Settings']) {
        const trigger = window.getByRole('tab', { name: tab, exact: true }).first()
        if (await trigger.count()) {
          await trigger.click()
          await expectNoSeriousViolations(window, `request ${tab} tab`)
        }
      }
    })

    test('dialogs and pages have no serious or critical violations', async ({ window }) => {
      test.setTimeout(90_000)
      await window.getByTestId('btn-import').click()
      await expectNoSeriousViolations(window, 'import page')
      await window.getByTestId('btn-export').click()
      await expectNoSeriousViolations(window, 'export page')
      await window.getByRole('button', { name: /Connect a source/ }).click()
      await expectNoSeriousViolations(window, 'connect a source')

      await window.keyboard.press('Control+k')
      await expect(window.getByTestId('command-palette')).toBeVisible()
      await expectNoSeriousViolations(window, 'command palette')
      await window.keyboard.press('Escape')

      await window.getByTestId('btn-settings').click()
      const modal = window.getByTestId('settings-modal')
      const tabs = await modal.locator('nav button').allInnerTexts()
      expect(tabs.length).toBeGreaterThan(3)
      for (const label of tabs) {
        await modal.locator('nav button', { hasText: label }).click()
        await expectNoSeriousViolations(window, `settings: ${label}`, '[data-testid="settings-modal"]')
      }
      await window.keyboard.press('Escape')
      await expect(modal).toHaveCount(0)
    })
  })
}

test.describe('Keyboard navigation', () => {
  test('sidebar tree supports arrows, Enter and a keyboard row menu', async ({ window }) => {
    const name = `Kbd ${Date.now()}`
    await seed(window, name)

    const root = window.getByRole('treeitem', { name: new RegExp(`^${name} local`) })
    await root.focus()
    await expect(root).toBeFocused()

    await window.keyboard.press('ArrowRight')
    await expect(window.getByRole('treeitem', { name: new RegExp(`^${name} folder`) })).toBeFocused()
    await window.keyboard.press('ArrowRight')
    const request = window.getByRole('treeitem', { name: new RegExp(`^GET ${name} ping`) })
    await expect(request).toBeFocused()

    await window.keyboard.press('Enter')
    await expect(window.getByTestId('url-input')).toBeVisible()

    await request.focus()
    await window.keyboard.press('Shift+F10')
    await expect(window.getByRole('menu')).toBeVisible()
    await expect(window.locator('[role="menuitem"]:focus')).toHaveCount(1)
    await window.keyboard.press('Escape')
    await expect(window.getByRole('menu')).toHaveCount(0)
    await expect(request).toBeFocused()

    await window.keyboard.press('Shift+F10')
    await window.getByRole('menuitem', { name: 'Rename' }).click()
    const input = request.locator('input')
    await expect(input).toBeFocused()
    await window.waitForTimeout(300)
    await expect(input).toBeFocused()
  })

  test('settings dialog traps focus and restores it on close', async ({ window }) => {
    const opener = window.getByTestId('btn-settings')
    await opener.focus()
    await opener.press('Enter')
    const modal = window.getByTestId('settings-modal')
    await expect(modal).toBeVisible()
    for (let i = 0; i < 40; i++) {
      await window.keyboard.press('Tab')
      expect(await modal.evaluate((m) => m.contains(document.activeElement))).toBe(true)
    }
    await window.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)
    await expect(opener).toBeFocused()
  })
})
