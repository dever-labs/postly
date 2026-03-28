import axios, { AxiosRequestConfig } from 'axios'

export interface HttpRequest {
  method: string
  url: string
  headers: Record<string, string>
  body?: string
  bodyType: string
  authType: string
  authConfig: Record<string, string>
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
  options: { sslVerification?: boolean; followRedirects?: boolean; timeout?: number } = {}
): Promise<HttpResponse> {
  const { sslVerification = true, followRedirects = true, timeout = 30000 } = options
  const start = Date.now()

  const headers: Record<string, string> = { ...req.headers }

  if (req.authType === 'bearer' && req.authConfig.token) {
    headers['Authorization'] = `Bearer ${req.authConfig.token}`
  } else if (req.authType === 'oauth2' && req.authConfig.token) {
    headers['Authorization'] = `Bearer ${req.authConfig.token}`
  } else if (req.authType === 'basic' && req.authConfig.username) {
    const encoded = Buffer.from(`${req.authConfig.username}:${req.authConfig.password ?? ''}`).toString('base64')
    headers['Authorization'] = `Basic ${encoded}`
  }

  let data: unknown = undefined
  if (req.bodyType === 'json' && req.body) {
    try {
      data = JSON.parse(req.body)
    } catch {
      data = req.body
    }
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json'
    }
  } else if (req.bodyType === 'form-data' && req.body) {
    const formData = new URLSearchParams()
    try {
      const parsed = JSON.parse(req.body) as Array<{ key: string; value: string }>
      for (const { key, value } of parsed) {
        formData.append(key, value)
      }
    } catch {
      // treat as raw string pairs key=value&...
      req.body.split('&').forEach((pair) => {
        const [k, v] = pair.split('=')
        if (k) formData.append(decodeURIComponent(k), decodeURIComponent(v ?? ''))
      })
    }
    data = formData.toString()
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded'
    }
  } else if (req.bodyType === 'raw' && req.body) {
    data = req.body
  }

  const config: AxiosRequestConfig = {
    method: req.method,
    url: req.url,
    headers,
    data,
    timeout,
    maxRedirects: followRedirects ? 5 : 0,
    validateStatus: () => true,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    httpsAgent: sslVerification ? undefined : new (require('https').Agent)({ rejectUnauthorized: false })
  }

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

    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body,
      duration,
      size: Buffer.byteLength(body, 'utf8')
    }
  } catch (err: unknown) {
    const duration = Date.now() - start
    const message = err instanceof Error ? err.message : String(err)
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
