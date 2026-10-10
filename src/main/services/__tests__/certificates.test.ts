import { describe, it, expect, beforeAll } from 'vitest'
import crypto from 'crypto'
import tls from 'tls'
import { hostMatch, isValidHostPattern, pickClientCertificate, selectTlsOptions, splitCertificates, validateCertificate } from '../certificates'
import { entry, makeCa, makeClient, makeExpired, type Pem } from './cert-helpers'

let ca: Pem
let client: Pem

beforeAll(async () => {
  ca = await makeCa()
  client = await makeClient(ca)
}, 30_000)

describe('validateCertificate', () => {
  it('accepts a CA bundle and counts its certificates', () => {
    const r = validateCertificate({ kind: 'ca', name: 'Corp', certPem: `${ca.cert}\n${client.cert}` })
    expect(r).toMatchObject({ summary: { count: 2 } })
  })
  it('rejects empty, malformed and expired CA files', async () => {
    expect(validateCertificate({ kind: 'ca', name: 'x', certPem: 'hello' })).toMatchObject({ error: expect.stringContaining('No PEM certificate') })
    expect(validateCertificate({ kind: 'ca', name: 'x', certPem: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----' })).toMatchObject({ error: expect.stringContaining('not valid') })
    const old = await makeExpired()
    expect(validateCertificate({ kind: 'ca', name: 'x', certPem: old.cert })).toMatchObject({ error: expect.stringContaining('expired on') })
  })
  it('accepts a matching PEM cert and key', () => {
    expect(validateCertificate({ kind: 'client', name: 'c', host: 'api.example.com', certPem: client.cert, keyPem: client.key })).toHaveProperty('summary')
  })
  it('requires a name, a host and a key', () => {
    expect(validateCertificate({ kind: 'client', name: '', host: 'a', certPem: client.cert, keyPem: client.key })).toHaveProperty('error')
    expect(validateCertificate({ kind: 'client', name: 'c', host: '', certPem: client.cert, keyPem: client.key })).toMatchObject({ error: expect.stringContaining('host') })
    expect(validateCertificate({ kind: 'client', name: 'c', host: 'https://a/b', certPem: client.cert, keyPem: client.key })).toMatchObject({ error: expect.stringContaining('Host') })
    expect(validateCertificate({ kind: 'client', name: 'c', host: 'a', certPem: client.cert })).toMatchObject({ error: expect.stringContaining('private key') })
  })
  it('rejects a key that does not belong to the certificate', async () => {
    const other = await makeClient(ca, 'other')
    expect(validateCertificate({ kind: 'client', name: 'c', host: 'a', certPem: client.cert, keyPem: other.key })).toMatchObject({ error: expect.stringContaining('does not belong') })
  })
  it('rejects an expired client certificate', async () => {
    const old = await makeExpired()
    expect(validateCertificate({ kind: 'client', name: 'c', host: 'a', certPem: old.cert, keyPem: old.key })).toMatchObject({ error: expect.stringContaining('expired on') })
  })
  it('handles encrypted keys: passphrase required, wrong one rejected, right one accepted', () => {
    const encrypted = crypto.createPrivateKey(client.key).export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'pw' }).toString()
    const base = { kind: 'client' as const, name: 'c', host: 'a', certPem: client.cert, keyPem: encrypted }
    expect(validateCertificate(base)).toMatchObject({ error: expect.stringContaining('passphrase') })
    expect(validateCertificate({ ...base, passphrase: 'nope' })).toMatchObject({ error: expect.stringContaining('passphrase') })
    expect(validateCertificate({ ...base, passphrase: 'pw' })).toHaveProperty('summary')
  })
  it('rejects garbage PFX data', () => {
    expect(validateCertificate({ kind: 'client', name: 'c', host: 'a', pfxBase64: Buffer.from('not a pfx').toString('base64') })).toMatchObject({ error: expect.stringContaining('PFX') })
  })
})

describe('host matching', () => {
  it('ranks exact over wildcard over star', () => {
    expect(hostMatch('api.example.com', 'API.example.com')).toBe(3)
    expect(hostMatch('*.example.com', 'a.example.com')).toBe(2)
    expect(hostMatch('*.example.com', 'example.com')).toBe(0)
    expect(hostMatch('*.example.com', 'evilexample.com')).toBe(0)
    expect(hostMatch('*', 'anything')).toBe(1)
    expect(hostMatch('a.com', 'b.com')).toBe(0)
  })
  it('validates host patterns', () => {
    for (const ok of ['a.com', '*.a.com', '*', 'localhost', '127.0.0.1']) expect(isValidHostPattern(ok)).toBe(true)
    for (const bad of ['a.com:8443', 'https://a.com', 'a/b', '', 'a *']) expect(isValidHostPattern(bad)).toBe(false)
  })
  it('picks the most specific certificate and respects ports and schemes', () => {
    const star = entry({ name: 'star', host: '*' })
    const wild = entry({ name: 'wild', host: '*.example.com' })
    const exact = entry({ name: 'exact', host: 'api.example.com' })
    const pinned = entry({ name: 'pinned', host: 'api.example.com', port: 8443 })
    const all = [star, wild, exact, pinned]
    expect(pickClientCertificate(all, 'https://api.example.com/x')?.name).toBe('exact')
    expect(pickClientCertificate(all, 'https://api.example.com:8443/x')?.name).toBe('pinned')
    expect(pickClientCertificate(all, 'https://api.example.com:9000/x')?.name).toBe('exact')
    expect(pickClientCertificate(all, 'https://b.example.com')?.name).toBe('wild')
    expect(pickClientCertificate(all, 'https://other.org')?.name).toBe('star')
    expect(pickClientCertificate(all, 'http://api.example.com')).toBeNull()
    expect(pickClientCertificate([], 'https://x')).toBeNull()
    const broker = entry({ name: 'broker', host: 'mq.example.com', port: 8883 })
    for (const scheme of ['mqtts', 'ssl', 'tls']) expect(pickClientCertificate([broker], `${scheme}://mq.example.com`)?.name).toBe('broker')
  })
})

describe('selectTlsOptions', () => {
  it('adds custom CAs on top of the bundled roots', () => {
    const sel = selectTlsOptions([entry({ kind: 'ca', name: 'ca', certPem: ca.cert })], 'https://x')
    expect(sel.customCaCount).toBe(1)
    expect(sel.options.ca?.length).toBe(tls.rootCertificates.length + 1)
    expect(sel.options.ca).toContain(splitCertificates(ca.cert)[0])
    expect(sel.clientCertificate).toBeUndefined()
  })
  it('presents the matching client certificate with its passphrase', () => {
    const sel = selectTlsOptions([entry({ name: 'me', host: 'x.com', certPem: client.cert, keyPem: client.key, passphrase: 'pw' })], 'https://x.com')
    expect(sel).toMatchObject({ clientCertificate: 'me', options: { cert: client.cert, key: client.key, passphrase: 'pw' } })
    expect(selectTlsOptions([entry({ name: 'me', host: 'x.com', certPem: client.cert, keyPem: client.key })], 'https://y.com').options).toEqual({})
  })
})
