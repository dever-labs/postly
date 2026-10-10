/**
 * Real HTTPS server that requires a client certificate and uses a private CA:
 * custom CA trust, client certificate presentation, and the failure modes without them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import https from 'https'
import type { AddressInfo } from 'net'
import type { TLSSocket } from 'tls'
import { executeRequest, type HttpRequest, type LogEntry } from '../http-executor'
import { selectTlsOptions, type CertificateEntry } from '../certificates'
import { entry, makeCa, makeClient, makeServer } from './cert-helpers'

let server: https.Server
let base = ''
let caEntry: CertificateEntry
let clientEntry: CertificateEntry

beforeAll(async () => {
  const ca = await makeCa()
  const serverPem = await makeServer(ca)
  const client = await makeClient(ca, 'alice')
  server = https.createServer(
    { key: serverPem.key, cert: serverPem.cert, ca: [ca.cert], requestCert: true, rejectUnauthorized: true },
    (req, res) => {
      const peer = (req.socket as TLSSocket).getPeerCertificate()
      res.end(JSON.stringify({ client: peer?.subject?.CN ?? null }))
    }
  )
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `https://127.0.0.1:${(server.address() as AddressInfo).port}`
  caEntry = entry({ kind: 'ca', name: 'Test CA', certPem: ca.cert })
  clientEntry = entry({ name: 'alice', host: '127.0.0.1', certPem: client.cert, keyPem: client.key })
}, 60_000)

afterAll(() => { server.close() })

const request = (): HttpRequest => ({ method: 'GET', url: `${base}/who`, headers: {}, bodyType: 'none', authType: 'none', authConfig: {} })

async function send(entries: CertificateEntry[], sslVerification = true) {
  const logs: LogEntry[] = []
  const res = await executeRequest(request(), { sslVerification, tlsFor: (url) => selectTlsOptions(entries, url), onLog: (l) => logs.push(l) })
  return { res, logs }
}

describe('client certificates', () => {
  it('presents the matching client certificate and trusts the private CA', async () => {
    const { res, logs } = await send([caEntry, clientEntry])
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ client: 'alice' })
    expect(logs.some((l) => l.message.includes('Client certificate: "alice" presented to 127.0.0.1'))).toBe(true)
    expect(logs.some((l) => l.message.includes('Custom CA certificates: 1'))).toBe(true)
  })

  it('fails the TLS handshake when no client certificate is configured', async () => {
    const { res } = await send([caEntry])
    expect(res.status).toBe(0)
  })

  it('rejects the server when its CA is not trusted and verification is on', async () => {
    const { res } = await send([clientEntry])
    expect(res.status).toBe(0)
    expect(res.body).toMatch(/certificate|self.signed|unable to verify/i)
  })

  it('still presents the certificate with verification disabled', async () => {
    const { res, logs } = await send([clientEntry], false)
    expect(res.status).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ client: 'alice' })
    expect(logs.some((l) => l.message.includes('Custom CA'))).toBe(false)
  })

  it('does not present a certificate configured for another host', async () => {
    const { res, logs } = await send([caEntry, { ...clientEntry, host: 'other.example.com' }])
    expect(res.status).toBe(0)
    expect(logs.some((l) => l.message.includes('Client certificate'))).toBe(false)
  })
})
