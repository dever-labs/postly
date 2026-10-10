import crypto from 'crypto'
import tls from 'tls'

export type CertificateKind = 'ca' | 'client'

/** One stored certificate. Key material and passphrase never leave the main process. */
export interface CertificateEntry {
  id: string
  kind: CertificateKind
  name: string
  /** Client certificates only: exact host, `*.example.com`, or `*`. */
  host: string
  /** Client certificates only: optional port, 0 meaning any. */
  port: number
  certPem: string
  keyPem: string
  pfxBase64: string
  passphrase: string
}

export interface CertificateInput {
  kind: CertificateKind
  name: string
  host?: string
  port?: number
  /** CA bundle or client certificate, PEM. */
  certPem?: string
  keyPem?: string
  pfxBase64?: string
  passphrase?: string
}

export interface CertificateSummary {
  subject: string
  /** Epoch ms, or null when it cannot be read (PFX). */
  validTo: number | null
  count: number
}

export interface TlsOptions {
  ca?: string[]
  cert?: string
  key?: string
  pfx?: Buffer
  passphrase?: string
}

export interface TlsSelection {
  options: TlsOptions
  /** Name of the client certificate that will be presented, if one matches. */
  clientCertificate?: string
  customCaCount: number
}

const PEM_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g

export function splitCertificates(pem: string): string[] {
  return pem.match(PEM_BLOCK) ?? []
}

function checkValidity(cert: crypto.X509Certificate, label: string): string | null {
  const now = Date.now()
  if (Date.parse(cert.validTo) < now) return `${label} expired on ${new Date(cert.validTo).toISOString().slice(0, 10)}`
  if (Date.parse(cert.validFrom) > now) return `${label} is not valid until ${new Date(cert.validFrom).toISOString().slice(0, 10)}`
  return null
}

function subjectOf(cert: crypto.X509Certificate): string {
  return cert.subject.replace(/\n/g, ', ')
}

/** Checks a certificate before it is saved. Returns a clear message on failure. */
export function validateCertificate(input: CertificateInput): { error: string } | { summary: CertificateSummary } {
  if (!input.name?.trim()) return { error: 'Give the certificate a name' }

  if (input.kind === 'ca') {
    const blocks = splitCertificates(input.certPem ?? '')
    if (blocks.length === 0) return { error: 'No PEM certificate found. A CA file starts with -----BEGIN CERTIFICATE-----' }
    let first: crypto.X509Certificate | null = null
    for (const [i, block] of blocks.entries()) {
      let cert: crypto.X509Certificate
      try { cert = new crypto.X509Certificate(block) } catch { return { error: `Certificate ${i + 1} in the file is not valid` } }
      const problem = checkValidity(cert, `Certificate ${i + 1}`)
      if (problem) return { error: problem }
      first ??= cert
    }
    return { summary: { subject: subjectOf(first as crypto.X509Certificate), validTo: Date.parse((first as crypto.X509Certificate).validTo), count: blocks.length } }
  }

  if (!input.host?.trim()) return { error: 'Enter the host this certificate is for, such as api.example.com or *.example.com' }
  if (!isValidHostPattern(input.host.trim())) return { error: 'Host can be a name, *.domain, or * (no scheme, path or port)' }
  if (input.port !== undefined && (!Number.isInteger(input.port) || input.port < 0 || input.port > 65535)) return { error: 'Port must be between 1 and 65535' }

  if (input.pfxBase64) {
    try {
      tls.createSecureContext({ pfx: Buffer.from(input.pfxBase64, 'base64'), passphrase: input.passphrase || undefined })
    } catch (e) {
      const msg = (e as Error).message
      return { error: /mac verify|password/i.test(msg) ? 'Could not open the PFX file: wrong or missing passphrase' : `Could not read the PFX file: ${msg}` }
    }
    return { summary: { subject: input.name.trim(), validTo: null, count: 1 } }
  }

  const [certBlock] = splitCertificates(input.certPem ?? '')
  if (!certBlock) return { error: 'Add a certificate (PEM) and its private key, or a PFX/PKCS#12 file' }
  let cert: crypto.X509Certificate
  try { cert = new crypto.X509Certificate(certBlock) } catch { return { error: 'The certificate file is not a valid PEM certificate' } }
  const problem = checkValidity(cert, 'The certificate')
  if (problem) return { error: problem }
  if (!input.keyPem?.trim()) return { error: 'Add the private key for this certificate' }
  let key: crypto.KeyObject
  try {
    key = crypto.createPrivateKey({ key: input.keyPem, passphrase: input.passphrase || undefined })
  } catch (e) {
    const msg = (e as Error).message
    return { error: /passphrase|decrypt|bad password|interrupted or cancelled/i.test(msg) ? 'The private key is encrypted: enter its passphrase' : 'The private key is not valid PEM' }
  }
  if (!cert.checkPrivateKey(key)) return { error: 'The private key does not belong to this certificate' }
  return { summary: { subject: subjectOf(cert), validTo: Date.parse(cert.validTo), count: 1 } }
}

export function isValidHostPattern(pattern: string): boolean {
  return pattern === '*' || /^(\*\.)?[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(pattern) || /^\[[0-9a-fA-F:]+\]$/.test(pattern)
}

const MQTT_TLS_SCHEMES = new Set(['mqtts:', 'ssl:', 'tls:'])
const TLS_SCHEMES = new Set(['https:', 'wss:', 'grpcs:', ...MQTT_TLS_SCHEMES])

/** Specificity of a match, or 0 for no match: exact host 3, wildcard domain 2, `*` 1. */
export function hostMatch(pattern: string, host: string): number {
  const p = pattern.trim().toLowerCase().replace(/^\[|\]$/g, '')
  const h = host.trim().toLowerCase()
  if (p === '*') return 1
  if (p.startsWith('*.')) return h.endsWith(p.slice(1)) && h.length > p.length - 1 ? 2 : 0
  return p === h ? 3 : 0
}

/** The client certificate to present for `url`: most specific host first, then a pinned port over "any port". */
export function pickClientCertificate(entries: CertificateEntry[], url: string): CertificateEntry | null {
  let target: URL
  try { target = new URL(url) } catch { return null }
  if (!TLS_SCHEMES.has(target.protocol)) return null
  const port = target.port ? Number(target.port) : MQTT_TLS_SCHEMES.has(target.protocol) ? 8883 : 443
  let best: { entry: CertificateEntry; score: number } | null = null
  for (const entry of entries) {
    if (entry.kind !== 'client') continue
    if (entry.port && entry.port !== port) continue
    const score = hostMatch(entry.host, target.hostname.replace(/^\[|\]$/g, '')) * 2 + (entry.port ? 1 : 0)
    if (score >= 2 && (!best || score > best.score)) best = { entry, score }
  }
  return best?.entry ?? null
}

/**
 * Node's `ca` option replaces the built-in trust store, so the bundled roots are added back:
 * custom CAs are trusted in addition to the usual ones.
 */
export function selectTlsOptions(entries: CertificateEntry[], url: string): TlsSelection {
  const customCas = entries.filter((e) => e.kind === 'ca').flatMap((e) => splitCertificates(e.certPem))
  const options: TlsOptions = {}
  if (customCas.length > 0) options.ca = [...tls.rootCertificates, ...customCas]
  const client = pickClientCertificate(entries, url)
  if (client) {
    if (client.pfxBase64) options.pfx = Buffer.from(client.pfxBase64, 'base64')
    else { options.cert = client.certPem; options.key = client.keyPem }
    if (client.passphrase) options.passphrase = client.passphrase
  }
  return { options, clientCertificate: client?.name, customCaCount: customCas.length }
}

/** Identity of the selection for agent caching, without exposing key material. */
export function tlsCacheKey(entries: CertificateEntry[], url: string): string {
  const sel = pickClientCertificate(entries, url)
  const cas = entries.filter((e) => e.kind === 'ca').map((e) => e.id).sort().join(',')
  return `${sel?.id ?? ''}|${cas}`
}
