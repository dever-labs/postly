import crypto from 'crypto'
import { queryAll, queryOne, runDraft } from '../database'
import type { HttpRequest, HttpResponse } from './http-executor'

/** Stored response bodies are capped: history lives in the same sql.js file that is rewritten on persist. */
export const MAX_STORED_BODY_BYTES = 32 * 1024
const MASK = '••••••••'

const SECRET_NAME = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|apikey|x-auth-token)$|token|secret|password|passwd|api[-_]?key/i
const SECRET_CONFIG_KEYS = new Set(['token', 'password', 'clientSecret', 'accessToken', 'refreshToken', 'apiKey', 'value'])
const AUTH_SCHEMES = /^(bearer|basic|digest|jwt|token|ntlm)$/i

/** A value is safe to keep when it only consists of {{VARIABLE}} references (and an auth scheme word). */
function isOnlyVariableRefs(value: string): boolean {
  const rest = value.replace(/\{\{[^}]*\}\}/g, '').trim()
  return rest === '' || AUTH_SCHEMES.test(rest)
}

function maskValue(value: string): string {
  return value === '' || isOnlyVariableRefs(value) ? value : MASK
}

export function maskHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, SECRET_NAME.test(k) ? maskValue(String(v)) : v]))
}

export function maskAuthConfig(config: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(config ?? {}).map(([k, v]) => [k, SECRET_CONFIG_KEYS.has(k) ? maskValue(String(v ?? '')) : v]))
}

function maskJsonValue(node: unknown): { value: unknown; changed: boolean } {
  if (Array.isArray(node)) {
    let changed = false
    const out = node.map((n) => { const r = maskJsonValue(n); changed ||= r.changed; return r.value })
    return { value: out, changed }
  }
  if (node && typeof node === 'object') {
    let changed = false
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(node)) {
      if (SECRET_NAME.test(k) && typeof v === 'string') {
        const masked = maskValue(v)
        changed ||= masked !== v
        out[k] = masked
      } else {
        const r = maskJsonValue(v)
        changed ||= r.changed
        out[k] = r.value
      }
    }
    return { value: out, changed }
  }
  return { value: node, changed: false }
}

/** Masks secret-named fields in JSON and urlencoded text; other content is returned untouched. */
export function maskBodyText(text: string | undefined): string | undefined {
  if (!text) return text
  const trimmed = text.trimStart()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const r = maskJsonValue(JSON.parse(text))
      return r.changed ? JSON.stringify(r.value, null, 2) : text
    } catch { return text }
  }
  if (/^[^\s=&]+=[^\s]*$/.test(text) && !text.includes('\n')) {
    return text.split('&').map((pair) => {
      const i = pair.indexOf('=')
      if (i < 0) return pair
      const key = pair.slice(0, i)
      let name = key
      try { name = decodeURIComponent(key) } catch { /* keep raw */ }
      return SECRET_NAME.test(name) ? `${key}=${maskValue(pair.slice(i + 1))}` : pair
    }).join('&')
  }
  return text
}

/** Query-string secrets (?api_key=…, ?access_token=…) are masked in stored URLs. */
export function maskUrl(url: string): string {
  return url.replace(/([?&][^=&#]*(?:token|secret|password|key|sig)[^=&#]*=)([^&#]*)/gi, (_, prefix: string, value: string) =>
    `${prefix}${maskValue(decodeURIComponent(value.replace(/%7B%7B/gi, '{{').replace(/%7D%7D/gi, '}}')))}`)
}

export interface HistorySettings { enabled: boolean; limit: number }

export interface HistoryEntrySummary {
  id: string
  createdAt: number
  protocol: string
  method: string
  url: string
  status: number
  statusText: string
  duration: number
  size: number
}

export interface HistoryEntryDetail extends HistoryEntrySummary {
  request: Record<string, unknown>
  responseHeaders: Record<string, string>
  responseBody: string
  bodyTruncated: boolean
}

type Row = {
  id: string; created_at: number; protocol: string; method: string; url: string; status: number
  status_text: string; duration: number; size: number
  request_json?: string; response_headers?: string; response_body?: string; body_truncated?: number
}

const toSummary = (r: Row): HistoryEntrySummary => ({
  id: r.id, createdAt: r.created_at, protocol: r.protocol, method: r.method, url: r.url,
  status: r.status, statusText: r.status_text, duration: r.duration, size: r.size,
})

function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return { text, truncated: false }
  return { text: Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8').replace(/\uFFFD+$/, ''), truncated: true }
}

export function recordHistory(
  req: HttpRequest & { params?: Record<string, string>; protocol?: string },
  response: Pick<HttpResponse, 'status' | 'statusText' | 'headers' | 'body' | 'duration' | 'size'>,
  settings: HistorySettings
): string | null {
  if (!settings.enabled || settings.limit <= 0) return null
  const id = crypto.randomUUID()
  const body = truncateUtf8(maskBodyText(response.body) ?? '', MAX_STORED_BODY_BYTES)
  const stored = {
    method: req.method,
    url: maskUrl(req.url),
    headers: maskHeaders(req.headers ?? {}),
    params: maskHeaders(req.params ?? {}),
    body: maskBodyText(req.body),
    bodyType: req.bodyType,
    authType: req.authType,
    authConfig: maskAuthConfig(req.authConfig),
    sslVerification: req.sslVerification,
    protocol: req.protocol ?? 'http',
  }
  runDraft(
    `INSERT INTO request_history
       (id, created_at, protocol, method, url, status, status_text, duration, size, request_json, response_headers, response_body, body_truncated)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, Date.now(), stored.protocol, req.method, stored.url, response.status, response.statusText ?? '',
      response.duration ?? 0, response.size ?? 0, JSON.stringify(stored),
      JSON.stringify(maskHeaders(response.headers ?? {})), body.text, body.truncated ? 1 : 0]
  )
  pruneHistory(settings.limit)
  return id
}

export function pruneHistory(limit: number): void {
  const count = Number(queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM request_history')?.n ?? 0)
  if (count <= limit) return
  runDraft(
    `DELETE FROM request_history WHERE id IN (
       SELECT id FROM request_history ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?
     )`,
    [limit]
  )
}

export function listHistory(opts: { search?: string; limit?: number; offset?: number } = {}): HistoryEntrySummary[] {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000)
  const where: string[] = []
  const params: unknown[] = []
  const term = opts.search?.trim()
  if (term) {
    where.push(`(url LIKE ? ESCAPE '\\' OR method LIKE ? ESCAPE '\\' OR CAST(status AS TEXT) LIKE ? ESCAPE '\\')`)
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    params.push(like, like, like)
  }
  params.push(limit, Math.max(opts.offset ?? 0, 0))
  return queryAll<Row>(
    `SELECT id, created_at, protocol, method, url, status, status_text, duration, size
     FROM request_history ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY created_at DESC, rowid DESC LIMIT ? OFFSET ?`,
    params
  ).map(toSummary)
}

export function getHistoryEntry(id: string): HistoryEntryDetail | null {
  const r = queryOne<Row>('SELECT * FROM request_history WHERE id = ?', [id])
  if (!r) return null
  const parse = <T,>(v: string | undefined, fallback: T): T => { try { return v ? JSON.parse(v) as T : fallback } catch { return fallback } }
  return {
    ...toSummary(r),
    request: parse(r.request_json, {}),
    responseHeaders: parse(r.response_headers, {}),
    responseBody: r.response_body ?? '',
    bodyTruncated: r.body_truncated === 1,
  }
}

export function deleteHistoryEntry(id: string): void {
  runDraft('DELETE FROM request_history WHERE id = ?', [id])
}

export function clearHistory(): void {
  runDraft('DELETE FROM request_history')
}
