import type { BodyType, KeyValuePair, Request } from '@/types'

export function safeDecode(s: string): string {
  try { return decodeURIComponent(s.replace(/\+/g, ' ')) } catch { return s }
}

export const IMPLIED_CONTENT_TYPE: Partial<Record<BodyType, string>> = {
  'raw-json': 'application/json',
  'raw-xml': 'application/xml',
  'raw-html': 'text/html',
  'raw-javascript': 'application/javascript',
  'raw-text': 'text/plain',
  'x-www-form-urlencoded': 'application/x-www-form-urlencoded',
}

const SENSITIVE_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|apikey|x-auth-token|x-access-token)$|token|secret|password/i

const SENSITIVE_KEY = /token|secret|passw(or)?d|pwd|api[-_]?key|apikey|auth|signature|credential|session|private[-_]?key|^sig$/i
const PLACEHOLDER_ONLY = /^\s*\{\{[^}]+\}\}\s*$/

/** Replaces userinfo passwords and the values of credential-looking query parameters. Returns the new URL and whether anything changed. */
function redactUrl(url: string): { url: string; changed: boolean } {
  let changed = false
  let out = url.replace(/^([a-z][a-z0-9+.-]*:\/\/[^/?#@:]+):([^/?#@]+)@/i, (_m, head: string) => { changed = true; return `${head}:<password>@` })
  out = out.replace(/([?&])([^=&#]+)=([^&#]*)/g, (m, sep: string, key: string, value: string) => {
    if (!SENSITIVE_KEY.test(safeDecode(key)) || PLACEHOLDER_ONLY.test(value)) return m
    changed = true
    return `${sep}${key}=%3Credacted%3E`
  })
  return { url: out, changed }
}

function redactJsonValue(value: unknown, state: { changed: boolean }): unknown {
  if (Array.isArray(value)) return value.map((v) => redactJsonValue(v, state))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k) && (typeof v === 'string' || typeof v === 'number') && !(typeof v === 'string' && PLACEHOLDER_ONLY.test(v))) {
        out[k] = '<redacted>'
        state.changed = true
      } else out[k] = redactJsonValue(v, state)
    }
    return out
  }
  return value
}

/** Masks credential-looking fields in a raw body (JSON or key=value pairs). Other bodies are returned unchanged. */
function redactBody(body: string, bodyType: BodyType): { body: string; changed: boolean } {
  if (bodyType === 'raw-json') {
    try {
      const state = { changed: false }
      const redacted = redactJsonValue(JSON.parse(body), state)
      return state.changed ? { body: JSON.stringify(redacted, null, /\n/.test(body.trim()) ? 2 : 0), changed: true } : { body, changed: false }
    } catch { return { body, changed: false } }
  }
  if (bodyType === 'raw-text' && /^[^\s=&]+=[^&]*(&[^\s=&]+=[^&]*)*$/.test(body.trim())) {
    let changed = false
    const out = body.replace(/(^|&)([^=&]+)=([^&]*)/g, (m, sep: string, key: string, value: string) => {
      if (!SENSITIVE_KEY.test(safeDecode(key)) || PLACEHOLDER_ONLY.test(value)) return m
      changed = true
      return `${sep}${key}=<redacted>`
    })
    return { body: out, changed }
  }
  return { body, changed: false }
}

function interpolate(text: string, vars: Record<string, string> | undefined): string {
  if (!vars) return text
  return text.replace(/\{\{([^}]+)\}\}/g, (m, key: string) => vars[key.trim()] ?? m)
}

function encodeKeepingVars(s: string): string {
  return s.split(/(\{\{[^}]+\}\})/).map((part) => (/^\{\{[^}]+\}\}$/.test(part) ? part : encodeURIComponent(part))).join('')
}

export type ExportableRequest = Pick<Request, 'protocol' | 'method' | 'url' | 'params' | 'headers' | 'bodyType' | 'bodyContent' | 'authType' | 'authConfig' | 'sslVerification' | 'protocolConfig'>

export interface SnippetOptions {
  /** Values for {{VAR}} placeholders. Omit to keep the placeholders as they are. */
  variables?: Record<string, string>
  /** Include credentials (auth config, sensitive headers, URL/body fields). When false they become placeholders. */
  includeSecrets: boolean
}

export interface SnippetRow { key: string; value: string; file: boolean }

export type SnippetBody =
  | { kind: 'none' }
  | { kind: 'raw'; text: string; contentType?: string }
  | { kind: 'urlencoded'; rows: SnippetRow[] }
  | { kind: 'form'; rows: SnippetRow[] }
  | { kind: 'binary'; path: string }

/** The request after variables, auth, params and redaction are applied. Every language generator renders this. */
export interface SnippetModel {
  method: string
  url: string
  headers: { key: string; value: string }[]
  basic: { username: string; password: string } | null
  body: SnippetBody
  insecure: boolean
  notes: string[]
  redacted: boolean
}

export interface GeneratedSnippet {
  code: string
  notes: string[]
}

/** Resolves an HTTP or GraphQL request into a language-neutral model. Returns null for other protocols. */
export function buildSnippetModel(req: ExportableRequest, options: SnippetOptions): SnippetModel | null {
  if (req.protocol !== 'http' && req.protocol !== 'graphql') return null
  const notes: string[] = []
  const sub = (s: string) => interpolate(s, options.variables)

  let url = sub(req.url)
  const activeParams = req.params.filter((p) => p.enabled && p.key)
  const queryParts = activeParams.map((p) => `${encodeKeepingVars(sub(p.key))}=${encodeKeepingVars(sub(p.value))}`)
  const paramIsSecret = activeParams.map((p) => SENSITIVE_KEY.test(sub(p.key)) && !PLACEHOLDER_ONLY.test(p.value))
  if (queryParts.length > 0) {
    const safe = options.includeSecrets ? queryParts : queryParts.map((q, i) => (paramIsSecret[i] ? `${q.split('=')[0]}=%3Credacted%3E` : q))
    url += (url.includes('?') ? '&' : '?') + safe.join('&')
  }
  let redacted = false
  if (!options.includeSecrets) {
    const r = redactUrl(url)
    url = r.url
    redacted = r.changed || paramIsSecret.some(Boolean)
  }

  const method = req.protocol === 'graphql' ? 'POST' : req.method
  let bodyType: BodyType = req.bodyType
  let bodyContent = req.bodyContent

  if (req.protocol === 'graphql') {
    const gql: Record<string, unknown> = { query: req.bodyContent }
    const pc = req.protocolConfig ?? {}
    if (pc.variables) { try { gql.variables = JSON.parse(pc.variables) } catch { gql.variables = {} } }
    if (pc.operationName) gql.operationName = pc.operationName
    bodyType = 'raw-json'
    bodyContent = JSON.stringify(gql)
  }

  const head = method === 'HEAD'
  if (!options.includeSecrets && bodyContent) {
    if (bodyType === 'form-data' || bodyType === 'x-www-form-urlencoded') {
      try {
        const rows = JSON.parse(bodyContent) as KeyValuePair[]
        const masked = rows.map((r) => (r.enabled && SENSITIVE_KEY.test(sub(r.key)) && r.fieldType !== 'file' && !PLACEHOLDER_ONLY.test(r.value) ? { ...r, value: '<redacted>' } : r))
        if (masked.some((r, i) => r !== rows[i])) { bodyContent = JSON.stringify(masked); redacted = true }
      } catch { /* not row data */ }
    } else {
      const r = redactBody(bodyContent, bodyType)
      if (r.changed) { bodyContent = r.body; redacted = true }
    }
  }
  if (head && bodyType !== 'none' && bodyContent) notes.push('HEAD requests have no body; it was left out')

  const secret = (value: string, placeholder: string): string => {
    if (options.includeSecrets) return value
    redacted = true
    return placeholder
  }

  const headers: { key: string; value: string }[] = []
  const hasHeader = (name: string) => req.headers.some((h) => h.enabled && h.key.toLowerCase() === name)
  for (const h of req.headers) {
    if (!h.enabled || !h.key) continue
    const key = sub(h.key)
    let value = sub(h.value)
    // A {{VAR}} left unresolved is already a placeholder, not a secret
    if (SENSITIVE_HEADER.test(key) && !/^\s*(\w+\s+)?\{\{[^}]+\}\}\s*$/.test(value)) value = secret(value, '<redacted>')
    headers.push({ key, value })
  }

  let basic: SnippetModel['basic'] = null
  switch (req.authType) {
    case 'basic':
      if (req.authConfig.username) basic = { username: sub(req.authConfig.username), password: secret(sub(req.authConfig.password ?? ''), '<password>') }
      break
    case 'bearer': case 'oauth2': {
      const token = req.authConfig.token
      if (token) headers.push({ key: 'Authorization', value: 'Bearer ' + secret(sub(token), '<token>') })
      break
    }
    case 'jwt': {
      const token = req.authConfig.token
      if (token) headers.push({ key: 'Authorization', value: (req.authConfig.prefix?.trim() || 'Bearer') + ' ' + secret(sub(token), '<token>') })
      break
    }
    case 'ntlm':
      notes.push('NTLM authentication is not included')
      break
    case 'inherit':
      notes.push('Authentication inherited from the collection or folder is not included')
      break
  }

  const impliedType = IMPLIED_CONTENT_TYPE[bodyType]
  if (impliedType && bodyType !== 'x-www-form-urlencoded' && bodyContent && !hasHeader('content-type')) headers.push({ key: 'Content-Type', value: impliedType })

  let body: SnippetBody = { kind: 'none' }
  if (!head && bodyContent) {
    if (bodyType === 'form-data' || bodyType === 'x-www-form-urlencoded') {
      let rows: KeyValuePair[] = []
      try { rows = JSON.parse(bodyContent) as KeyValuePair[] } catch { /* empty */ }
      const mapped = rows.filter((r) => r.enabled && r.key).map((r) => ({ key: sub(r.key), value: sub(r.value), file: bodyType === 'form-data' && r.fieldType === 'file' }))
      if (mapped.length > 0) body = bodyType === 'form-data' ? { kind: 'form', rows: mapped } : { kind: 'urlencoded', rows: mapped }
    } else if (bodyType === 'binary') {
      body = { kind: 'binary', path: bodyContent }
    } else if (bodyType !== 'none') {
      const ct = headers.find((h) => h.key.toLowerCase() === 'content-type')?.value
      body = { kind: 'raw', text: sub(bodyContent), contentType: ct }
    }
  }

  return { method, url, headers, basic, body, insecure: req.sslVerification === 'disabled', notes, redacted }
}

/** Notes for a finished snippet: model notes, the redaction hint, and any {{VAR}} that is still unresolved. */
export function snippetNotes(model: SnippetModel, code: string, options: SnippetOptions): string[] {
  const notes = [...model.notes]
  if (model.redacted) notes.push('Credentials were replaced with placeholders. Enable "Include secrets" to export them.')
  if (options.variables) {
    const left = [...new Set(code.match(/\{\{[^}]+\}\}/g) ?? [])]
    if (left.length > 0) notes.push(`Unresolved variables kept as placeholders: ${left.join(', ')}`)
  }
  return notes
}
