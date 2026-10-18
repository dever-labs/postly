import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { test, expect } from './fixtures'

test.describe('Variable scopes', () => {
  let server: http.Server
  let base = ''
  const seen: string[] = []

  test.beforeAll(async () => {
    server = http.createServer((req, res) => { seen.push(req.url ?? ''); res.end('ok') })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  test.afterAll(() => { server.close() })

  test.afterEach(async ({ window }) => {
    await window.evaluate(() => window.api.proxy.set({ mode: 'system', url: '', username: '', password: '', bypass: '' }))
    await window.evaluate(() => window.api.variables.set({ scope: 'global', vars: [] }))
  })

  test('global and collection variables and {{$guid}} are resolved per send', async ({ window }) => {
    const suffix = Date.now()
    const colName = `E2E Vars ${suffix}`
    const reqName = `Vars Request ${suffix}`
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
    await window.evaluate(([id, host]: [string, string]) => Promise.all([
      window.api.variables.set({ scope: 'collection', ownerId: id, vars: [{ key: 'SEG', value: 'from-collection', isSecret: false }] }),
      window.api.variables.set({ scope: 'global', vars: [{ key: 'HOST', value: host, isSecret: false }] }),
    ]), [colId, base] as [string, string])

    await window.reload()
    await window.waitForSelector('[data-testid="app-root"]', { timeout: 20_000 })
    await expect.poll(async () => window.evaluate(async () => {
      return ((await window.api.variables.list()) as {
        data?: { global?: Array<{ key: string }> }
      }).data?.global?.length ?? 0
    }), { timeout: 10_000 }).toBe(1)

    expect(await window.evaluate(async () => {
      return ((await window.api.variables.list()) as {
        data?: { global?: Array<{ key: string; value: string; isSecret: boolean }> }
      }).data?.global ?? []
    })).toEqual([{ key: 'HOST', value: base, isSecret: false }])

    await window.getByText(colName).first().click()
    await window.getByText(reqName).first().click()
    const urlInput = window.getByTestId('url-input')
    await urlInput.waitFor({ state: 'visible' })
    await urlInput.fill('{{HOST}}/{{SEG}}/{{$guid}}')
    await urlInput.press('Enter')
    await expect(window.getByTestId('response-status')).toContainText('200', { timeout: 10_000 })

    expect(seen.at(-1)).toMatch(/^\/from-collection\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)

    await window.getByRole('tab', { name: /Console/ }).click()
    await expect(window.getByText(/Variables: .*HOST ← global/)).toBeVisible()
    await expect(window.getByText(/SEG ← collection/)).toBeVisible()
  })
})
