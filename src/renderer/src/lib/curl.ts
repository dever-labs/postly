import type { AuthType, BodyType, HttpMethod, KeyValuePair, SslVerification } from '@/types'
import { IMPLIED_CONTENT_TYPE, buildSnippetModel, safeDecode, snippetNotes, type ExportableRequest, type GeneratedSnippet, type SnippetOptions } from '@/lib/snippets/model'

export interface ParsedCurl {
  name: string
  method: HttpMethod
  url: string
  headers: KeyValuePair[]
  bodyType: BodyType
  bodyContent: string
  authType: AuthType
  authConfig: Record<string, string>
  sslVerification: SslVerification
  /** Options that were ignored or only partly honoured; shown to the user instead of being dropped silently. */
  warnings: string[]
}

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']

// ─── Tokenizer ───────────────────────────────────────────────────────────────

type Dialect = 'bash' | 'cmd' | 'powershell'

function detectDialect(text: string): Dialect {
  if (/\^"/.test(text) || /\^\s*\r?\n/.test(text)) return 'cmd'
  if (/`\s*\r?\n/.test(text) || /\bcurl\.exe\b/i.test(text)) return 'powershell'
  return 'bash'
}

const ANSI_ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', '\\': '\\', "'": "'", '"': '"' }

/** Splits a command line into arguments, honouring bash, cmd.exe (^ escapes) and PowerShell (` escapes) quoting. */
export function tokenize(input: string, dialect: Dialect = detectDialect(input)): string[] {
  let text = input.replace(/\r\n/g, '\n')
  // cmd.exe: a caret escapes the next character, so removing it leaves ordinary double-quoted bash-like text
  if (dialect === 'cmd') text = text.replace(/\^\n/g, '').replace(/\^([\s\S])/g, '$1')
  const tokens: string[] = []
  let cur = ''
  let inToken = false
  let i = 0

  const push = () => { if (inToken) tokens.push(cur); cur = ''; inToken = false }

  while (i < text.length) {
    const c = text[i]

    if (dialect === 'bash' && c === '\\' && text[i + 1] === '\n') { i += 2; continue }
    if (dialect === 'bash' && c === '\\' && i + 1 < text.length) { cur += text[i + 1]; inToken = true; i += 2; continue }
    if (dialect === 'powershell' && c === '`') {
      if (text[i + 1] === '\n') { i += 2; continue }
      if (text[i + 1] !== undefined) { cur += text[i + 1]; inToken = true; i += 2; continue }
    }

    if (/\s/.test(c)) { push(); i++; continue }

    if (c === "'" && dialect !== 'cmd') {
      inToken = true; i++
      while (i < text.length) {
        if (text[i] === "'") {
          if (dialect === 'powershell' && text[i + 1] === "'") { cur += "'"; i += 2; continue }
          break
        }
        cur += text[i++]
      }
      i++
      continue
    }

    if (c === '$' && text[i + 1] === "'" && dialect === 'bash') {
      inToken = true; i += 2
      while (i < text.length && text[i] !== "'") {
        if (text[i] === '\\' && i + 1 < text.length) {
          const n = text[i + 1]
          if (n === 'x' && /^[0-9a-fA-F]{2}/.test(text.slice(i + 2, i + 4))) { cur += String.fromCharCode(parseInt(text.slice(i + 2, i + 4), 16)); i += 4; continue }
          if (n === 'u' && /^[0-9a-fA-F]{4}/.test(text.slice(i + 2, i + 6))) { cur += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16)); i += 6; continue }
          cur += ANSI_ESCAPES[n] ?? `\\${n}`; i += 2; continue
        }
        cur += text[i++]
      }
      i++
      continue
    }

    if (c === '"') {
      inToken = true; i++
      while (i < text.length) {
        const d = text[i]
        if (d === '"') {
          if (dialect === 'powershell' && text[i + 1] === '"') { cur += '"'; i += 2; continue }
          break
        }
        if (d === '\\' && i + 1 < text.length) {
          const n = text[i + 1]
          if (dialect === 'bash' && (n === '"' || n === '\\' || n === '$' || n === '`')) { cur += n; i += 2; continue }
          if (dialect === 'bash' && n === '\n') { i += 2; continue }
          if (dialect === 'cmd' && n === '"') { cur += '"'; i += 2; continue }
          if (dialect === 'cmd' && n === '\\') { cur += '\\'; i += 2; continue }
        }
        if (dialect === 'powershell' && d === '`' && i + 1 < text.length) { cur += text[i + 1]; i += 2; continue }
        cur += d; i++
      }
      i++
      continue
    }

    cur += c; inToken = true; i++
  }
  push()
  return tokens
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/** Options that consume a value but are not otherwise represented in a Postly request. */
const IGNORED_WITH_VALUE = new Set([
  'o', 'output', 'm', 'max-time', 'connect-timeout', 'retry', 'retry-delay', 'retry-max-time', 'x', 'proxy', 'U', 'proxy-user',
  'cert', 'key', 'cacert', 'capath', 'E', 'w', 'write-out', 'T', 'upload-file', 'c', 'cookie-jar', 'D', 'dump-header',
  'interface', 'resolve', 'connect-to', 'max-redirs', 'limit-rate', 'H3', 'keepalive-time', 'noproxy', 'pinnedpubkey',
  'oauth2-bearer', 'trace', 'trace-ascii', 'config', 'K', 'unix-socket', 'doh-url', 'proxy-header',
])
const IGNORED_FLAGS = new Set([
  's', 'silent', 'S', 'show-error', 'v', 'verbose', 'i', 'include', 'compressed', 'f', 'fail', 'g', 'globoff', 'N', 'no-buffer',
  'http1.0', 'http1.1', 'http2', 'http2-prior-knowledge', 'http3', 'tlsv1.2', 'tlsv1.3', 'path-as-is', 'ipv4', 'ipv6', '4', '6',
  'O', 'remote-name', 'J', 'remote-header-name', 'progress-bar', '#', 'no-keepalive', 'raw', 'tcp-nodelay', 'fail-with-body',
  'tr-encoding', 'netrc', 'n', 'anyauth', 'basic', 'digest', 'ntlm', 'negotiate',
])
const SHORT_WITH_VALUE = new Set(['X', 'H', 'd', 'F', 'u', 'A', 'e', 'b', 'o', 'm', 'x', 'U', 'E', 'w', 'T', 'c', 'D', 'K'])
const BODY_FLAGS = new Set(['d', 'data', 'data-raw', 'data-binary', 'data-ascii', 'data-urlencode', 'json'])

function newPair(key: string, value: string, extra: Partial<KeyValuePair> = {}): KeyValuePair {
  return { id: crypto.randomUUID(), key, value, enabled: true, ...extra }
}

function parseUrlEncodedPairs(body: string): KeyValuePair[] {
  return body.split('&').filter(Boolean).map((part) => {
    const eq = part.indexOf('=')
    return eq === -1 ? newPair(safeDecode(part), '') : newPair(safeDecode(part.slice(0, eq)), safeDecode(part.slice(eq + 1)))
  })
}

export function looksLikeCurl(text: string): boolean {
  return /^\s*(?:[$>]\s*)?curl(?:\.exe)?\s/i.test(text)
}

function nameFromUrl(method: string, url: string): string {
  const bare = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[?#].*$/, '')
  const slash = bare.indexOf('/')
  const path = slash === -1 ? '/' : bare.slice(slash)
  return `${method} ${path.length > 40 ? `${path.slice(0, 40)}…` : path}`
}

function inferBodyType(contentType: string | undefined, data: string): BodyType {
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('json')) return 'raw-json'
  if (ct.includes('x-www-form-urlencoded')) return 'x-www-form-urlencoded'
  if (ct.includes('xml')) return 'raw-xml'
  if (ct.includes('html')) return 'raw-html'
  if (ct.includes('javascript')) return 'raw-javascript'
  if (ct.startsWith('text/')) return 'raw-text'
  if (!ct) return 'x-www-form-urlencoded'
  // Unknown type: a JSON-looking payload is still most useful as JSON, otherwise keep it verbatim
  return /^\s*[[{]/.test(data) ? 'raw-json' : 'raw-text'
}

/** Parses a cURL command (bash, cmd.exe or PowerShell quoting). Returns null when the text is not a cURL command. */
export function parseCurl(input: string): ParsedCurl | null {
  if (!looksLikeCurl(input)) return null
  const tokens = tokenize(input.replace(/^\s*[$>]\s*/, ''))
  if (tokens.length === 0 || !/^curl(\.exe)?$/i.test(tokens[0])) return null

  const warnings: string[] = []
  const headers: KeyValuePair[] = []
  const dataParts: { kind: 'data' | 'raw' | 'urlencode' | 'binary'; value: string }[] = []
  const formParts: KeyValuePair[] = []
  const urls: string[] = []
  let explicitMethod: string | null = null
  let head = false
  let getMode = false
  let insecure = false
  const creds: { basic: { username: string; password: string } | null } = { basic: null }
  let jsonFlag = false

  const addHeader = (raw: string) => {
    const idx = raw.indexOf(':')
    if (idx === -1) {
      if (raw.endsWith(';')) headers.push(newPair(raw.slice(0, -1).trim(), ''))
      else warnings.push(`Ignored malformed header "${raw}"`)
      return
    }
    const key = raw.slice(0, idx).trim()
    const value = raw.slice(idx + 1).trim()
    if (key) headers.push(newPair(key, value))
  }

  const handle = (name: string, value: string | undefined): void => {
    switch (name) {
      case 'X': case 'request': explicitMethod = (value ?? '').toUpperCase(); break
      case 'H': case 'header': if (value) addHeader(value); break
      case 'd': case 'data': case 'data-ascii': dataParts.push({ kind: 'data', value: value ?? '' }); break
      case 'data-raw': dataParts.push({ kind: 'raw', value: value ?? '' }); break
      case 'data-binary': dataParts.push({ kind: 'binary', value: value ?? '' }); break
      case 'data-urlencode': dataParts.push({ kind: 'urlencode', value: value ?? '' }); break
      case 'json': jsonFlag = true; dataParts.push({ kind: 'raw', value: value ?? '' }); break
      case 'F': case 'form': case 'form-string': {
        const v = value ?? ''
        const eq = v.indexOf('=')
        if (eq === -1) { warnings.push(`Ignored malformed form field "${v}"`); break }
        const key = v.slice(0, eq)
        let val = v.slice(eq + 1).replace(/;type=[^;]*$/i, '')
        if (name !== 'form-string' && val.startsWith('@')) formParts.push(newPair(key, val.slice(1).replace(/^"(.*)"$/, '$1'), { fieldType: 'file' }))
        else {
          if (name !== 'form-string' && val.startsWith('<')) { warnings.push(`Field "${key}" reads its value from a file (<); the file name was kept as text`); val = val.slice(1) }
          formParts.push(newPair(key, val))
        }
        break
      }
      case 'u': case 'user': {
        const v = value ?? ''
        const idx = v.indexOf(':')
        creds.basic = idx === -1 ? { username: v, password: '' } : { username: v.slice(0, idx), password: v.slice(idx + 1) }
        break
      }
      case 'k': case 'insecure': insecure = true; break
      case 'L': case 'location': case 'location-trusted':
        warnings.push('-L noted: Postly follows redirects according to the global setting, not per request')
        break
      case 'I': case 'head': head = true; break
      case 'G': case 'get': getMode = true; break
      case 'A': case 'user-agent': if (value) headers.push(newPair('User-Agent', value)); break
      case 'e': case 'referer': if (value) headers.push(newPair('Referer', value)); break
      case 'b': case 'cookie':
        if (value && value.includes('=')) headers.push(newPair('Cookie', value))
        else warnings.push('Ignored -b cookie file; Postly does not read cookie files')
        break
      case 'url': if (value) urls.push(value); break
      default:
        if (IGNORED_FLAGS.has(name)) break
        warnings.push(`Ignored unsupported option ${name.length === 1 ? `-${name}` : `--${name}`}${value !== undefined ? ` ${value}` : ''}`)
    }
  }

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.startsWith('--') && t.length > 2) {
      const eq = t.indexOf('=')
      const name = eq === -1 ? t.slice(2) : t.slice(2, eq)
      const takesValue = BODY_FLAGS.has(name) || ['request', 'header', 'form', 'form-string', 'user', 'user-agent', 'referer', 'cookie', 'url'].includes(name) || IGNORED_WITH_VALUE.has(name)
      if (!takesValue) { handle(name, undefined); continue }
      const value = eq !== -1 ? t.slice(eq + 1) : tokens[++i]
      if (IGNORED_WITH_VALUE.has(name) && !BODY_FLAGS.has(name)) { warnings.push(`Ignored unsupported option --${name} ${value ?? ''}`.trim()); continue }
      handle(name, value)
    } else if (t.startsWith('-') && t.length > 1) {
      for (let j = 1; j < t.length; j++) {
        const flag = t[j]
        if (SHORT_WITH_VALUE.has(flag)) {
          const rest = t.slice(j + 1)
          const value = rest !== '' ? rest : tokens[++i]
          if (IGNORED_WITH_VALUE.has(flag) && !['X', 'H', 'd', 'F', 'u', 'A', 'e', 'b'].includes(flag)) warnings.push(`Ignored unsupported option -${flag} ${value ?? ''}`.trim())
          else handle(flag, value)
          break
        }
        handle(flag, undefined)
      }
    } else {
      urls.push(t)
    }
  }

  if (urls.length === 0) return null
  if (urls.length > 1) warnings.push(`Only the first URL was imported (${urls.length - 1} more ignored)`)
  let url = urls[0]

  // Authorization header → structured auth
  let authType: AuthType = 'none'
  let authConfig: Record<string, string> = {}
  if (creds.basic) {
    authType = 'basic'
    authConfig = { username: creds.basic.username, password: creds.basic.password }
  } else {
    const idx = headers.findIndex((h) => h.key.toLowerCase() === 'authorization')
    if (idx !== -1) {
      const value = headers[idx].value
      const bearer = /^bearer\s+(.+)$/i.exec(value)
      const basicHeader = /^basic\s+(.+)$/i.exec(value)
      if (bearer) {
        authType = 'bearer'; authConfig = { token: bearer[1] }; headers.splice(idx, 1)
      } else if (basicHeader && !basicHeader[1].includes('{{')) {
        try {
          const decoded = atob(basicHeader[1])
          const c = decoded.indexOf(':')
          if (c !== -1) { authType = 'basic'; authConfig = { username: decoded.slice(0, c), password: decoded.slice(c + 1) }; headers.splice(idx, 1) }
        } catch { /* keep as a plain header */ }
      }
    }
  }

  if (jsonFlag) {
    if (!headers.some((h) => h.key.toLowerCase() === 'content-type')) headers.push(newPair('Content-Type', 'application/json'))
    if (!headers.some((h) => h.key.toLowerCase() === 'accept')) headers.push(newPair('Accept', 'application/json'))
  }

  const contentTypeIdx = headers.findIndex((h) => h.key.toLowerCase() === 'content-type')
  const contentType = contentTypeIdx === -1 ? undefined : headers[contentTypeIdx].value

  let bodyType: BodyType = 'none'
  let bodyContent = ''
  const hasData = dataParts.length > 0

  if (formParts.length > 0) {
    bodyType = 'form-data'
    bodyContent = JSON.stringify(formParts)
    if (hasData) warnings.push('Both -F and -d were given; only the form fields were imported')
    // The multipart boundary is generated at send time
    if (contentTypeIdx !== -1 && /multipart\/form-data/i.test(contentType ?? '')) headers.splice(contentTypeIdx, 1)
  } else if (hasData && getMode) {
    const query = dataParts.map((p) => (p.kind === 'urlencode' ? encodeDataUrlencode(p.value) : p.value)).join('&')
    url += (url.includes('?') ? '&' : '?') + query
  } else if (hasData) {
    const fileBody = dataParts.find((p) => p.kind === 'binary' && p.value.startsWith('@')) ?? dataParts.find((p) => p.kind === 'data' && p.value.startsWith('@'))
    if (fileBody) {
      bodyType = 'binary'
      bodyContent = fileBody.value.slice(1)
      if (dataParts.length > 1) warnings.push('Only the file body was imported')
    } else if (dataParts.every((p) => p.kind === 'urlencode')) {
      bodyType = 'x-www-form-urlencoded'
      bodyContent = JSON.stringify(dataParts.map((p) => {
        const eq = p.value.indexOf('=')
        return eq === -1 ? newPair('', p.value) : newPair(p.value.slice(0, eq), p.value.slice(eq + 1))
      }))
    } else {
      // curl joins multiple -d values with "&"
      const joined = dataParts.map((p) => (p.kind === 'urlencode' ? encodeDataUrlencode(p.value) : p.value)).join('&')
      bodyType = inferBodyType(contentType, joined)
      bodyContent = bodyType === 'x-www-form-urlencoded' ? JSON.stringify(parseUrlEncodedPairs(joined)) : joined
      // Postly adds the implied Content-Type itself; drop an identical one so it is not shown twice
      const implied = IMPLIED_CONTENT_TYPE[bodyType]
      if (contentTypeIdx !== -1 && implied && (contentType ?? '').split(';')[0].trim().toLowerCase() === implied) headers.splice(contentTypeIdx, 1)
    }
  }

  let method: string = explicitMethod ?? (head ? 'HEAD' : (hasData && !getMode) || formParts.length > 0 ? 'POST' : 'GET')
  if (!METHODS.includes(method as HttpMethod)) {
    warnings.push(`Method ${method} is not supported; imported as GET`)
    method = 'GET'
  }

  return {
    name: nameFromUrl(method, url),
    method: method as HttpMethod,
    url,
    headers,
    bodyType,
    bodyContent,
    authType,
    authConfig,
    sslVerification: insecure ? 'disabled' : 'inherit',
    warnings,
  }
}

function encodeDataUrlencode(value: string): string {
  const eq = value.indexOf('=')
  if (eq === -1) return encodeURIComponent(value)
  const name = value.slice(0, eq)
  return `${name}=${encodeURIComponent(value.slice(eq + 1))}`
}

// ─── Export ──────────────────────────────────────────────────────────────────

export type CurlExportOptions = SnippetOptions

export interface CurlExport {
  command: string
  notes: string[]
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

/** Builds a bash cURL command for an HTTP or GraphQL request. Returns null for other protocols. */
export function buildCurl(req: ExportableRequest, options: CurlExportOptions): CurlExport | null {
  const snippet = generateCurl(req, options)
  return snippet ? { command: snippet.code, notes: snippet.notes } : null
}

export function generateCurl(req: ExportableRequest, options: SnippetOptions): GeneratedSnippet | null {
  const model = buildSnippetModel(req, options)
  if (!model) return null
  const { method, body } = model
  const head = method === 'HEAD'
  const args = head ? '-I' : method !== 'GET' || body.kind !== 'none' ? `-X ${method}` : ''
  const lines: string[] = [`curl ${args}`.trimEnd() + ` ${shellQuote(model.url)}`]
  if (model.basic) lines.push(`-u ${shellQuote(`${model.basic.username}:${model.basic.password}`)}`)
  for (const h of model.headers) lines.push(`-H ${shellQuote(`${h.key}: ${h.value}`)}`)
  if (model.insecure) lines.push('-k')
  switch (body.kind) {
    case 'form': for (const r of body.rows) lines.push(`-F ${shellQuote(`${r.key}=${r.file ? '@' : ''}${r.value}`)}`); break
    case 'urlencoded': for (const r of body.rows) lines.push(`--data-urlencode ${shellQuote(`${r.key}=${r.value}`)}`); break
    case 'binary': lines.push(`--data-binary ${shellQuote(`@${body.path}`)}`); break
    case 'raw': lines.push(`--data-raw ${shellQuote(body.text)}`); break
  }
  const code = lines.join(' \\\n  ')
  return { code, notes: snippetNotes(model, code, options) }
}
