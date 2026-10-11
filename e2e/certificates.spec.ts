import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generate } from 'selfsigned'
import { test, expect } from './fixtures'

test.describe('Certificates', () => {
  let dir = ''
  const suffix = Date.now()

  test.beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postly-certs-')) })
  test.afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }) })

  test.afterEach(async ({ window }) => {
    const res = (await window.evaluate(() => window.api.certificates.list())) as { data: { id: string; name: string }[] }
    for (const c of res.data.filter((r) => r.name.includes(String(suffix)))) await window.evaluate((id: string) => window.api.certificates.delete({ id }), c.id)
  })

  const pem = async (cn: string, validDays = 30) => {
    const out = await generate([{ name: 'commonName', value: cn }], {
      algorithm: 'sha256', notBeforeDate: new Date(Date.now() - 10 * 86_400_000), notAfterDate: new Date(Date.now() + validDays * 86_400_000),
    } as never)
    const cert = path.join(dir, `${cn}-${validDays}.crt`)
    const key = path.join(dir, `${cn}-${validDays}.key`)
    fs.writeFileSync(cert, out.cert)
    fs.writeFileSync(key, out.private)
    return { cert, key }
  }

  test('adds a CA and a client certificate, and refuses bad files with a clear message', async ({ window }) => {
    const ca = await pem('corp-ca')
    const client = await pem('alice')
    const other = await pem('mallory')
    const expired = await pem('old', -1)

    await window.keyboard.press('Control+,')
    const modal = window.getByTestId('settings-modal')
    await modal.getByRole('button', { name: 'Certificates' }).click()
    await expect(window.getByTestId('cert-ca-empty')).toBeVisible()

    // CA: a non-certificate is refused, a real one is listed
    await window.getByTestId('cert-add-ca').click()
    await window.getByTestId('cert-name').fill(`Corp CA ${suffix}`)
    const notCert = path.join(dir, 'readme.pem')
    fs.writeFileSync(notCert, 'hello')
    await window.getByTestId('cert-file').setInputFiles(notCert)
    await window.getByTestId('cert-save').click()
    await expect(window.getByTestId('cert-error')).toContainText('No PEM certificate')
    await window.getByTestId('cert-file').setInputFiles(ca.cert)
    await window.getByTestId('cert-save').click()
    await expect(window.getByTestId('cert-row').filter({ hasText: `Corp CA ${suffix}` })).toContainText('expires')

    // Client: expired and mismatched pairs are refused at save time
    await window.getByTestId('cert-add-client').click()
    await window.getByTestId('cert-name').fill(`Alice ${suffix}`)
    await window.getByTestId('cert-host').fill('*.example.com')
    await window.getByTestId('cert-file').setInputFiles(expired.cert)
    await window.getByTestId('cert-key-file').setInputFiles(expired.key)
    await window.getByTestId('cert-save').click()
    await expect(window.getByTestId('cert-error')).toContainText('expired on')

    await window.getByTestId('cert-file').setInputFiles(client.cert)
    await window.getByTestId('cert-key-file').setInputFiles(other.key)
    await window.getByTestId('cert-save').click()
    await expect(window.getByTestId('cert-error')).toContainText('does not belong')

    await window.getByTestId('cert-key-file').setInputFiles(client.key)
    await window.getByTestId('cert-save').click()
    const row = window.getByTestId('cert-row').filter({ hasText: `Alice ${suffix}` })
    await expect(row).toContainText('*.example.com')

    // The renderer never receives key material or passphrases
    const listed = await window.evaluate(() => window.api.certificates.list())
    expect(JSON.stringify(listed)).not.toContain('PRIVATE KEY')

    await window.getByRole('button', { name: `Delete Alice ${suffix}` }).click()
    await expect(row).toHaveCount(0)
  })
})
