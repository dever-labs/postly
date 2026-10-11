import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, expect } from './fixtures'

test.describe('Streaming responses', () => {
  let server: http.Server
  let base = ''
  const lastIds: Array<string | undefined> = []

  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      lastIds.push(req.headers['last-event-id'] as string | undefined)
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const resumed = req.headers['last-event-id'] === '2'
      const ids = resumed ? [3] : [1, 2]
      ids.forEach((id, i) => setTimeout(() => res.write(`id: ${id}\nevent: tick\ndata: message ${id}\n\n`), 50 * (i + 1)))
      setTimeout(() => res.end(), 50 * (ids.length + 1))
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  test.afterAll(() => { server.closeAllConnections(); server.close() })

  test.afterEach(async ({ window }) => {
    await window.evaluate(() => window.api.proxy.set({ mode: 'system', url: '', username: '', password: '', bypass: '' }))
  })

  test('events are listed in the Stream tab and the stream can be resumed with Last-Event-ID', async ({ window }) => {
    const suffix = Date.now()
    const colName = `E2E Stream ${suffix}`
    const reqName = `Stream Request ${suffix}`
    await window.evaluate(() => window.api.proxy.set({ mode: 'none', url: '', username: '', password: '', bypass: '' }))
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
    await urlInput.fill(`${base}/events`)
    await window.waitForTimeout(200)
    await window.getByTestId('send-button').click()

    const events = window.getByTestId('stream-event')
    await expect(events).toHaveCount(2, { timeout: 10_000 })
    await expect(events.first()).toContainText('message 1')
    await expect(window.getByTestId('stream-status')).toContainText('Stream ended')

    await window.getByTestId('stream-resume').click()
    await expect(events).toHaveCount(3, { timeout: 10_000 })
    await expect(events.last()).toContainText('message 3')
    expect(lastIds).toContain('2')
  })
})
