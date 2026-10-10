import { test, expect } from './fixtures'

test('command palette opens requests by search and runs actions', async ({ window }) => {
  const suffix = Date.now()
  const colName = `E2E Palette ${suffix}`
  const reqName = `Zebra Lookup ${suffix}`
  const colId = await window.evaluate(async (name: string) => {
    const res = await window.api.collections.create({ name })
    return (res as { data: { id: string } }).data.id
  }, colName)
  const grpId = await window.evaluate(async (id: string) => {
    const res = await window.api.folders.create({ parentId: id, name: 'Default' })
    return (res as { data: { id: string } }).data.id
  }, colId)
  await window.evaluate(async ([id, name]: [string, string]) => {
    await window.api.requests.create({ folderId: id, name, method: 'POST' })
  }, [grpId, reqName] as [string, string])
  await window.reload()
  await window.waitForSelector('[data-testid="app-root"]', { timeout: 20_000 })

  // Not built or rendered until opened
  await expect(window.getByTestId('command-palette')).toHaveCount(0)

  await window.keyboard.press('Control+k')
  const palette = window.getByTestId('command-palette')
  await expect(palette).toBeVisible()
  await expect(window.getByTestId('palette-input')).toBeFocused()

  await window.getByTestId('palette-input').fill(`zebra ${suffix}`)
  const item = window.getByTestId('palette-item').filter({ hasText: reqName })
  await expect(item).toHaveCount(1)
  await expect(item).toContainText(colName)
  await expect(item).toHaveAttribute('aria-selected', 'true')
  await window.keyboard.press('Enter')

  await expect(palette).toHaveCount(0)
  await expect(window.getByPlaceholder('Request name')).toHaveValue(reqName)

  // Esc closes, and actions are available
  await window.keyboard.press('Control+k')
  await window.getByTestId('palette-input').fill('open settings')
  await window.keyboard.press('Enter')
  await expect(window.getByTestId('settings-modal')).toBeVisible()
})

test('Escape closes the palette', async ({ window }) => {
  await window.keyboard.press('Escape') // close settings from the previous test, if open
  await window.keyboard.press('Control+k')
  await expect(window.getByTestId('command-palette')).toBeVisible()
  await window.keyboard.press('Escape')
  await expect(window.getByTestId('command-palette')).toHaveCount(0)
})
