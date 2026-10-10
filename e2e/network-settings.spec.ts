import { test, expect } from './fixtures'

test.describe('Network settings', () => {
  test('proxy can be configured, saved and reports the route', async ({ window }) => {
    await window.locator('[data-testid="btn-settings"]').click()
    await window.getByRole('button', { name: 'Network' }).click()

    await expect(window.getByRole('radio', { name: /System/ })).toBeChecked()

    await window.getByRole('radio', { name: 'Manual' }).check()
    await window.getByPlaceholder(/proxy\.example\.com/).fill('http://proxy.test:8080')
    await window.getByPlaceholder(/localhost, 127/).fill('localhost')
    await window.locator('input[type="password"]').fill('s3cret')
    await window.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(window.getByTestId('proxy-status')).toHaveText('Saved')

    // The password is write-only: after saving, the field is empty with a "saved" hint.
    await expect(window.locator('input[type="password"]')).toHaveValue('')
    await expect(window.locator('input[type="password"]')).toHaveAttribute('placeholder', /Saved/)

    await window.getByRole('button', { name: 'Check route' }).click()
    await expect(window.getByTestId('proxy-status')).toContainText('will use proxy http://proxy.test:8080')
  })
})
