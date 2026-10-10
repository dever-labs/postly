import { ipcMain } from 'electron'
import { addCertificate, deleteCertificate, listCertificates } from '../services/certificate-store'
import { selectTlsOptions, validateCertificate, type CertificateInput, type TlsSelection } from '../services/certificates'
import { setTlsProvider } from '../services/proxy'

/** TLS options for a URL from the stored certificates. */
export function tlsSelectionFor(url: string): TlsSelection {
  try { return selectTlsOptions(listCertificates(), url) } catch { return { options: {}, customCaCount: 0 } }
}

export function registerCertificateHandlers(): void {
  setTlsProvider(tlsSelectionFor)

  ipcMain.handle('postly:certificates:list', async () => {
    try {
      const data = listCertificates().map((e) => {
        const checked = validateCertificate({ kind: e.kind, name: e.name, host: e.host || '*', port: e.port, certPem: e.certPem, keyPem: e.keyPem, pfxBase64: e.pfxBase64, passphrase: e.passphrase })
        return {
          id: e.id, kind: e.kind, name: e.name, host: e.host, port: e.port,
          format: e.pfxBase64 ? 'pfx' : 'pem', hasPassphrase: !!e.passphrase,
          subject: 'summary' in checked ? checked.summary.subject : '',
          validTo: 'summary' in checked ? checked.summary.validTo : null,
          problem: 'error' in checked ? checked.error : null,
        }
      })
      return { data }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:certificates:add', async (_, input: CertificateInput) => {
    try {
      const checked = validateCertificate(input)
      if ('error' in checked) return { error: checked.error }
      return { data: { id: addCertificate(input), summary: checked.summary } }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:certificates:delete', async (_, args: { id: string }) => {
    try { deleteCertificate(args.id); return { data: true } } catch (err) { return { error: String(err) } }
  })
}
