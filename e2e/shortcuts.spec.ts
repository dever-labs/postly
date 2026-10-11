import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, expect } from './fixtures'

test.describe('Keyboard shortcuts', () => {
  let server: http.Server
  let base = ''

  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/slow') { setTimeout(() => res.end('late'), 8000); return }
      res.setHeader('content-type', 'application/json')
      res.end('{"ok":true}')
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  test.afterAll(() => { server.closeAllConnections(); server.close() })

  test.afterEach(async ({ window }) => {
    await window.evaluate(() => window.api.proxy.set({ mode: 'system', url: '', username: '', password: '', bypass: '' }))
  })

  test('send, cancel, save, new request and the cheat-sheet work from the keyboard', async ({ window }) => {
    await window.evaluate(() => window.api.proxy.set({ mode: 'none', url: '', username: '', password: '', bypass: '' }))
    const suffix = Date.now()
    const colName = `E2E Keys ${suffix}`
    const reqName = `Keys Request ${suffix}`
    const colId = await window.evaluate(async (name: string) => {
      const res = await window.api.collections.create({ name })
      return (res as { data: { id: string } }).data.id
    }, colName)
    const grpId = await window.evaluate(async (id: string) => {
      const res = await window.api.folders.create({ parentId: id, name: 'Default' })
      return (res as { data: { id: string } }).data.id
    }, colId)
    await window.evaluate(async ([id, name]: [string, string]) => {
      await window.api.requests.create({ folderId: id, name, method: 'GET' })
    }, [grpId, reqName] as [string, string])
    await window.reload()
    await window.waitForSelector('[data-testid="app-root"]', { timeout: 20_000 })
    await window.getByText(colName).first().click()
    await window.getByText(reqName).first().click()
    const urlInput = window.getByTestId('url-input')
    await urlInput.waitFor({ state: 'visible' })
    await window.waitForTimeout(400)

    // Ctrl+Enter sends (from the URL bar, with freshly typed text)
    await urlInput.fill(`${base}/fast`)
    await window.keyboard.press('Control+Enter')
    await expect(window.getByTestId('response-status')).toContainText('200', { timeout: 10_000 })

    // Esc cancels an in-flight request
    await urlInput.fill(`${base}/slow`)
    await window.keyboard.press('Control+Enter')
    await expect(window.getByTestId('send-button')).not.toBeVisible()
    await window.keyboard.press('Escape')
    await expect(window.getByTestId('send-button')).toBeVisible({ timeout: 10_000 })

    // Ctrl+S saves: the unsaved marker disappears from the working set
    await expect(window.getByTestId('working-set-unsaved')).toHaveText('1 unsaved')
    await window.keyboard.press('Control+s')
    await expect(window.getByTestId('working-set-unsaved')).toHaveCount(0)

    // Ctrl+N creates and opens a new request next to this one
    await window.keyboard.press('Control+n')
    await expect(window.getByPlaceholder('Request name')).toHaveValue('New Request')

    // Ctrl+/ opens the cheat-sheet, Esc closes it
    await window.keyboard.press('Control+/')
    const sheet = window.getByTestId('shortcut-sheet')
    await expect(sheet).toBeVisible()
    await expect(sheet.getByTestId('shortcut-row')).toHaveCount(15)
    await expect(sheet).toContainText('Send request')
    await window.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0)

    // shortcuts are inert behind a dialog
    await window.keyboard.press('Control+k')
    await expect(window.getByTestId('command-palette')).toBeVisible()
    const before = await window.getByTestId('working-set-item').count()
    await window.keyboard.press('Control+n')
    await window.waitForTimeout(300)
    expect(await window.getByTestId('working-set-item').count()).toBe(before)
    await window.keyboard.press('Escape')
  })

  test('settings and sidebar search shortcuts, and tooltips show the keys', async ({ window }) => {
    await window.keyboard.press('Control+,')
    await expect(window.getByTestId('settings-modal')).toBeVisible()
    await window.keyboard.press('Escape')
    await expect(window.getByTestId('settings-modal')).toHaveCount(0)

    await window.keyboard.press('Control+Shift+F')
    await expect(window.getByTestId('sidebar-search')).toBeFocused()

    await expect(window.getByTestId('nav-back')).toHaveAttribute('title', /Alt\+←/)
  })

  test('Alt+Up/Down steps through the working set and Ctrl+B toggles the sidebar', async ({ window }) => {
    const suffix = Date.now()
    const names = [`Step A ${suffix}`, `Step B ${suffix}`]
    const colName = `E2E Step ${suffix}`
    await window.evaluate(async ([col, a, b]: string[]) => {
      const c = (await window.api.collections.create({ name: col })) as { data: { id: string } }
      const g = (await window.api.folders.create({ parentId: c.data.id, name: 'Default' })) as { data: { id: string } }
      await window.api.requests.create({ folderId: g.data.id, name: a, method: 'GET' })
      await window.api.requests.create({ folderId: g.data.id, name: b, method: 'GET' })
    }, [colName, names[0], names[1]])
    await window.reload()
    await window.waitForSelector('[data-testid="app-root"]', { timeout: 20_000 })
    await window.getByText(colName).first().click()
    await window.getByText(names[0]).first().click()
    await window.getByText(names[1]).first().click()
    const nameInput = window.getByPlaceholder('Request name')
    await expect(nameInput).toHaveValue(names[1])

    // The working set is shared with other specs, so assert relative movement; stepping must not reorder it
    await window.getByTestId('working-set').click({ position: { x: 4, y: 4 } })
    await window.keyboard.press('Alt+ArrowDown')
    await expect(nameInput).not.toHaveValue(names[1])
    await window.keyboard.press('Alt+ArrowUp')
    await expect(nameInput).toHaveValue(names[1])

    const sidebar = window.getByTestId('sidebar-search')
    await expect(sidebar).toBeVisible()
    await window.keyboard.press('Control+b')
    await expect(sidebar).not.toBeVisible()
    await window.keyboard.press('Control+b')
    await expect(sidebar).toBeVisible()
  })
})
