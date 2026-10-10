import { test, expect } from './fixtures'

test.describe('cURL import and export', () => {
  test('pasting cURL fills the request, Copy as cURL masks secrets, and the palette imports a new request', async ({ window, electronApp }) => {
    const suffix = Date.now()
    const colName = `E2E Curl ${suffix}`
    const reqName = `Curl Request ${suffix}`
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

    // Paste a cURL command into the URL bar
    const command = `curl -X POST 'https://api.example.test/items?x=1' -H 'Content-Type: application/json' -H 'X-Trace: {{trace}}' -u 'ann:hunter2' -d '{"name":"widget"}' --max-time 5`
    await urlInput.focus()
    await urlInput.evaluate((el, text) => {
      const dt = new DataTransfer()
      dt.setData('text', text)
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, command)
    await expect(urlInput).toHaveValue('https://api.example.test/items?x=1')
    await expect(window.getByText(/Imported from cURL with 1 note/)).toBeVisible()

    // Copy as cURL: credentials are masked by default
    await window.getByTestId('curl-copy-button').click()
    await window.getByTestId('curl-copy-submit').click()
    await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText())).toContain('curl -X POST')
    const masked = await electronApp.evaluate(({ clipboard }) => clipboard.readText())
    expect(masked).toContain("'https://api.example.test/items?x=1'")
    expect(masked).toContain('-u \'ann:<password>\'')
    expect(masked).toContain(`--data-raw '{"name":"widget"}'`)
    expect(masked).not.toContain('hunter2')

    // Opting in includes them
    await window.getByTestId('curl-copy-button').click()
    await window.getByTestId('curl-include-secrets').check()
    await window.getByTestId('curl-copy-submit').click()
    await expect.poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText())).toContain("-u 'ann:hunter2'")
    await window.getByTestId('curl-copy-button').click()
    await window.getByTestId('curl-include-secrets').uncheck()
    await window.keyboard.press('Escape')

    // Import from the palette creates a new request
    await window.keyboard.press('Control+k')
    await window.getByTestId('palette-input').fill('import from curl')
    await window.keyboard.press('Enter')
    const dialog = window.getByTestId('curl-import-dialog')
    await expect(dialog).toBeVisible()
    await window.getByTestId('curl-import-input').fill('not a command')
    await expect(window.getByTestId('curl-import-submit')).toBeDisabled()
    await window.getByTestId('curl-import-input').fill("curl -I https://api.example.test/health")
    await expect(window.getByTestId('curl-import-status')).toContainText('HEAD')
    await window.getByTestId('curl-import-submit').click()
    await expect(dialog).toHaveCount(0)
    await expect(window.getByPlaceholder('Request name')).toHaveValue('HEAD /health')
    await expect(window.getByTestId('url-input')).toHaveValue('https://api.example.test/health')
  })
})
