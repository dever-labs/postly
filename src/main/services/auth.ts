/** Request signing and credential placement for API key, Digest and AWS Signature V4 authentication. */
import crypto from 'crypto'

export type Headers = Record<string, string>

/** Shows enough of an identifier to recognise it without exposing it. */
export const maskTail = (value: string): string => (value.length <= 8 ? '••••' : `••••${value.slice(-4)}`)

// ── API key ───────────────────────────────────────────────────────────────────

export interface ApiKeyResult { url: string; headers: Headers; description: string }

export function applyApiKey(url: string, headers: Headers, config: Record<string, string>): ApiKeyResult | null {
  const name = (config.key ?? '').trim()
  const value = config.value ?? ''
  if (!name || !value) return null
  if (config.in === 'query') {
    const hashAt = url.indexOf('#')
    const base = hashAt === -1 ? url : url.slice(0, hashAt)
    const hash = hashAt === -1 ? '' : url.slice(hashAt)
    const joiner = base.includes('?') ? (/[?&]$/.test(base) ? '' : '&') : '?'
    return { url: `${base}${joiner}${encodeURIComponent(name)}=${encodeURIComponent(value)}${hash}`, headers, description: `API key "${name}" added as a query parameter (value hidden)` }
  }
  return { url, headers: { ...headers, [name]: value }, description: `API key sent in the "${name}" header (value hidden)` }
}

// ── Digest ────────────────────────────────────────────────────────────────────

export interface DigestChallenge {
  realm: string
  nonce: string
  opaque?: string
  algorithm: string
  qop: string[]
}

export function parseDigestChallenge(header: string | undefined): DigestChallenge | null {
  if (!header) return null
  // A response can offer several schemes; take the Digest one.
  const match = /(?:^|,\s*)Digest\s+(.*)$/is.exec(header)
  if (!match) return null
  const params: Record<string, string> = {}
  const re = /([a-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]*))/gi
  for (let m = re.exec(match[1]); m; m = re.exec(match[1])) params[m[1].toLowerCase()] = m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : m[3]
  if (!params.realm || !params.nonce) return null
  return {
    realm: params.realm,
    nonce: params.nonce,
    opaque: params.opaque,
    algorithm: params.algorithm ?? 'MD5',
    qop: (params.qop ?? '').split(',').map((q) => q.trim().toLowerCase()).filter(Boolean),
  }
}

const DIGEST_HASHES: Record<string, string> = { md5: 'md5', 'sha-256': 'sha256', 'sha-512-256': 'sha512-256' }

export function isSupportedDigestAlgorithm(algorithm: string): boolean {
  return (algorithm.toLowerCase().replace(/-sess$/, '')) in DIGEST_HASHES
}

export function buildDigestHeader(opts: {
  challenge: DigestChallenge
  username: string
  password: string
  method: string
  /** Request target as sent: path plus query. */
  uri: string
  cnonce?: string
  nonceCount?: number
}): string {
  const { challenge, username, password, method, uri } = opts
  const lower = challenge.algorithm.toLowerCase()
  const session = lower.endsWith('-sess')
  const hashName = DIGEST_HASHES[lower.replace(/-sess$/, '')] ?? 'md5'
  // MD5 and SHA-256 here are mandated by the Digest protocol (RFC 7616), not a storage choice.
  const hash = (s: string) => crypto.createHash(hashName).update(s).digest('hex') // codeql[js/weak-cryptographic-algorithm]
  const qop = challenge.qop.includes('auth') ? 'auth' : undefined
  const cnonce = opts.cnonce ?? crypto.randomBytes(8).toString('hex')
  const nc = (opts.nonceCount ?? 1).toString(16).padStart(8, '0')

  let ha1 = hash(`${username}:${challenge.realm}:${password}`)
  if (session) ha1 = hash(`${ha1}:${challenge.nonce}:${cnonce}`)
  const ha2 = hash(`${method.toUpperCase()}:${uri}`)
  const response = qop
    ? hash(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : hash(`${ha1}:${challenge.nonce}:${ha2}`)

  const quote = (v: string) => `"${v.replace(/(["\\])/g, '\\$1')}"`
  const parts = [
    `username=${quote(username)}`,
    `realm=${quote(challenge.realm)}`,
    `nonce=${quote(challenge.nonce)}`,
    `uri=${quote(uri)}`,
    `algorithm=${challenge.algorithm}`,
    `response=${quote(response)}`,
  ]
  if (challenge.opaque) parts.push(`opaque=${quote(challenge.opaque)}`)
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce=${quote(cnonce)}`)
  return `Digest ${parts.join(', ')}`
}

// ── AWS Signature Version 4 ───────────────────────────────────────────────────

export interface SigV4Config {
  accessKey: string
  secretKey: string
  sessionToken?: string
  region: string
  service: string
}

export interface SigV4Result {
  headers: Headers
  signedHeaders: string
}

const sha256Hex = (data: string | Buffer) => crypto.createHash('sha256').update(data).digest('hex')
const hmac = (key: string | Buffer, data: string) => crypto.createHmac('sha256', key).update(data).digest()

/** RFC 3986 encoding as AWS requires: everything except unreserved characters is percent-encoded. */
const awsEncode = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

function canonicalPath(pathname: string, service: string): string {
  const segments = pathname.split('/').map((seg) => {
    let decoded = seg
    try { decoded = decodeURIComponent(seg) } catch { /* keep as written */ }
    return awsEncode(decoded)
  })
  // Every service except S3 encodes the path a second time.
  const path = segments.join('/') || '/'
  return service === 's3' ? path : path.split('/').map(awsEncode).join('/')
}

function canonicalQuery(search: URLSearchParams): string {
  return [...search.entries()]
    .map(([k, v]) => [awsEncode(k), awsEncode(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
}

/**
 * Signs a request. `body` must be the exact bytes sent; pass `null` for payloads that cannot be hashed
 * up front (multipart streams), which are sent as UNSIGNED-PAYLOAD.
 */
export function signAwsV4(opts: {
  method: string
  url: string
  headers: Headers
  body: string | Buffer | null | undefined
  config: SigV4Config
  now?: Date
}): SigV4Result {
  const { method, config } = opts
  const target = new URL(opts.url)
  const now = opts.now ?? new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = opts.body === null ? 'UNSIGNED-PAYLOAD' : sha256Hex(opts.body ?? '')

  const toSign: Headers = { host: target.host, 'x-amz-date': amzDate }
  if (config.service === 's3') toSign['x-amz-content-sha256'] = payloadHash
  if (config.sessionToken) toSign['x-amz-security-token'] = config.sessionToken
  for (const [k, v] of Object.entries(opts.headers)) {
    const name = k.toLowerCase()
    if (name === 'content-type' || (name.startsWith('x-amz-') && !(name in toSign))) toSign[name] = String(v)
  }

  const names = Object.keys(toSign).sort()
  const canonicalHeaders = names.map((n) => `${n}:${toSign[n].trim().replace(/\s+/g, ' ')}\n`).join('')
  const signedHeaders = names.join(';')
  const canonicalRequest = [
    method.toUpperCase(),
    canonicalPath(target.pathname, config.service),
    canonicalQuery(target.searchParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const scope = `${dateStamp}/${config.region}/${config.service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.secretKey}`, dateStamp), config.region), config.service), 'aws4_request')
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  const out: Headers = {
    'X-Amz-Date': amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
  if (config.service === 's3') out['X-Amz-Content-Sha256'] = payloadHash
  if (config.sessionToken) out['X-Amz-Security-Token'] = config.sessionToken
  return { headers: out, signedHeaders }
}
