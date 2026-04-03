import axios, { AxiosRequestConfig } from 'axios'
import https from 'https'

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
  groupId?: string
  sslVerification?: string
}

export interface HttpResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  duration: number
  size: number
}

export async function executeRequest(
  req: HttpRequest,
  options: {
    sslVerification?: boolean
    followRedirects?: boolean
    timeout?: number
    onLog?: (entry: LogEntry) => void
  } = {}
): Promise<HttpResponse> {
  const { sslVerification = true, followRedirects = true, timeout = 30000, onLog } = options
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
              const blob = new Blob([fs.readFileSync(value)])
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
        data = fs.readFileSync(req.body)
      }
    } catch { /* skip */ }
  }

  const config: AxiosRequestConfig = {
    method: req.method,
    url: req.url,
    headers,
    data,
    timeout,
    maxRedirects: followRedirects ? 5 : 0,
    validateStatus: () => true,
    // lgtm[js/disabling-certificate-validation] — intentional user-controlled opt-in for self-signed certificates
    httpsAgent: sslVerification ? undefined : new https.Agent({ rejectUnauthorized: false })
  }

  log('info', `→ ${req.method.toUpperCase()} ${req.url}`)

  try {
    const response = await axios(config)
    const duration = Date.now() - start
    const body =
      typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data, null, 2)

    const responseHeaders: Record<string, string> = {}
    for (const [k, v] of Object.entries(response.headers)) {
      responseHeaders[k] = Array.isArray(v) ? v.join(', ') : String(v ?? '')
    }

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
      size
    }
  } catch (err: unknown) {
    const duration = Date.now() - start
    const message = err instanceof Error ? err.message : String(err)
    log('error', `Request failed: ${message}`)
    return {
      status: 0,
      statusText: message,
      headers: {},
      body: message,
      duration,
      size: Buffer.byteLength(message, 'utf8')
    }
  }
}

async function executeNtlmRequest(
  req: HttpRequest,
  headers: Record<string, string>,
  options: { sslVerification?: boolean; followRedirects?: boolean; timeout?: number; onLog?: (entry: LogEntry) => void }
): Promise<HttpResponse> {
  const start = Date.now()
  const log = (level: LogLevel, message: string) => options.onLog?.({ level, message })
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
    rejectUnauthorized: options.sslVerification ?? true,
  }
  if (req.body) ntlmOpts['body'] = req.body

  return new Promise((resolve) => {
    fn(ntlmOpts, (err, res) => {
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
