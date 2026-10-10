import { test, expect } from './fixtures'

test('working set tracks opened, pinned and unsaved requests', async ({ window }) => {
  const suffix = Date.now()
  const colName = `E2E WS ${suffix}`
  const names = [`WS One ${suffix}`, `WS Two ${suffix}`]
  const colId = await window.evaluate(async (name: string) => {
    const res = await window.api.collections.create({ name })
    return (res as { data: { id: string } }).data.id
  }, colName)
  const grpId = await window.evaluate(async (id: string) => {
    const res = await window.api.folders.create({ parentId: id, name: 'Default' })
    return (res as { data: { id: string } }).data.id
  }, colId)
  for (const name of names) {
    await window.evaluate(async ([id, n]: [string, string]) => {
      await window.api.requests.create({ folderId: id, name: n, method: 'GET' })
    }, [grpId, name] as [string, string])
  }
  await window.reload()
  await window.waitForSelector('[data-testid="app-root"]', { timeout: 20_000 })

  const ws = window.getByTestId('working-set')
  await window.getByText(colName).first().click()
  await window.getByText(names[0]).first().click()
  await window.getByText(names[1]).first().click()
  const item = (n: string) => ws.getByTestId('working-set-item').filter({ hasText: n })
  await expect(item(names[0])).toHaveCount(1)
  await expect(item(names[1])).toHaveCount(1)

  // pin the first, then remove the second (clean, unpinned)
  await item(names[0]).hover()
  await item(names[0]).getByRole('button', { name: 'Pin' }).click()
  await item(names[1]).hover()
  await item(names[1]).getByRole('button', { name: 'Remove from working set' }).click()
  await expect(item(names[1])).toHaveCount(0)
  await expect(item(names[0])).toHaveCount(1)

  // an edit marks the request unsaved and surfaces it in the working set
  await item(names[0]).locator('button').first().click()
  await window.getByPlaceholder('Request name').fill(`${names[0]} edited`)
  await expect(window.getByTestId('working-set-unsaved')).toHaveText('1 unsaved')
})
