import { test, expect } from './fixtures'

test('back and forward move between opened requests', async ({ window }) => {
  const suffix = Date.now()
  const colName = `E2E Nav ${suffix}`
  const names = [`Nav One ${suffix}`, `Nav Two ${suffix}`]
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

  await window.getByText(colName).first().click()
  await window.getByText(names[0]).first().click()
  const nameInput = window.getByPlaceholder('Request name')
  await expect(nameInput).toHaveValue(names[0])
  await expect(window.getByTestId('nav-back')).toBeDisabled()

  await window.getByText(names[1]).first().click()
  await expect(nameInput).toHaveValue(names[1])

  await window.getByTestId('nav-back').click()
  await expect(nameInput).toHaveValue(names[0])
  await expect(window.getByTestId('nav-forward')).toBeEnabled()

  await window.getByTestId('nav-forward').click()
  await expect(nameInput).toHaveValue(names[1])
})
