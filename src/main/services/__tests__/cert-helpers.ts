import { generate } from 'selfsigned'
import type { CertificateEntry } from '../certificates'

export interface Pem { cert: string; key: string }

const day = 86_400_000

async function make(cn: string, extra: Record<string, unknown> = {}): Promise<Pem> {
  const out = await generate([{ name: 'commonName', value: cn }], {
    algorithm: 'sha256',
    notBeforeDate: new Date(Date.now() - day),
    notAfterDate: new Date(Date.now() + 30 * day),
    ...extra,
  } as never)
  return { cert: out.cert, key: out.private }
}

export const makeCa = (cn = 'Postly Test CA') => make(cn, { extensions: [{ name: 'basicConstraints', cA: true }] })

export const makeServer = (ca: Pem) => make('localhost', {
  ca: { key: ca.key, cert: ca.cert },
  extensions: [{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }, { type: 2, value: 'localhost' }] }],
})

export const makeClient = (ca: Pem, cn = 'postly-client', extra: Record<string, unknown> = {}) =>
  make(cn, { ca: { key: ca.key, cert: ca.cert }, clientCertificate: true, ...extra })

export const makeExpired = async (): Promise<Pem> => {
  const out = await generate([{ name: 'commonName', value: 'old' }], {
    algorithm: 'sha256', notBeforeDate: new Date(Date.now() - 10 * day), notAfterDate: new Date(Date.now() - day),
  } as never)
  return { cert: out.cert, key: out.private }
}

export function entry(over: Partial<CertificateEntry>): CertificateEntry {
  return { id: over.name ?? 'x', kind: 'client', name: 'x', host: '', port: 0, certPem: '', keyPem: '', pfxBase64: '', passphrase: '', ...over }
}
