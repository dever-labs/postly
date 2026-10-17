import crypto from 'crypto'
import { EXTRACT_RULES_KEY, serializeRules, type ExtractRule } from '../../shared/extract'
import { DYNAMIC_VARIABLES } from '../../shared/variables'
import type { ExportCollection, ExportFolder, ExportRequest } from '../ipc/export-import'
import type { ImportResult } from './import-openapi'
import { isObj, kv, list, parseQuery, splitUrl, str, type Auth, type Obj } from './import-util'

// Postman Collection Format v2.0 and v2.1

const text = (v: unknown): string => (typeof v === 'string' ? v : isObj(v) ? str(v.content) : '')

const NO_AUTH: Auth = { type: 'none', config: {} }
const INHERIT: Auth = { type: 'inherit', config: {} }
const SUPPORTED_DYNAMIC = new Set(DYNAMIC_VARIABLES.map((v) => v.name))

export function isPostmanCollection(doc: unknown): boolean {
  if (!isObj(doc) || !isObj(doc.info) || typeof doc.info.schema !== 'string') return false
  try {
    const { hostname } = new URL(doc.info.schema)
    return hostname === 'getpostman.com' || hostname.endsWith('.getpostman.com') || hostname === 'postman.com' || hostname.endsWith('.postman.com')
  } catch {
    return false
  }
}

/** Postman environment exports are not collections; callers use this to give a specific message. */
export function isPostmanEnvironment(doc: unknown): boolean {
  return isObj(doc) && doc._postman_variable_scope === 'environment'
}

/** The pre-v2 format (a flat `requests` array with ids) was dropped by Postman years ago. */
export function isPostmanV1Collection(doc: unknown): boolean {
  return isObj(doc) && !isObj(doc.info) && Array.isArray(doc.requests) && typeof doc.name === 'string'
}

// ─── Scripts ─────────────────────────────────────────────────────────────────

// Longer lines are minified or hostile; they are reported rather than matched
const MAX_SCRIPT_LINE = 2000
const SET_CALL = /^pm\.(environment|collectionVariables|globals|variables)\.set\(\s*(['"])([^'"]+)\2\s*,(.+)\)\s*;?$/
const JSON_ALIAS = /^(?:const|let|var)\s+(\w+)\s*=\s*(?:pm\.response\.json\(\)|JSON\.parse\(\s*responseBody\s*\))\s*;?$/

function valueToRule(expr: string, aliases: Set<string>): Pick<ExtractRule, 'source' | 'expression'> | null {
  const header = /^pm\.response\.headers\.get\(\s*(['"])([^'"]+)\1\s*\)$/.exec(expr)
  if (header) return { source: 'header', expression: header[2] }
  const cookie = /^pm\.cookies\.get\(\s*(['"])([^'"]+)\1\s*\)$/.exec(expr)
  if (cookie) return { source: 'cookie', expression: cookie[2] }
  if (/^pm\.response\.code$/.test(expr)) return { source: 'status', expression: '' }
  const json = /^(pm\.response\.json\(\)|\w+)((?:\.\w+|\[\d+\]|\[(?:'[^']*'|"[^"]*")\])*)$/.exec(expr)
  if (json && (json[1] === 'pm.response.json()' || aliases.has(json[1]))) return { source: 'json', expression: `$${json[2]}` }
  return null
}

function scriptLines(event: Obj): string[] {
  const exec = isObj(event.script) ? event.script.exec : undefined
  const lines = Array.isArray(exec) ? exec.map(String) : typeof exec === 'string' ? exec.split('\n') : []
  return lines.map((l) => l.replace(/\/\/.*$/, '').trim()).filter(Boolean)
}

/**
 * Converts the simple "save a response value" test scripts into Extract rules. Anything else is
 * reported as a warning rather than guessed at, because Postman scripts are arbitrary JavaScript.
 */
export function convertPostmanScripts(requestName: string, events: unknown): { rules: ExtractRule[]; warnings: string[] } {
  const rules: ExtractRule[] = []
  const warnings: string[] = []
  for (const event of list(events)) {
    if (event.listen !== 'test') {
      if (event.listen === 'prerequest' && scriptLines(event).length > 0) warnings.push(`"${requestName}": pre-request script was not imported`)
      continue
    }
    const aliases = new Set<string>()
    const skipped: string[] = []
    for (const line of scriptLines(event)) {
      if (line.length > MAX_SCRIPT_LINE) { skipped.push(line); continue }
      const alias = JSON_ALIAS.exec(line)
      if (alias) { aliases.add(alias[1]); continue }
      const set = SET_CALL.exec(line)
      const rule = set && (set[1] === 'environment' || set[1] === 'collectionVariables') ? valueToRule(set[4].trim(), aliases) : null
      if (set && rule) {
        rules.push({ id: crypto.randomUUID(), ...rule, variable: set[3], scope: set[1] === 'environment' ? 'environment' : 'collection', enabled: true })
      } else skipped.push(line)
    }
    if (skipped.length > 0) {
      warnings.push(`"${requestName}": ${skipped.length} script line${skipped.length !== 1 ? 's' : ''} could not be converted (first: ${skipped[0].slice(0, 70)})`)
    }
  }
  return { rules, warnings }
}

// ─── Auth ────────────────────────────────────────────────────────────────────

/** Auth parameters are a list of {key,value} in v2.1 and sometimes a plain object in v2.0. */
function authValue(auth: Obj, key: string): string {
  const params = auth[str(auth.type)]
  if (Array.isArray(params)) return str(params.find((p) => isObj(p) && p.key === key && !isObj(p.value))?.value)
  return isObj(params) ? str(params[key]) : ''
}

const GRANTS: Record<string, string> = {
  authorization_code: 'authorization_code',
  authorization_code_with_pkce: 'authorization_code',
  client_credentials: 'client_credentials',
  password_credentials: 'password',
  password: 'password',
  implicit: 'implicit',
}

function convertAuth(auth: unknown, label: string, warnings: string[]): Auth {
  if (!isObj(auth) || !auth.type) return { ...INHERIT }
  const get = (key: string) => authValue(auth, key)
  switch (auth.type) {
    case 'noauth':
      return { ...NO_AUTH }
    case 'bearer':
      return { type: 'bearer', config: { token: get('token') } }
    case 'basic':
      return { type: 'basic', config: { username: get('username'), password: get('password') } }
    case 'digest':
      return { type: 'digest', config: { username: get('username'), password: get('password') } }
    case 'ntlm':
      return { type: 'ntlm', config: { username: get('username'), password: get('password'), domain: get('domain'), workstation: get('workstation') } }
    case 'apikey':
      return { type: 'apikey', config: { key: get('key'), value: get('value'), in: get('in') === 'query' ? 'query' : 'header' } }
    case 'awsv4':
      return {
        type: 'awsv4',
        config: { accessKey: get('accessKey'), secretKey: get('secretKey'), sessionToken: get('sessionToken'), region: get('region'), service: get('service') },
      }
    case 'oauth2': {
      const grant = GRANTS[get('grant_type')] ?? 'authorization_code'
      if (grant === 'password') warnings.push(`${label}: the username and password of the OAuth 2.0 password grant were not mapped.`)
      return {
        type: 'oauth2',
        config: {
          grantType: grant,
          clientId: get('clientId'),
          clientSecret: get('clientSecret'),
          authUrl: get('authUrl'),
          tokenUrl: get('accessTokenUrl'),
          scopes: get('scope'),
          redirectUri: get('redirect_uri'),
        },
      }
    }
    default:
      warnings.push(`${label}: "${str(auth.type)}" authentication is not supported; configure it manually.`)
      return { ...NO_AUTH }
  }
}

// ─── Requests ────────────────────────────────────────────────────────────────

function resolveUrl(url: unknown, pathVariables: Map<string, string>): { url: string; params: ReturnType<typeof kv>[] } {
  let raw = ''
  let query: Obj[] | undefined
  let declared: Obj[] = []
  if (typeof url === 'string') raw = url
  else if (isObj(url)) {
    raw = str(url.raw)
    if (!raw) {
      const host = Array.isArray(url.host) ? url.host.map(str).join('.') : str(url.host)
      const path = (Array.isArray(url.path) ? url.path : [url.path]).filter((p) => p !== undefined).map((p) => (isObj(p) ? str(p.value) : str(p))).join('/')
      const port = url.port ? `:${str(url.port)}` : ''
      raw = `${url.protocol ? `${str(url.protocol)}://` : ''}${host}${port}${path ? `/${path}` : ''}`
    }
    if (Array.isArray(url.query)) query = list(url.query)
    declared = list(url.variable)
  }

  const split = splitUrl(raw, pathVariables, declared)
  const params = query
    ? query.filter((p) => str(p.key)).map((p) => kv(str(p.key), p.value, p.disabled !== true))
    : split.query !== null ? parseQuery(split.query) : []
  return { url: split.url, params }
}

function convertBody(body: unknown, headers: Obj[], label: string, warnings: string[]): { bodyType: string; bodyContent: string } {
  if (!isObj(body) || !body.mode || body.mode === 'none') return { bodyType: 'none', bodyContent: '' }
  switch (body.mode) {
    case 'raw': {
      const options = isObj(body.options) && isObj(body.options.raw) ? body.options.raw : {}
      let lang = str(options.language).toLowerCase()
      if (!lang) {
        const contentType = str(headers.find((h) => str(h.key).toLowerCase() === 'content-type' && h.disabled !== true)?.value).toLowerCase()
        lang = contentType.includes('json') ? 'json' : contentType.includes('xml') ? 'xml' : contentType.includes('html') ? 'html' : 'text'
      }
      const types: Record<string, string> = { json: 'raw-json', javascript: 'raw-javascript', html: 'raw-html', xml: 'raw-xml', text: 'raw-text' }
      return { bodyType: types[lang] ?? 'raw-text', bodyContent: str(body.raw) }
    }
    case 'graphql': {
      const gql = isObj(body.graphql) ? body.graphql : {}
      return { bodyType: 'graphql', bodyContent: JSON.stringify({ query: str(gql.query), variables: str(gql.variables) }) }
    }
    case 'formdata':
      return {
        bodyType: 'form-data',
        bodyContent: JSON.stringify(list(body.formdata).map((f) => {
          const file = f.type === 'file'
          const value = file ? (Array.isArray(f.src) ? str(f.src[0]) : str(f.src)) : str(f.value)
          return { ...kv(str(f.key), value, f.disabled !== true), ...(file ? { fieldType: 'file' } : {}) }
        })),
      }
    case 'urlencoded':
      return { bodyType: 'x-www-form-urlencoded', bodyContent: JSON.stringify(list(body.urlencoded).map((f) => kv(str(f.key), f.value, f.disabled !== true))) }
    case 'file':
    case 'binary':
      warnings.push(`${label}: the file for the binary body was not imported; pick it again in the Body tab.`)
      return { bodyType: 'binary', bodyContent: '' }
    default:
      warnings.push(`${label}: body type "${str(body.mode)}" is not supported.`)
      return { bodyType: 'none', bodyContent: '' }
  }
}

function hasScript(events: unknown): boolean {
  return list(events).some((e) => scriptLines(e).length > 0)
}

export function convertPostman(doc: Obj): ImportResult {
  const warnings: string[] = []
  const variables = new Map<string, { value: string; isSecret: boolean }>()
  const pathVariables = new Map<string, string>()
  const dynamic = new Set<string>()
  const info = isObj(doc.info) ? doc.info : {}

  const noteDynamic = (value: string) => {
    for (const m of value.matchAll(/\{\{\s*(\$[A-Za-z]+)\s*\}\}/g)) if (!SUPPORTED_DYNAMIC.has(m[1])) dynamic.add(m[1])
  }

  for (const v of list(doc.variable)) {
    const key = str(v.key)
    if (key && !variables.has(key)) variables.set(key, { value: str(v.value), isSecret: v.type === 'secret' })
  }

  function convertRequest(item: Obj): ExportRequest {
    const name = str(item.name) || 'Request'
    const label = `"${name}"`
    const req = isObj(item.request) ? item.request : typeof item.request === 'string' ? { url: item.request } : {}
    const headerList = list(req.header)
    const { url, params } = resolveUrl(req.url, pathVariables)
    const { bodyType, bodyContent } = convertBody(req.body, headerList, label, warnings)
    const headers = headerList.filter((h) => str(h.key)).map((h) => kv(str(h.key), h.value, h.disabled !== true))

    const scripts = convertPostmanScripts(name, item.event)
    warnings.push(...scripts.warnings)

    for (const value of [url, ...params.map((p) => p.key + p.value), ...headers.map((h) => h.key + h.value), bodyContent]) noteDynamic(value)

    return {
      name,
      method: (str(req.method) || 'GET').toUpperCase(),
      url,
      protocol: 'http',
      params,
      headers,
      bodyType,
      bodyContent,
      auth: convertAuth(req.auth, label, warnings),
      ssl: 'inherit',
      description: text(req.description) || text(item.description),
      protocolConfig: scripts.rules.length > 0 ? { [EXTRACT_RULES_KEY]: serializeRules(scripts.rules) } : {},
    }
  }

  function convertItems(items: Obj[]): { requests: ExportRequest[]; folders: ExportFolder[] } {
    const requests: ExportRequest[] = []
    const folders: ExportFolder[] = []
    for (const item of items) {
      if (Array.isArray(item.item)) {
        const name = str(item.name) || 'Folder'
        if (hasScript(item.event)) warnings.push(`Folder "${name}": its scripts were not imported.`)
        folders.push({
          name,
          description: text(item.description),
          auth: convertAuth(item.auth, `Folder "${name}"`, warnings),
          ssl: 'inherit',
          ...convertItems(list(item.item)),
        })
      } else if (item.request !== undefined) {
        requests.push(convertRequest(item))
      }
    }
    return { requests, folders }
  }

  if (hasScript(doc.event)) warnings.push('Collection-level scripts were not imported.')
  const { requests, folders } = convertItems(list(doc.item))
  if (requests.length === 0 && folders.length === 0) warnings.push('The collection has no requests.')
  if (dynamic.size > 0) {
    warnings.push(`Postman dynamic variables Postly does not provide are used and will stay unresolved: ${[...dynamic].map((d) => `{{${d}}}`).join(', ')}.`)
  }
  for (const [name, value] of pathVariables) if (!variables.has(name)) variables.set(name, { value, isSecret: false })

  const rootAuth = convertAuth(doc.auth, 'Collection', warnings)
  const collection: ExportCollection = {
    name: str(info.name) || 'Imported Postman collection',
    description: text(info.description),
    source: 'local',
    auth: rootAuth.type === 'inherit' ? { ...NO_AUTH } : rootAuth,
    ssl: 'inherit',
    variables: [...variables].map(([key, v]) => ({ key, value: v.isSecret ? '' : v.value, isSecret: v.isSecret })),
    requests,
    folders,
  }
  return { collection, warnings }
}
