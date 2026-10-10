import crypto from 'crypto'
import { queryAll, run } from '../database'
import type { CertificateEntry, CertificateInput } from './certificates'

interface Row {
  id: string; kind: string; name: string; host: string; port: number
  cert_pem: string; key_pem: string; pfx_b64: string; passphrase: string
}

const toEntry = (r: Row): CertificateEntry => ({
  id: r.id, kind: r.kind === 'ca' ? 'ca' : 'client', name: r.name, host: r.host ?? '', port: r.port ?? 0,
  certPem: r.cert_pem ?? '', keyPem: r.key_pem ?? '', pfxBase64: r.pfx_b64 ?? '', passphrase: r.passphrase ?? '',
})

/** Includes key material: for the main process only. The renderer gets `listCertificateSummaries`. */
export function listCertificates(): CertificateEntry[] {
  return queryAll<Row>('SELECT * FROM certificates ORDER BY created_at ASC').map(toEntry)
}

export function addCertificate(input: CertificateInput): string {
  const id = crypto.randomUUID()
  run(
    `INSERT INTO certificates (id, kind, name, host, port, cert_pem, key_pem, pfx_b64, passphrase, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.kind, input.name.trim(), input.kind === 'client' ? (input.host ?? '').trim() : '', input.kind === 'client' ? (input.port ?? 0) : 0,
      input.certPem ?? '', input.keyPem ?? '', input.pfxBase64 ?? '', input.passphrase ?? '', Date.now()]
  )
  return id
}

export function deleteCertificate(id: string): void {
  run('DELETE FROM certificates WHERE id = ?', [id])
}
