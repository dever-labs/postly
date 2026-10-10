import crypto from 'crypto'
import https from 'https'
import type { Agent } from 'http'
import { HttpProxyAgent } from 'http-proxy-agent'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { queryOne } from '../database'

export type ProxyMode = 'system' | 'manual' | 'none'

export interface ProxySettings {
  mode: ProxyMode
  /** http://, https://, socks4://, socks5:// URL of the proxy (manual mode). */
  url: string
  username: string
  password: string
  /** Comma/space separated NO_PROXY style list. */
  bypass: string
}

export const PROXY_DEFAULTS: ProxySettings = { mode: 'system', url: '', username: '', password: '', bypass: '' }

export function parseProxySettings(value: string | undefined): ProxySettings {
  const result = { ...PROXY_DEFAULTS }
  if (!value) return result
  try {
    const p = JSON.parse(value) as Record<string, unknown>
    if (p.mode === 'system' || p.mode === 'manual' || p.mode === 'none') result.mode = p.mode
    for (const k of ['url', 'username', 'password', 'bypass'] as const) {
      if (typeof p[k] === 'string') result[k] = p[k] as string
    }
  } catch { /* defaults */ }
  return result
}

export function getProxySettings(): ProxySettings {
  try {
    return parseProxySettings(queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['proxy'])?.value)
  } catch {
    return { ...PROXY_DEFAULTS }
  }
}

/** Settings as shown to the renderer: the password is replaced by a flag. */
export function toPublicProxySettings(s: ProxySettings): Omit<ProxySettings, 'password'> & { hasPassword: boolean } {
  const { password, ...rest } = s
  return { ...rest, url: splitUrlCredentials(s.url).url, hasPassword: password !== '' }
}

/** Moves credentials typed into the proxy URL (http://user:pass@host) into separate fields. */
export function splitUrlCredentials(raw: string): { url: string; username: string; password: string } {
  const trimmed = raw.trim()
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`)
    if (!u.username && !u.password) return { url: trimmed, username: '', password: '' }
    const username = decodeURIComponent(u.username)
    const password = decodeURIComponent(u.password)
    u.username = ''
    u.password = ''
    const hadScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    const out = u.toString().replace(/\/$/, '')
    return { url: hadScheme ? out : out.replace(/^http:\/\//, ''), username, password }
  } catch {
    return { url: trimmed, username: '', password: '' }
  }
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const part of parts) {
    const v = Number(part)
    if (!/^\d+$/.test(part) || v > 255) return null
    n = n * 256 + v
  }
  return n
}

function inCidr(host: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split('/')
  const bits = Number(bitsRaw)
  const h = ipv4ToInt(host)
  const b = ipv4ToInt(base)
  if (h === null || b === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false
  if (bits === 0) return true
  const mask = (0xffffffff << (32 - bits)) >>> 0
  return ((h & mask) >>> 0) === ((b & mask) >>> 0)
}

/** Splits a NO_PROXY entry into host pattern and optional port, handling [ipv6]:port. */
function splitEntry(entry: string): [string, string] {
  const bracket = /^\[([^\]]+)\](?::(\d+))?$/.exec(entry)
  if (bracket) return [bracket[1], bracket[2] ?? '']
  const parts = entry.split(':')
  return parts.length === 2 ? [parts[0], parts[1]] : [entry, '']
}

/** Returns true when `url` matches a NO_PROXY style pattern list (hosts, .suffixes, host:port, IPv4 CIDR, *). */
export function isBypassed(url: URL, bypass: string): boolean {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const port = url.port || (url.protocol === 'https:' ? '443' : '80')
  for (const raw of bypass.split(/[\s,]+/)) {
    const entry = raw.trim().toLowerCase()
    if (!entry) continue
    if (entry === '*') return true
    const [pattern, entryPort] = splitEntry(entry)
    if (entryPort && entryPort !== port) continue
    if (pattern.includes('/') && inCidr(host, pattern)) return true
    const bare = pattern.replace(/^\*?\./, '')
    if (host === bare || host.endsWith(`.${bare}`)) return true
  }
  return false
}

function withCredentials(proxyUrl: string, username: string, password: string): string {
  if (!username) return proxyUrl
  const u = new URL(proxyUrl)
  u.username = encodeURIComponent(username)
  u.password = encodeURIComponent(password)
  return u.toString()
}

function normalizeProxyUrl(raw: string): string {
  const trimmed = raw.trim()
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`
}

function fromEnvironment(url: URL): string | null {
  const env = process.env
  const noProxy = env.NO_PROXY ?? env.no_proxy ?? ''
  if (isBypassed(url, noProxy)) return null
  const value = url.protocol === 'https:'
    ? env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy
    : env.HTTP_PROXY ?? env.http_proxy
  return value ? normalizeProxyUrl(value) : null
}

/** Converts Electron's "PROXY host:port; DIRECT" PAC result to a proxy URL. */
export function parsePacResult(result: string): string | null {
  for (const part of result.split(';')) {
    const [kind, hostPort] = part.trim().split(/\s+/)
    if (!kind || !hostPort) continue
    switch (kind.toUpperCase()) {
      case 'PROXY': return `http://${hostPort}`
      case 'HTTPS': return `https://${hostPort}`
      case 'SOCKS':
      case 'SOCKS5': return `socks5://${hostPort}`
      case 'SOCKS4': return `socks4://${hostPort}`
      case 'DIRECT': return null
    }
  }
  return null
}

async function fromSystem(url: URL): Promise<string | null> {
  const env = fromEnvironment(url)
  if (env) return env
  try {
    const { session } = await import('electron')
    return parsePacResult(await session.defaultSession.resolveProxy(url.toString()))
  } catch {
    return null
  }
}

export interface ResolvedProxy {
  /** Proxy URL with credentials removed, safe to log. */
  display: string
  httpAgent: Agent
  httpsAgent: Agent
  /** Same proxy with different TLS options, for a redirect to another host. */
  withTls?: (rejectUnauthorized: boolean, tls?: ProxyTls) => ResolvedProxy
}

const agentCache = new Map<string, ResolvedProxy>()

export interface ProxyTls {
  options: Record<string, unknown>
  /** Distinguishes agents built with different certificates. */
  key: string
}

type TlsProvider = (url: string) => { options: object }
let tlsProvider: TlsProvider | null = null

/** Lets the certificate store supply TLS options to the axios interceptor without this module depending on the database. */
export function setTlsProvider(provider: TlsProvider): void { tlsProvider = provider }

function buildAgents(proxyUrl: string, rejectUnauthorized: boolean, extra?: ProxyTls): ResolvedProxy {
  const key = `${proxyUrl}|${rejectUnauthorized}|${extra?.key ?? ''}`
  const cached = agentCache.get(key)
  if (cached) return cached

  const u = new URL(proxyUrl)
  const display = `${u.protocol}//${u.host}`
  const tls = { rejectUnauthorized, ...(extra?.options ?? {}) }
  const resolved: ResolvedProxy = u.protocol.startsWith('socks')
    ? (() => {
        const agent = new SocksProxyAgent(proxyUrl, tls as ConstructorParameters<typeof SocksProxyAgent>[1])
        return { display, httpAgent: agent, httpsAgent: agent }
      })()
    : { display, httpAgent: new HttpProxyAgent(proxyUrl, tls), httpsAgent: new HttpsProxyAgent(proxyUrl, tls) }
  resolved.withTls = (reject, tlsOverride) => buildAgents(proxyUrl, reject, tlsOverride)
  if (agentCache.size > 20) agentCache.clear()
  agentCache.set(key, resolved)
  return resolved
}

/**
 * Decides whether `targetUrl` should go through a proxy and returns agents for it.
 * Returns null for direct connections.
 */
export async function resolveProxy(
  targetUrl: string,
  opts: { rejectUnauthorized?: boolean; settings?: ProxySettings; tls?: ProxyTls } = {}
): Promise<ResolvedProxy | null> {
  let url: URL
  try { url = new URL(targetUrl) } catch { return null }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

  const settings = opts.settings ?? getProxySettings()
  let proxyUrl: string | null = null
  if (settings.mode === 'manual') {
    if (!settings.url.trim() || isBypassed(url, settings.bypass)) return null
    proxyUrl = withCredentials(normalizeProxyUrl(settings.url), settings.username, settings.password)
  } else if (settings.mode === 'system') {
    proxyUrl = await fromSystem(url)
  }
  if (!proxyUrl) return null
  return buildAgents(proxyUrl, opts.rejectUnauthorized ?? true, opts.tls)
}

/** Maps low-level proxy failures to an actionable message. */
export function describeProxyError(message: string, proxy: ResolvedProxy): string {
  if (/407|Proxy Authentication/i.test(message)) {
    return `Proxy ${proxy.display} requires authentication. Check the username and password in Settings → Network.`
  }
  if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT/i.test(message)) {
    return `Could not reach proxy ${proxy.display} (${message}). Check the proxy address in Settings → Network, or set the mode to "None".`
  }
  return message
}

/** Cheap fingerprint of TLS options for cache keys; never logged. */
export function tlsIdentity(options: Record<string, unknown>): string {
  return crypto.createHash('sha256').update(JSON.stringify(options, (_, v) => (Buffer.isBuffer(v) ? v.toString('base64') : v))).digest('hex').slice(0, 16)
}

let interceptorInstalled = false

/**
 * Routes every other axios call in the main process (OAuth, Backstage, GitHub, GitLab…)
 * through the configured proxy. Requests that already handle proxying set `proxy: false`.
 */
export function installAxiosProxy(axiosInstance: import('axios').AxiosInstance): void {
  if (interceptorInstalled) return
  interceptorInstalled = true
  axiosInstance.interceptors.request.use(async (config) => {
    if (config.proxy === false || !config.url) return config
    const target = config.baseURL ? new URL(config.url, config.baseURL).toString() : config.url
    const existing = config.httpsAgent as { options?: { rejectUnauthorized?: boolean } } | undefined
    const rejectUnauthorized = existing?.options?.rejectUnauthorized !== false
    const selected = (tlsProvider?.(target).options ?? {}) as Record<string, unknown>
    const hasTls = Object.keys(selected).length > 0
    const proxy = await resolveProxy(target, {
      rejectUnauthorized,
      tls: hasTls ? { options: selected, key: tlsIdentity(selected) } : undefined,
    })
    if (proxy) {
      config.httpAgent = proxy.httpAgent
      config.httpsAgent = proxy.httpsAgent
      config.proxy = false
    } else if (hasTls) {
      // codeql[js/disabling-certificate-validation] -- rejectUnauthorized keeps the caller's own setting
      config.httpsAgent = new https.Agent({ rejectUnauthorized, ...selected })
    }
    return config
  })
}
