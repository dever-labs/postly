import axios, { AxiosRequestConfig } from 'axios'
import type { ExtractRule } from '../../shared/extract'
import https from 'https'
import { resolveProxy, describeProxyError, tlsIdentity, type ResolvedProxy } from './proxy'
import type { TlsSelection } from './certificates'
import { parseResponseCookies, type ResponseCookie } from './cookie-jar'

type LogLevel = 'info' | 'warn' | 'error'
export interface LogEntry { level: LogLevel; message: string; detail?: string }

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export interface HttpRequest {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
  bodyType: string
  authType: string
  authConfig: Record<string, string>
  folderId?: string
  sslVerification?: string
  /** Post-response rules; run by the IPC layer after the request completes. */
  extractRules?: ExtractRule[]
}

export interface HttpResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  duration: number
  size: number
  /** Cookies set by the response, including any redirect hops. */
  cookies?: ResponseCookie[]
}

/** Lets the caller decide which cookies are sent and where received cookies are kept. */
export interface CookieJarHook {
  enabled: boolean
  attach(url: string): { header: string; names: string[] }
  store(url: string, setCookie: string[]): ResponseCookie[]
}

const findHeader = (headers: Record<string, string>, name: string): string | undefined =>
  Object.keys(headers).find((k) => k.toLowerCase() === name)

const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? [v] : [])

function describeCookies(cookies: ResponseCookie[]): string {
  return cookies.map((c) => `${c.name} @ ${c.domain}${c.path}`).join(', ')
}

export async function executeRequest(
  req: HttpRequest,
  options: {
    sslVerification?: boolean
    followRedirects?: boolean
    timeout?: number
    signal?: AbortSignal
    onLog?: (entry: LogEntry) => void
    cookieJar?: CookieJarHook
    /** Client certificate and custom CA options for the target URL. */
    tlsFor?: (url: string) => TlsSelection
  } = {}
): Promise<HttpResponse> {
  const { sslVerification = true, followRedirects = true, timeout = 30000, signal, onLog, cookieJar, tlsFor } = options
  const log = (level: LogLevel, message: string, detail?: string) => onLog?.({ level, message, detail })
  const start = Date.now()

  const headers: Record<string, string> = { ...req.headers }

  if (req.authType === 'bearer' && req.authConfig.token) {
    headers['Authorization'] = `Bearer ${req.authConfig.token}`
  } else if (req.authType === 'jwt' && req.authConfig.token) {
    const prefix = req.authConfig.prefix?.trim() || 'Bearer'
    headers['Authorization'] = `${prefix} ${req.authConfig.token}`
  } else if (req.authType === 'oauth2' && req.authConfig.token) {
    headers['Authorization'] = `Bearer ${req.authConfig.token}`
  } else if (req.authType === 'basic' && req.authConfig.username) {
    const encoded = Buffer.from(`${req.authConfig.username}:${req.authConfig.password ?? ''}`).toString('base64')
    headers['Authorization'] = `Basic ${encoded}`
  }

  // NTLM — handled separately, bypasses axios
  if (req.authType === 'ntlm') {
    log('info', `→ ${req.method.toUpperCase()} ${req.url} (NTLM)`)
    return await executeNtlmRequest(req, headers, options)
  }

  let data: unknown = undefined

  const bodyType = req.bodyType

  if ((bodyType === 'raw-json' || bodyType === 'json') && req.body) {
    try { data = JSON.parse(req.body) } catch { data = req.body }
    if (!headers['Content-Type'] && !headers['content-type'])
      headers['Content-Type'] = 'application/json'

  } else if (bodyType === 'raw-javascript' && req.body) {
    data = req.body
    if (!headers['Content-Type'] && !headers['content-type'])
      headers['Content-Type'] = 'application/javascript'

  } else if (bodyType === 'raw-html' && req.body) {
    data = req.body
    if (!headers['Content-Type'] && !headers['content-type'])
      headers['Content-Type'] = 'text/html'

  } else if (bodyType === 'raw-xml' && req.body) {
    data = req.body
    if (!headers['Content-Type'] && !headers['content-type'])
      headers['Content-Type'] = 'application/xml'

  } else if ((bodyType === 'raw-text' || bodyType === 'raw') && req.body) {
    data = req.body
    if (!headers['Content-Type'] && !headers['content-type'])
      headers['Content-Type'] = 'text/plain'

  } else if (bodyType === 'x-www-form-urlencoded' && req.body) {
    const formData = new URLSearchParams()
    try {
      const parsed = JSON.parse(req.body) as Array<{ key: string; value: string; enabled: boolean }>
      for (const { key, value, enabled } of parsed) {
        if (enabled && key) formData.append(key, value)
      }
    } catch {
      req.body.split('&').forEach((pair) => {
        const [k, v] = pair.split('=')
        if (k) formData.append(decodeURIComponent(k), decodeURIComponent(v ?? ''))
      })
    }
    data = formData.toString()
    if (!headers['Content-Type'] && !headers['content-type'])
      headers['Content-Type'] = 'application/x-www-form-urlencoded'

  } else if (bodyType === 'form-data' && req.body) {
    // multipart/form-data — use FormData (Node 18+)
    const formData = new FormData()
    try {
      const parsed = JSON.parse(req.body) as Array<{ key: string; value: string; enabled: boolean; fieldType?: 'text' | 'file' }>
      for (const { key, value, enabled, fieldType } of parsed) {
        if (!enabled || !key) continue
        if (fieldType === 'file') {
          try {
            const fs = require('fs') as typeof import('fs')
            if (fs.existsSync(value)) {
              const stats = fs.statSync(value)
              if (stats.size > 100 * 1024 * 1024) throw new Error('File too large (max 100 MB)')
              const fileBuffer = await require('fs/promises').readFile(value)
              const blob = new Blob([fileBuffer])
              formData.append(key, blob, require('path').basename(value))
              continue
            }
          } catch { /* fall through to text */ }
        }
        formData.append(key, value)
      }
    } catch { /* nothing */ }
    data = formData
    // axios sets the Content-Type including boundary automatically for FormData

  } else if (bodyType === 'graphql' && req.body) {
    try {
      const { query, variables } = JSON.parse(req.body) as { query: string; variables: string }
      const vars = variables ? (() => { try { return JSON.parse(variables) } catch { return undefined } })() : undefined
      data = JSON.stringify({ query, variables: vars })
    } catch {
      data = req.body
    }
    if (!headers['Content-Type'] && !headers['content-type'])
      headers['Content-Type'] = 'application/json'

  } else if (bodyType === 'binary' && req.body) {
    try {
      const fs = require('fs') as typeof import('fs')
      if (fs.existsSync(req.body)) {
        const stats = fs.statSync(req.body)
        if (stats.size > 100 * 1024 * 1024) throw new Error('File too large (max 100 MB)')
        data = await require('fs/promises').readFile(req.body)
      }
    } catch { /* skip */ }
  }

  // Cookie values are never logged, only their names. A hand-written Cookie header wins over the jar.
  const manualCookie = findHeader(headers, 'cookie')
  const receivedCookies: ResponseCookie[] = []
  if (manualCookie) {
    log('info', 'Cookie header set on the request: cookies from the jar are not sent')
  } else if (cookieJar?.enabled) {
    const { header, names } = cookieJar.attach(req.url)
    if (header) {
      headers['Cookie'] = header
      log('info', `Cookies: sending ${names.length} from the jar (${names.join(', ')})`)
    }
  }
  const ingest = (url: string, setCookie: string[]) => {
    if (setCookie.length === 0) return
    const stored = cookieJar ? cookieJar.store(url, setCookie) : parseResponseCookies(url, setCookie)
    receivedCookies.push(...stored)
    const kept = stored.filter((c) => !c.rejected && !c.deleted)
    if (kept.length > 0) log('info', `Cookies: ${cookieJar?.enabled ? 'stored' : 'received (jar disabled, not stored)'} ${kept.length} (${describeCookies(kept)})`)
    const removed = stored.filter((c) => c.deleted)
    if (removed.length > 0) log('info', `Cookies: ${cookieJar?.enabled ? 'removed' : 'expired by the response'} ${removed.length} (${describeCookies(removed)})`)
    const dropped = stored.filter((c) => c.rejected)
    if (dropped.length > 0) log('warn', `Cookies: ignored ${dropped.length} (${describeCookies(dropped)})`)
  }

  const tlsSelection: TlsSelection = options.tlsFor?.(req.url) ?? { options: {}, customCaCount: 0 }
  const hasTls = Object.keys(tlsSelection.options).length > 0
  if (tlsSelection.clientCertificate) log('info', `Client certificate: "${tlsSelection.clientCertificate}" presented to ${new URL(req.url).host}`)
  if (tlsSelection.customCaCount > 0 && sslVerification) log('info', `Custom CA certificates: ${tlsSelection.customCaCount} trusted in addition to system roots`)

  let activeProxy: ResolvedProxy | null = null
  const initialIdentity = tlsIdentity(tlsSelection.options as Record<string, unknown>)

  // The agent is built for the first host. After a redirect to another host it must not keep presenting that
  // host's client certificate, and the new host may have its own, so the agent is rebuilt from the new selection.
  const retargetTls = (options: { href?: string; agent?: unknown; agents?: Record<string, unknown> }) => {
    if (!options.href?.startsWith('https:')) return
    const next = options.href ? (tlsFor?.(options.href) ?? { options: {}, customCaCount: 0 }) : tlsSelection
    const nextOptions = next.options as Record<string, unknown>
    if (tlsIdentity(nextOptions) === initialIdentity) return
    const hasNext = Object.keys(nextOptions).length > 0
    const agent = activeProxy?.withTls
      ? activeProxy.withTls(sslVerification, hasNext ? { options: nextOptions, key: tlsIdentity(nextOptions) } : undefined).httpsAgent
      // codeql[js/disabling-certificate-validation] -- intentional: user-controlled dev setting
      : new https.Agent({ rejectUnauthorized: sslVerification, ...next.options })
    options.agent = agent
    options.agents = { ...options.agents, https: agent }
    if (next.clientCertificate) log('info', `Client certificate: "${next.clientCertificate}" presented to ${new URL(options.href).host} after redirect`)
  }

  const config: AxiosRequestConfig = {
    method: req.method,
    url: req.url,
    headers,
    data,
    timeout,
    signal,
    maxRedirects: followRedirects ? 5 : 0,
    validateStatus: () => true,
    beforeRedirect: (options, responseDetails, requestDetails) => {
      retargetTls(options as Parameters<typeof retargetTls>[0])
      const from = requestDetails?.url ?? req.url
      ingest(from, asList(responseDetails.headers['set-cookie']))
      if (manualCookie || !cookieJar?.enabled) return
      const target = (options as { href?: string }).href ?? from
      const headerBag = options.headers as Record<string, string>
      for (const k of Object.keys(headerBag)) if (k.toLowerCase() === 'cookie') delete headerBag[k]
      const { header } = cookieJar.attach(target)
      if (header) headerBag['Cookie'] = header
    },
    // Proxying is resolved explicitly below so it can be logged; stop axios applying env proxies on top.
    proxy: false,
    // codeql[js/disabling-certificate-validation] -- intentional: user-controlled dev setting
    httpsAgent: sslVerification && !hasTls ? undefined : new https.Agent({ rejectUnauthorized: sslVerification, ...tlsSelection.options })
  }

  const proxy = await resolveProxy(req.url, {
    rejectUnauthorized: sslVerification,
    tls: hasTls ? { options: tlsSelection.options as Record<string, unknown>, key: tlsIdentity(tlsSelection.options as Record<string, unknown>) } : undefined,
  })
  activeProxy = proxy
  if (proxy) {
    config.httpAgent = proxy.httpAgent
    config.httpsAgent = proxy.httpsAgent
  }

  log('info', `→ ${req.method.toUpperCase()} ${req.url}`)
  log('info', proxy ? `Proxy: ${proxy.display}` : 'Proxy: none (direct)')

  try {
    const response = await axios(config)
    const duration = Date.now() - start
    const body =
      typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data, null, 2)

    const responseHeaders: Record<string, string> = {}
    for (const [k, v] of Object.entries(response.headers)) {
      responseHeaders[k] = Array.isArray(v) ? v.join(k.toLowerCase() === 'set-cookie' ? '\n' : ', ') : String(v ?? '')
    }
    const finalUrl = (response.request as { res?: { responseUrl?: string } } | undefined)?.res?.responseUrl ?? req.url
    ingest(finalUrl, asList(response.headers['set-cookie']))

    const size = Buffer.byteLength(body, 'utf8')
    const statusLine = `← ${response.status} ${response.statusText} (${duration}ms, ${formatBytes(size)})`
    if (response.status >= 400) log('warn', statusLine)
    else log('info', statusLine)

    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body,
      duration,
      size,
      cookies: receivedCookies
    }
  } catch (err: unknown) {
    const duration = Date.now() - start
    const message = err instanceof Error ? err.message : String(err)
    const shown = proxy ? describeProxyError(message, proxy) : message
    log('error', `Request failed: ${shown}`)
    return {
      status: 0,
      statusText: shown,
      headers: {},
      body: shown,
      duration,
      size: Buffer.byteLength(shown, 'utf8')
    }
  }
}

async function executeNtlmRequest(
  req: HttpRequest,
  headers: Record<string, string>,
  options: { sslVerification?: boolean; followRedirects?: boolean; timeout?: number; signal?: AbortSignal; onLog?: (entry: LogEntry) => void; tlsFor?: (url: string) => TlsSelection }
): Promise<HttpResponse> {
  const start = Date.now()
  const log = (level: LogLevel, message: string) => options.onLog?.({ level, message })

  if (options.signal?.aborted) {
    const msg = 'Request cancelled'
    log('info', msg)
    return { status: 0, statusText: msg, headers: {}, body: msg, duration: Date.now() - start, size: Buffer.byteLength(msg, 'utf8') }
  }

  const httpntlm = require('httpntlm') as Record<string, (opts: Record<string, unknown>, cb: (err: Error | null, res: { statusCode: number; headers: Record<string, string>; body: string }) => void) => void>
  const method = req.method.toLowerCase()
  const fn = httpntlm[method] ?? httpntlm['get']

  const ntlmOpts: Record<string, unknown> = {
    url: req.url,
    username: req.authConfig.username ?? '',
    password: req.authConfig.password ?? '',
    domain: req.authConfig.domain ?? '',
    workstation: req.authConfig.workstation ?? '',
    headers,
    // codeql[js/disabling-certificate-validation] -- intentional: user-controlled dev setting
    rejectUnauthorized: options.sslVerification ?? true,
    ...(options.tlsFor?.(req.url).options ?? {}),
  }
  if (req.body) ntlmOpts['body'] = req.body

  return new Promise((resolve) => {
    const onAbort = () => {
      const msg = 'Request cancelled'
      log('info', msg)
      resolve({ status: 0, statusText: msg, headers: {}, body: msg, duration: Date.now() - start, size: Buffer.byteLength(msg, 'utf8') })
    }

    options.signal?.addEventListener('abort', onAbort, { once: true })

    fn(ntlmOpts, (err, res) => {
      options.signal?.removeEventListener('abort', onAbort)
      if (options.signal?.aborted) return
      const duration = Date.now() - start
      if (err) {
        const msg = err.message
        log('error', `NTLM request failed: ${msg}`)
        resolve({ status: 0, statusText: msg, headers: {}, body: msg, duration, size: Buffer.byteLength(msg, 'utf8') })
        return
      }
      const body = res.body ?? ''
      const size = Buffer.byteLength(body, 'utf8')
      const statusLine = `← ${res.statusCode} (${duration}ms, ${formatBytes(size)})`
      if (res.statusCode >= 400) log('warn', statusLine)
      else log('info', statusLine)
      resolve({
        status: res.statusCode,
        statusText: '',
        headers: res.headers ?? {},
        body,
        duration,
        size
      })
    })
  })
}
