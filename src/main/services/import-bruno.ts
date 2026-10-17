import crypto from 'crypto'
import { EXTRACT_RULES_KEY, serializeRules, type ExtractRule } from '../../shared/extract'
import { DYNAMIC_VARIABLES } from '../../shared/variables'
import type { ExportCollection, ExportEnvironment, ExportFolder, ExportRequest } from '../ipc/export-import'
import { parseBru, parseBruEnvironment, type BruBlocks, type BruRow } from './bru-lang'
import { ImportBudget, isObj, kv, list, parseQuery, splitUrl, str, type Auth, type Obj } from './import-util'
import { MAX_REDIRECT_LIMIT, MAX_TIMEOUT_MS, type NetworkSettings } from './network-settings'

// Bruno collections: a directory of .bru files (bruno.json, collection.bru, folder.bru, requests,
// environments/*.bru), or the JSON file produced by Bruno's "Export collection".

export interface BrunoFile {
  path: string
  text: string
}

export interface BrunoEntry {
  collection: ExportCollection
  warnings: string[]
}

const NO_AUTH: Auth = { type: 'none', config: {} }
const INHERIT: Auth = { type: 'inherit', config: {} }
const SUPPORTED_DYNAMIC = new Set(DYNAMIC_VARIABLES.map((v) => v.name))

interface MultipartRow extends BruRow {
  fileType?: boolean
  contentType?: string
  values?: string[]
}

/** One request, whichever way it was stored. */
interface BruRequest {
  name: string
  type: string
  seq: number
  method: string
  url: string
  params: Array<BruRow & { type?: string }>
  headers: BruRow[]
  bodyMode: string
  body: Obj
  authMode: string
  auth: Obj
  settings: Obj
  varsPre: BruRow[]
  varsPost: BruRow[]
  hasScripts: boolean
  hasTests: boolean
  assertions: number
  docs: string
  hasTags: boolean
}

/** Settings shared by a folder or the collection. */
interface BruSettings {
  name: string
  seq: number
  headers: BruRow[]
  authMode: string
  auth: Obj
  varsPre: BruRow[]
  hasScripts: boolean
  docs: string
  hasTags: boolean
}

interface Tree {
  settings: BruSettings
  requests: BruRequest[]
  folders: Tree[]
  unsupported: string[]
}

interface Context {
  warnings: string[]
  variables: Map<string, string>
  pathVariables: Map<string, string>
  dynamic: Set<string>
  scripted: string[]
  tested: string[]
  preVars: string[]
  hasTags: boolean
  unknownBlocks: Set<string>
  multipartContentTypes: boolean
  oauthDrops: Set<string>
  unsupportedSettings: Set<string>
  disabledEnvironmentVariables: number
  secretEnvironmentVariables: number
  unresolvedEnvironmentVariables: string[]
}

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
const rowsOf = (v: unknown): BruRow[] => list(v).map((r) => ({ name: str(r.name), value: str(r.value), enabled: r.enabled !== false }))
const toDict = (rows: BruRow[] | undefined): Obj => Object.fromEntries((rows ?? []).map((r) => [r.name, r.value]))
const hasMetaTags = (rows: BruRow[] | undefined): boolean => !!rows?.some((r) => r.name === 'tags' && r.value.trim())
const emptySettings = (name: string): BruSettings => ({ name, seq: 0, headers: [], authMode: '', auth: {}, varsPre: [], hasScripts: false, docs: '', hasTags: false })
const ENV_REF = /\{\{\s*(?:process\.env|dotenv)\b[^}]*\}\}/i

function variableValue(raw: unknown): string {
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
  if (Array.isArray(raw)) {
    const variant = list(raw).find((item) => item.selected === true) ?? list(raw)[0]
    return variant ? variableValue(isObj(variant) && 'value' in variant ? variant.value : variant) : ''
  }
  if (isObj(raw) && 'data' in raw) return str(raw.data)
  return ''
}

function importEnvironmentVariable(
  variables: Array<{ key: string; value: string; isSecret: boolean }>,
  ctx: Pick<Context, 'disabledEnvironmentVariables' | 'secretEnvironmentVariables' | 'unresolvedEnvironmentVariables'>,
  envName: string,
  rawName: unknown,
  rawValue: unknown,
  options: { enabled?: boolean; isSecret?: boolean }
): void {
  const key = str(rawName)
  if (!key) return
  if (options.enabled === false) {
    ctx.disabledEnvironmentVariables++
    return
  }
  if (options.isSecret) {
    ctx.secretEnvironmentVariables++
    variables.push({ key, value: '', isSecret: true })
    return
  }
  const value = variableValue(rawValue)
  if (ENV_REF.test(value)) {
    ctx.unresolvedEnvironmentVariables.push(`${envName}.${key}`)
    variables.push({ key, value: '', isSecret: false })
    return
  }
  variables.push({ key, value, isSecret: false })
}

function environmentFromBruFile(relPath: string, text: string, ctx: Context): ExportEnvironment | null {
  const parsed = parseBruEnvironment(text)
  const name = baseName(relPath).replace(/\.bru$/i, '')
  const variables: ExportEnvironment['variables'] = []
  for (const row of parsed.variables) importEnvironmentVariable(variables, ctx, name, row.name, row.value, { enabled: row.enabled })
  for (const row of parsed.secretVariables) importEnvironmentVariable(variables, ctx, name, row.name, '', { enabled: row.enabled, isSecret: true })
  if (parsed.malformed) ctx.warnings.push(`"${relPath}": could not fully read the Bruno environment file; invalid lines were ignored.`)
  if (parsed.extends.length > 0) ctx.warnings.push(`"${relPath}": Bruno environment inheritance was not imported (${parsed.extends.slice(0, 3).join(', ')}${parsed.extends.length > 3 ? ', …' : ''}).`)
  if (parsed.externalSecrets.length > 0) ctx.warnings.push(`"${relPath}": external secret providers were not imported (${parsed.externalSecrets.slice(0, 3).join(', ')}${parsed.externalSecrets.length > 3 ? ', …' : ''}).`)
  if (parsed.hasColor) ctx.warnings.push(`"${relPath}": the Bruno environment color was ignored.`)
  return { name, variables }
}

function environmentFromExport(raw: unknown, index: number, ctx: Context): ExportEnvironment {
  const env = isObj(raw) ? raw : {}
  const name = str(env.name) || `Environment ${index + 1}`
  const variables: ExportEnvironment['variables'] = []
  for (const variable of list(env.variables)) {
    importEnvironmentVariable(variables, ctx, name, variable.name, variable.value, {
      enabled: variable.enabled !== false,
      isSecret: variable.secret === true,
    })
  }
  return { name, variables }
}

function additionalParametersFromBlocks(b: BruBlocks): Obj | undefined {
  const read = (name: string, sendIn: string) => (b.dicts.get(name) ?? []).map((row) => ({ ...row, sendIn }))
  const authorization = [...read('auth:oauth2:additional_params:auth_req:headers', 'headers'), ...read('auth:oauth2:additional_params:auth_req:queryparams', 'queryparams')]
  const token = [
    ...read('auth:oauth2:additional_params:access_token_req:headers', 'headers'),
    ...read('auth:oauth2:additional_params:access_token_req:queryparams', 'queryparams'),
    ...read('auth:oauth2:additional_params:access_token_req:body', 'body'),
  ]
  const refresh = [
    ...read('auth:oauth2:additional_params:refresh_token_req:headers', 'headers'),
    ...read('auth:oauth2:additional_params:refresh_token_req:queryparams', 'queryparams'),
    ...read('auth:oauth2:additional_params:refresh_token_req:body', 'body'),
  ]
  return authorization.length > 0 || token.length > 0 || refresh.length > 0 ? { authorization, token, refresh } : undefined
}

function authFromBlocks(b: BruBlocks): Obj {
  const get = (name: string) => toDict(b.dicts.get(`auth:${name}`))
  const o = get('oauth2')
  const key = get('apikey')
  return {
    basic: get('basic'),
    bearer: get('bearer'),
    digest: get('digest'),
    ntlm: get('ntlm'),
    awsv4: get('awsv4'),
    wsse: get('wsse'),
    oauth1: get('oauth1'),
    apikey: key,
    oauth2: {
      grantType: o.grant_type,
      authorizationUrl: o.authorization_url,
      accessTokenUrl: o.access_token_url,
      refreshTokenUrl: o.refresh_token_url,
      clientId: o.client_id,
      clientSecret: o.client_secret,
      scope: o.scope,
      callbackUrl: o.callback_url,
      username: o.username,
      password: o.password,
      state: o.state,
      pkce: o.pkce,
      credentialsPlacement: o.credentials_placement,
      credentialsId: o.credentials_id,
      tokenSource: o.token_source,
      tokenPlacement: o.token_placement,
      tokenHeaderPrefix: o.token_header_prefix,
      tokenQueryKey: o.token_query_key,
      autoFetchToken: o.auto_fetch_token,
      autoRefreshToken: o.auto_refresh_token,
      ...(additionalParametersFromBlocks(b) ? { additionalParameters: additionalParametersFromBlocks(b) } : {}),
    },
  }
}

function requestFromBru(source: string, fallbackName: string): { request: BruRequest; unknown: string[] } {
  const b = parseBru(source)
  const metaRows = b.dicts.get('meta')
  const meta = toDict(metaRows)
  const verb = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'connect', 'trace'].find((m) => b.dicts.has(m))
  const http = toDict(b.dicts.get(verb ?? 'http'))
  const params = [...(b.dicts.get('params:query') ?? []), ...(b.dicts.get('query') ?? [])].map((r) => ({ ...r, type: 'query' }))
    .concat((b.dicts.get('params:path') ?? []).map((r) => ({ ...r, type: 'path' })))
  const t = (name: string) => b.texts.get(name) ?? ''
  return {
    unknown: b.unknown,
    request: {
      name: str(meta.name) || fallbackName,
      type: str(meta.type) || 'http',
      seq: num(meta.seq),
      method: (verb ?? (str(http.method) || 'get')).toUpperCase(),
      url: str(http.url),
      params,
      headers: b.dicts.get('headers') ?? [],
      bodyMode: str(http.body) || 'none',
      body: {
        json: t('body:json'), text: t('body:text'), xml: t('body:xml'), sparql: t('body:sparql'),
        graphql: { query: t('body:graphql'), variables: t('body:graphql:vars') },
        formUrlEncoded: b.dicts.get('body:form-urlencoded') ?? [],
        multipartForm: b.dicts.get('body:multipart-form') ?? [],
        file: b.dicts.get('body:file') ?? [],
      },
      authMode: str(http.auth) || 'none',
      auth: authFromBlocks(b),
      settings: toDict(b.dicts.get('settings')),
      varsPre: b.dicts.get('vars:pre-request') ?? [],
      varsPost: b.dicts.get('vars:post-response') ?? [],
      hasScripts: !!(t('script:pre-request').trim() || t('script:post-response').trim()),
      hasTests: !!t('tests').trim(),
      assertions: (b.dicts.get('assert') ?? []).length,
      docs: t('docs'),
      hasTags: hasMetaTags(metaRows),
    },
  }
}

function settingsFromBru(source: string, fallbackName: string): BruSettings & { unknown: string[] } {
  const b = parseBru(source)
  const metaRows = b.dicts.get('meta')
  const meta = toDict(metaRows)
  const mode = toDict(b.dicts.get('auth')).mode
  return {
    name: str(meta.name) || fallbackName,
    seq: num(meta.seq),
    headers: b.dicts.get('headers') ?? [],
    authMode: str(mode),
    auth: authFromBlocks(b),
    varsPre: b.dicts.get('vars:pre-request') ?? [],
    hasScripts: !!(b.texts.get('script:pre-request')?.trim() || b.texts.get('script:post-response')?.trim() || b.texts.get('tests')?.trim()),
    docs: b.texts.get('docs') ?? '',
    hasTags: hasMetaTags(metaRows),
    unknown: b.unknown,
  }
}

function requestFromExport(item: Obj): BruRequest {
  const r = isObj(item.request) ? item.request : {}
  const body = isObj(r.body) ? r.body : {}
  const auth = isObj(r.auth) ? r.auth : {}
  const script = isObj(r.script) ? r.script : {}
  const vars = isObj(r.vars) ? r.vars : {}
  return {
    name: str(item.name) || 'Request',
    type: str(item.type).replace(/-request$/, '') || 'http',
    seq: num(item.seq),
    method: (str(r.method) || 'GET').toUpperCase(),
    url: str(r.url),
    params: list(r.params).map((p) => ({ name: str(p.name), value: str(p.value), enabled: p.enabled !== false, type: str(p.type) || 'query' })),
    headers: rowsOf(r.headers),
    bodyMode: str(body.mode) || 'none',
    body: {
      json: str(body.json),
      text: str(body.text),
      xml: str(body.xml),
      sparql: str(body.sparql),
      graphql: isObj(body.graphql) ? body.graphql : {},
      formUrlEncoded: rowsOf(body.formUrlEncoded),
      multipartForm: list(body.multipartForm).map((p) => {
        const fileType = str(p.type) === 'file'
        const values = fileType
          ? Array.isArray(p.value) ? p.value.filter((v): v is string => typeof v === 'string' && v.length > 0) : typeof p.value === 'string' && p.value ? [p.value] : []
          : undefined
        return {
          name: str(p.name),
          value: fileType ? (values?.[0] ?? '') : str(p.value),
          enabled: p.enabled !== false,
          ...(fileType ? { fileType, values } : {}),
          ...(str(p.contentType) ? { contentType: str(p.contentType) } : {}),
        }
      }),
      file: list(body.file),
    },
    authMode: str(auth.mode) || 'none',
    auth,
    settings: isObj(item.settings) ? item.settings : {},
    varsPre: rowsOf(vars.req),
    varsPost: rowsOf(vars.res),
    hasScripts: !!(str(script.req).trim() || str(script.res).trim()),
    hasTests: !!str(r.tests).trim(),
    assertions: list(r.assertions).length,
    docs: str(r.docs),
    hasTags: Array.isArray(item.tags) && item.tags.length > 0,
  }
}

function settingsFromExport(root: unknown, name: string, seq: number): BruSettings {
  const raw = isObj(root) ? root : {}
  const r = isObj(raw.request) ? raw.request : {}
  const script = isObj(r.script) ? r.script : {}
  const vars = isObj(r.vars) ? r.vars : {}
  const auth = isObj(r.auth) ? r.auth : {}
  return {
    name,
    seq,
    headers: rowsOf(r.headers),
    authMode: str(auth.mode),
    auth,
    varsPre: rowsOf(vars.req),
    hasScripts: !!(str(script.req).trim() || str(script.res).trim() || str(r.tests).trim()),
    docs: str(r.docs),
    hasTags: Array.isArray(raw.tags) && raw.tags.length > 0,
  }
}

const POST_VAR = /^\$?res\.(body|status|headers)(.*)$/

/** `res.body.token` style expressions become Extract rules; anything computed is skipped. */
function extractRule(row: BruRow): ExtractRule | null {
  const m = POST_VAR.exec(row.value.trim().replace(/^\{\{|\}\}$/g, '').trim())
  if (!m) return null
  const rule = { id: crypto.randomUUID(), variable: row.name, scope: 'collection' as const, enabled: row.enabled }
  if (m[1] === 'status' && !m[2]) return { ...rule, source: 'status', expression: '' }
  if (m[1] === 'body' && /^(\.\w+|\[\d+\]|\[(?:'[^']*'|"[^"]*")\])*$/.test(m[2])) return { ...rule, source: 'json', expression: `$${m[2]}` }
  const header = m[1] === 'headers' ? /^(?:\.([\w-]+)|\[(['"])([^'"]+)\2\])$/.exec(m[2]) : null
  if (header) return { ...rule, source: 'header', expression: header[1] ?? header[3] }
  return null
}

const GRANTS = new Set(['authorization_code', 'client_credentials', 'password', 'implicit'])

function hasAdditionalParameters(raw: unknown): boolean {
  if (!isObj(raw)) return false
  return ['authorization', 'token', 'refresh'].some((key) => Array.isArray(raw[key]) && raw[key].length > 0)
}

function boolValue(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v
  const s = str(v).toLowerCase()
  return s === 'true' ? true : s === 'false' ? false : undefined
}

function intValue(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isInteger(v)) return v
  const s = str(v).trim()
  return /^-?\d+$/.test(s) ? Number(s) : undefined
}

function trackOAuthDrops(o: Obj, grant: string, drops: Set<string>) {
  if (str(o.refreshTokenUrl)) drops.add('refresh token URL')
  if (str(o.state)) drops.add('state')
  if (boolValue(o.pkce) === true) drops.add('PKCE')
  if (str(o.credentialsPlacement) || str(o.credentialsId)) drops.add('credentials placement / saved credentials')
  if (str(o.tokenPlacement) || str(o.tokenHeaderPrefix) || str(o.tokenQueryKey) || str(o.tokenSource)) drops.add('token placement / prefix / query key')
  if (o.autoFetchToken !== undefined || o.autoRefreshToken !== undefined) drops.add('automatic token fetch / refresh')
  if (hasAdditionalParameters(o.additionalParameters)) drops.add('additional auth/token/refresh parameters')
  if (grant === 'password') drops.add('password grant username / password')
}

function convertAuth(mode: string, auth: Obj, label: string, ctx: Context): Auth {
  const a = (name: string): Obj => (isObj(auth[name]) ? auth[name] : {})
  switch (mode) {
    case '':
    case 'inherit':
      return { ...INHERIT }
    case 'none':
      return { ...NO_AUTH }
    case 'basic':
      return { type: 'basic', config: { username: str(a('basic').username), password: str(a('basic').password) } }
    case 'bearer':
      return { type: 'bearer', config: { token: str(a('bearer').token) } }
    case 'digest':
      return { type: 'digest', config: { username: str(a('digest').username), password: str(a('digest').password) } }
    case 'ntlm':
      return { type: 'ntlm', config: { username: str(a('ntlm').username), password: str(a('ntlm').password), domain: str(a('ntlm').domain), workstation: str(a('ntlm').workstation) } }
    case 'apikey': {
      const k = a('apikey')
      return { type: 'apikey', config: { key: str(k.key), value: str(k.value), in: /^query/i.test(str(k.placement)) ? 'query' : 'header' } }
    }
    case 'awsv4': {
      const k = a('awsv4')
      return { type: 'awsv4', config: { accessKey: str(k.accessKeyId), secretKey: str(k.secretAccessKey), sessionToken: str(k.sessionToken), region: str(k.region), service: str(k.service) } }
    }
    case 'oauth2': {
      const o = a('oauth2')
      const grant = str(o.grantType) || 'authorization_code'
      if (!GRANTS.has(grant)) {
        ctx.warnings.push(`${label}: OAuth 2.0 grant type "${grant}" is not supported; configure authentication manually.`)
        return { ...NO_AUTH }
      }
      trackOAuthDrops(o, grant, ctx.oauthDrops)
      return {
        type: 'oauth2',
        config: {
          grantType: grant,
          clientId: str(o.clientId),
          clientSecret: str(o.clientSecret),
          authUrl: str(o.authorizationUrl ?? o.authUrl),
          tokenUrl: str(o.accessTokenUrl ?? o.tokenUrl),
          scopes: str(o.scope ?? o.scopes),
          redirectUri: str(o.callbackUrl ?? o.redirectUri),
        },
      }
    }
    default:
      ctx.warnings.push(`${label}: "${mode}" authentication is not supported; configure it manually.`)
      return { ...NO_AUTH }
  }
}

function stripPartContentType(value: string): { value: string; contentType?: string } {
  const match = /^(.*?)\s*@contentType\((.*?)\)\s*$/s.exec(value)
  if (!match) return { value }
  return { value: match[1].trimEnd(), contentType: match[2].trim() || undefined }
}

function fileValues(value: string): string[] | null {
  const match = /^@file\((.*?)\)$/s.exec(value.trim())
  return match ? match[1].split('|').map((v) => v.trim()).filter(Boolean) : null
}

function mapMultipartRows(raw: unknown, label: string, ctx: Context): Array<ReturnType<typeof kv> & { fieldType?: 'file' }> {
  const rows = Array.isArray(raw) ? raw as MultipartRow[] : []
  const out: Array<ReturnType<typeof kv> & { fieldType?: 'file' }> = []
  let warnedMissingFiles = false
  for (const part of rows) {
    const stripped = stripPartContentType(part.value)
    if (part.contentType || stripped.contentType) ctx.multipartContentTypes = true
    const paths = part.values?.filter(Boolean) ?? fileValues(stripped.value)
    if (part.fileType || paths) {
      if (!paths || paths.length === 0) {
        if (!warnedMissingFiles) ctx.warnings.push(`${label}: one or more multipart file fields were not imported; pick them again in the Body tab.`)
        warnedMissingFiles = true
        continue
      }
      out.push(...paths.map((value) => ({ ...kv(part.name, value, part.enabled), fieldType: 'file' as const })))
      continue
    }
    out.push(kv(part.name, stripped.value, part.enabled))
  }
  return out
}

function convertBody(r: BruRequest, label: string, ctx: Context): { bodyType: string; bodyContent: string } {
  const body = r.body
  const rows = (v: unknown): BruRow[] => (Array.isArray(v) ? v as BruRow[] : [])
  switch (r.bodyMode) {
    case 'json': return { bodyType: 'raw-json', bodyContent: str(body.json) }
    case 'text': return { bodyType: 'raw-text', bodyContent: str(body.text) }
    case 'xml': return { bodyType: 'raw-xml', bodyContent: str(body.xml) }
    case 'sparql': return { bodyType: 'raw-text', bodyContent: str(body.sparql) }
    case 'graphql': {
      const gql = isObj(body.graphql) ? body.graphql : {}
      return { bodyType: 'graphql', bodyContent: JSON.stringify({ query: str(gql.query), variables: str(gql.variables) }) }
    }
    case 'formUrlEncoded':
      return { bodyType: 'x-www-form-urlencoded', bodyContent: JSON.stringify(rows(body.formUrlEncoded).map((p) => kv(p.name, p.value, p.enabled))) }
    case 'multipartForm':
      return { bodyType: 'form-data', bodyContent: JSON.stringify(mapMultipartRows(body.multipartForm, label, ctx)) }
    case 'file':
      ctx.warnings.push(`${label}: the file for the binary body was not imported; pick it again in the Body tab.`)
      return { bodyType: 'binary', bodyContent: '' }
    case 'none':
      return { bodyType: 'none', bodyContent: '' }
    default:
      ctx.warnings.push(`${label}: body type "${r.bodyMode}" is not supported.`)
      return { bodyType: 'none', bodyContent: '' }
  }
}

function noteDynamic(ctx: Context, value: string) {
  for (const m of value.matchAll(/\{\{\s*(\$[A-Za-z]+)\s*\}\}/g)) if (!SUPPORTED_DYNAMIC.has(m[1])) ctx.dynamic.add(m[1])
}

function networkFromSettings(raw: Obj, ctx: Context): NetworkSettings | undefined {
  const out: NetworkSettings = {}
  for (const [key, value] of Object.entries(raw)) {
    switch (key) {
      case 'followRedirects': {
        const parsed = boolValue(value)
        if (parsed === undefined) ctx.unsupportedSettings.add('followRedirects (invalid values)')
        else out.followRedirects = parsed
        break
      }
      case 'maxRedirects': {
        const parsed = intValue(value)
        if (parsed === undefined || parsed < 0 || parsed > MAX_REDIRECT_LIMIT) ctx.unsupportedSettings.add('maxRedirects (invalid values)')
        else out.maxRedirects = parsed
        break
      }
      case 'timeout': {
        const parsed = intValue(value)
        if (parsed === undefined || parsed <= 0 || parsed > MAX_TIMEOUT_MS) ctx.unsupportedSettings.add('timeout (non-positive or out-of-range values)')
        else out.timeout = parsed
        break
      }
      default:
        ctx.unsupportedSettings.add(key)
        break
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function convertRequest(r: BruRequest, ctx: Context): ExportRequest {
  const label = `"${r.name}"`
  const declared = r.params.filter((p) => p.type === 'path').map((p) => ({ key: p.name, value: p.value }))
  const split = splitUrl(r.url, ctx.pathVariables, declared)
  const queryRows = r.params.filter((p) => p.type !== 'path')
  const params = queryRows.length > 0 || split.query === null ? queryRows.map((p) => kv(p.name, p.value, p.enabled)) : parseQuery(split.query)
  const headers = r.headers.filter((h) => h.name).map((h) => kv(h.name, h.value, h.enabled))
  const body = convertBody(r, label, ctx)
  const auth = convertAuth(r.authMode, r.auth, label, ctx)
  const network = networkFromSettings(r.settings, ctx)

  if (r.hasScripts) ctx.scripted.push(label)
  if (r.hasTests || r.assertions > 0) ctx.tested.push(label)
  if (r.varsPre.length > 0) ctx.preVars.push(label)
  if (r.hasTags) ctx.hasTags = true

  const rules: ExtractRule[] = []
  const skipped: string[] = []
  for (const row of r.varsPost) {
    const rule = extractRule(row)
    if (rule) rules.push(rule)
    else skipped.push(row.name)
  }
  if (skipped.length > 0) ctx.warnings.push(`${label}: ${skipped.length} post-response variable${skipped.length === 1 ? '' : 's'} could not be converted (${skipped.slice(0, 3).join(', ')}).`)

  for (const value of [split.url, ...params.map((p) => p.key + p.value), ...headers.map((h) => h.key + h.value), body.bodyContent]) noteDynamic(ctx, value)

  return {
    name: r.name,
    method: r.method,
    url: split.url,
    protocol: 'http',
    params,
    headers,
    bodyType: body.bodyType,
    bodyContent: body.bodyContent,
    auth,
    ssl: 'inherit',
    ...(network ? { network } : {}),
    description: r.docs,
    protocolConfig: rules.length > 0 ? { [EXTRACT_RULES_KEY]: serializeRules(rules) } : {},
  }
}

function convertFolderSettings(s: BruSettings, label: string, ctx: Context): { description: string; auth: Auth } {
  if (s.headers.some((h) => h.name)) ctx.warnings.push(`${label}: its headers were not imported; add them to each request.`)
  if (s.hasScripts) ctx.scripted.push(label)
  if (s.varsPre.length > 0) {
    for (const row of s.varsPre) if (row.enabled && !ctx.variables.has(row.name)) ctx.variables.set(row.name, row.value)
    ctx.warnings.push(`${label}: its variables were added to the collection variables.`)
  }
  if (s.hasTags) ctx.hasTags = true
  return { description: s.docs, auth: convertAuth(s.authMode, s.auth, label, ctx) }
}

function convertTree(tree: Tree, ctx: Context): { requests: ExportRequest[]; folders: ExportFolder[] } {
  const requests: ExportRequest[] = []
  for (const r of [...tree.requests].sort((a, b) => a.seq - b.seq)) requests.push(convertRequest(r, ctx))
  const folders: ExportFolder[] = [...tree.folders].sort((a, b) => a.settings.seq - b.settings.seq).map((child) => {
    const { description, auth } = convertFolderSettings(child.settings, `Folder "${child.settings.name}"`, ctx)
    return { name: child.settings.name, description, auth, ssl: 'inherit', ...convertTree(child, ctx) }
  })
  for (const name of tree.unsupported) ctx.warnings.push(`"${name}": only HTTP and GraphQL requests are imported.`)
  return { requests, folders }
}

function finish(name: string, settings: BruSettings, tree: Tree, environments: ExportEnvironment[], extra: string[], ctx: Context): BrunoEntry {
  for (const row of settings.varsPre) if (row.enabled && !ctx.variables.has(row.name)) ctx.variables.set(row.name, row.value)
  if (settings.hasTags) ctx.hasTags = true
  const rootAuth = convertAuth(settings.authMode, settings.auth, 'Collection', ctx)
  if (settings.headers.some((h) => h.name)) ctx.warnings.push('Collection: its headers were not imported; add them to each request.')
  if (settings.hasScripts) ctx.scripted.push('Collection')

  const { requests, folders } = convertTree(tree, ctx)
  if (requests.length === 0 && folders.length === 0) ctx.warnings.push('The collection has no requests.')

  if (ctx.scripted.length > 0) {
    const sample = ctx.scripted.slice(0, 3).join(', ')
    ctx.warnings.push(`Scripts were not imported for ${ctx.scripted.length} item${ctx.scripted.length === 1 ? '' : 's'} (${sample}${ctx.scripted.length > 3 ? ', …' : ''}).`)
  }
  if (ctx.preVars.length > 0) ctx.warnings.push(`Request variables (pre-request vars) were not imported for ${ctx.preVars.length} request${ctx.preVars.length === 1 ? '' : 's'} (${ctx.preVars.slice(0, 3).join(', ')}${ctx.preVars.length > 3 ? ', …' : ''}).`)
  if (ctx.tested.length > 0) ctx.warnings.push(`Tests and assertions were not imported for ${ctx.tested.length} request${ctx.tested.length === 1 ? '' : 's'}.`)
  if (ctx.disabledEnvironmentVariables > 0) ctx.warnings.push(`Bruno environments skipped ${ctx.disabledEnvironmentVariables} disabled variable${ctx.disabledEnvironmentVariables === 1 ? '' : 's'}.`)
  if (ctx.secretEnvironmentVariables > 0) ctx.warnings.push(`Bruno environments imported ${ctx.secretEnvironmentVariables} secret variable${ctx.secretEnvironmentVariables === 1 ? '' : 's'} with blank values; re-enter them in Postly.`)
  if (ctx.unresolvedEnvironmentVariables.length > 0) ctx.warnings.push(`Bruno environment values using dotenv/process.env references were not imported for ${ctx.unresolvedEnvironmentVariables.length} variable${ctx.unresolvedEnvironmentVariables.length === 1 ? '' : 's'} (${ctx.unresolvedEnvironmentVariables.slice(0, 3).join(', ')}${ctx.unresolvedEnvironmentVariables.length > 3 ? ', …' : ''}); enter them manually in Postly.`)
  if (ctx.dynamic.size > 0) ctx.warnings.push(`Dynamic variables Postly does not provide are used and will stay unresolved: ${[...ctx.dynamic].map((d) => `{{${d}}}`).join(', ')}.`)
  if (ctx.unknownBlocks.size > 0) ctx.warnings.push(`Unsupported Bruno blocks were ignored: ${[...ctx.unknownBlocks].sort().join(', ')}.`)
  if (ctx.hasTags) ctx.warnings.push('Tags on the collection, folders, or requests were not imported.')
  if (ctx.multipartContentTypes) ctx.warnings.push('Multipart part content types were not imported because Postly form-data rows do not support them.')
  if (ctx.oauthDrops.size > 0) ctx.warnings.push(`OAuth 2.0 settings were not imported: ${[...ctx.oauthDrops].join(', ')}.`)
  if (ctx.unsupportedSettings.size > 0) ctx.warnings.push(`Bruno request settings were not imported: ${[...ctx.unsupportedSettings].sort().join(', ')}.`)
  ctx.warnings.push(...extra)
  for (const [key, value] of ctx.pathVariables) if (!ctx.variables.has(key)) ctx.variables.set(key, value)

  return {
    collection: {
      name: name || 'Imported Bruno collection',
      description: settings.docs,
      source: 'local',
      auth: rootAuth.type === 'inherit' ? { ...NO_AUTH } : rootAuth,
      ssl: 'inherit',
      variables: [...ctx.variables].map(([key, value]) => ({ key, value, isSecret: false })),
      ...(environments.length > 0 ? { environments } : {}),
      requests,
      folders,
    },
    warnings: [...new Set(ctx.warnings)],
  }
}

const IGNORED_DIRS = new Set(['node_modules', '.git'])
const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const dirName = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

function commonAncestor(paths: string[]): string {
  if (paths.length === 0) return ''
  let parts = dirName(paths[0]).split('/').filter(Boolean)
  for (const current of paths.slice(1).map((p) => dirName(p).split('/').filter(Boolean))) {
    let i = 0
    while (i < parts.length && i < current.length && parts[i] === current[i]) i++
    parts = parts.slice(0, i)
  }
  return parts.join('/')
}

export function isBrunoYamlCollection(files: BrunoFile[]): boolean {
  return files.some((f) => /(^|\/)opencollection\.ya?ml$/.test(f.path))
}

export function convertBrunoFiles(input: BrunoFile[]): BrunoEntry[] {
  const files = input.map((f) => ({ ...f, path: f.path.replace(/\\/g, '/').replace(/^\.?\//, '') }))
    .filter((f) => !f.path.split('/').some((seg) => IGNORED_DIRS.has(seg)))

  const roots = files.filter((f) => baseName(f.path) === 'bruno.json').map((f) => dirName(f.path))
  if (roots.length === 0) {
    const bruFiles = files.filter((f) => f.path.endsWith('.bru'))
    if (bruFiles.length === 0) return []
    roots.push(commonAncestor(bruFiles.map((f) => f.path)))
  }
  roots.sort((a, b) => b.length - a.length)
  const owner = (path: string) => roots.find((r) => r === '' || path.startsWith(`${r}/`))

  return roots.map((root) => {
    const prefix = root ? `${root}/` : ''
    const mine = files.filter((f) => owner(f.path) === root)
    const rel = (f: BrunoFile) => f.path.slice(prefix.length)
    const budget = new ImportBudget()
    const unknownBlocks = new Set<string>()

    const warnings: string[] = []
    let name = baseName(root)
    const config = mine.find((f) => rel(f) === 'bruno.json')
    const extra: string[] = []
    if (config) {
      try {
        const json = JSON.parse(config.text) as Obj
        if (str(json.name)) name = str(json.name)
        const proxy = isObj(json.proxy) ? json.proxy : {}
        const certs = isObj(json.clientCertificates) ? list(json.clientCertificates.certs) : []
        if (proxy.enabled === true || str(proxy.enabled) === 'true' || certs.length > 0) extra.push('The collection’s proxy and client certificate settings were not imported; configure them in Postly’s settings.')
      } catch (err) {
        warnings.push(`bruno.json could not be read (${(err as Error).message}); the folder name was used.`)
      }
    }

    const ctx: Context = {
      warnings: [...warnings],
      variables: new Map(),
      pathVariables: new Map(),
      dynamic: new Set(),
      scripted: [],
      tested: [],
      preVars: [],
      hasTags: false,
      unknownBlocks,
      multipartContentTypes: false,
      oauthDrops: new Set(),
      unsupportedSettings: new Set(),
      disabledEnvironmentVariables: 0,
      secretEnvironmentVariables: 0,
      unresolvedEnvironmentVariables: [],
    }
    const environments = mine.filter((f) => /^environments\/[^/]+\.bru$/i.test(rel(f)))
      .sort((a, b) => rel(a).localeCompare(rel(b)))
      .map((f) => environmentFromBruFile(rel(f), f.text, ctx))
      .filter((environment): environment is ExportEnvironment => environment !== null)
    const collectionBru = mine.find((f) => rel(f) === 'collection.bru')
    const parsedSettings = collectionBru ? settingsFromBru(collectionBru.text, name) : undefined
    const settings = parsedSettings ?? emptySettings(name)
    for (const block of parsedSettings?.unknown ?? []) unknownBlocks.add(block)

    const makeTree = (dir: string, folderSettings: BruSettings, depth: number): Tree => {
      budget.take(depth)
      const tree: Tree = { settings: folderSettings, requests: [], folders: [], unsupported: [] }
      const subdirs = new Set<string>()
      for (const f of mine) {
        const r = rel(f)
        if (!r.startsWith(dir) || r === 'bruno.json' || /^environments\//.test(r)) continue
        const rest = r.slice(dir.length)
        if (rest.includes('/')) subdirs.add(rest.split('/')[0])
        else if (f.path.endsWith('.bru') && baseName(f.path) !== 'folder.bru' && !(dir === '' && rest === 'collection.bru')) {
          const parsed = requestFromBru(f.text, baseName(f.path).replace(/\.bru$/, ''))
          for (const block of parsed.unknown) unknownBlocks.add(block)
          budget.take(depth + 1)
          if (parsed.request.type === 'http' || parsed.request.type === 'graphql') tree.requests.push(parsed.request)
          else tree.unsupported.push(parsed.request.name)
        }
      }
      for (const sub of [...subdirs].sort()) {
        const folderFile = mine.find((f) => rel(f) === `${dir}${sub}/folder.bru`)
        const parsedFolderSettings = folderFile ? settingsFromBru(folderFile.text, sub) : undefined
        const s = parsedFolderSettings ?? emptySettings(sub)
        for (const block of parsedFolderSettings?.unknown ?? []) unknownBlocks.add(block)
        tree.folders.push(makeTree(`${dir}${sub}/`, s, depth + 1))
      }
      return tree
    }
    return finish(name, settings, makeTree('', settings, 0), environments, extra, ctx)
  })
}

export function isBrunoExport(doc: unknown): boolean {
  return isObj(doc) && typeof doc.name === 'string' && Array.isArray(doc.items) && (doc.version === '1' || doc.version === 1) && (isObj(doc.brunoConfig) || Array.isArray(doc.environments))
}

export function convertBrunoExport(doc: Obj): BrunoEntry {
  const budget = new ImportBudget()
  const build = (items: Obj[], settings: BruSettings, depth: number): Tree => {
    budget.take(depth)
    const tree: Tree = { settings, requests: [], folders: [], unsupported: [] }
    for (const item of items) {
      budget.take(depth + 1)
      if (item.type === 'folder') {
        const name = str(item.name) || 'Folder'
        tree.folders.push(build(list(item.items), settingsFromExport(item.root, name, num(item.seq)), depth + 1))
      } else if (/^(http|graphql)(-request)?$/.test(str(item.type))) tree.requests.push(requestFromExport(item))
      else tree.unsupported.push(str(item.name))
    }
    return tree
  }
  const root = settingsFromExport(doc.root, str(doc.name), 0)
  const ctx: Context = {
    warnings: [],
    variables: new Map(),
    pathVariables: new Map(),
    dynamic: new Set(),
    scripted: [],
    tested: [],
    preVars: [],
    hasTags: false,
    unknownBlocks: new Set(),
    multipartContentTypes: false,
    oauthDrops: new Set(),
    unsupportedSettings: new Set(),
    disabledEnvironmentVariables: 0,
    secretEnvironmentVariables: 0,
    unresolvedEnvironmentVariables: [],
  }
  const environments = list(doc.environments).map((environment, index) => environmentFromExport(environment, index, ctx))
  return finish(str(doc.name), root, build(list(doc.items), root, 0), environments, [], ctx)
}

/** A standalone Bruno environment export: { info: { type: 'bruno-environment' }, environments: [...] }. */
export function isBrunoEnvironmentExport(doc: unknown): boolean {
  return isObj(doc) && isObj(doc.info) && doc.info.type === 'bruno-environment' && Array.isArray(doc.environments)
}

export function convertBrunoEnvironmentExport(doc: Obj): { environments: ExportEnvironment[]; warnings: string[] } {
  const ctx: Context = {
    warnings: [],
    variables: new Map(),
    pathVariables: new Map(),
    dynamic: new Set(),
    scripted: [],
    tested: [],
    preVars: [],
    hasTags: false,
    unknownBlocks: new Set(),
    multipartContentTypes: false,
    oauthDrops: new Set(),
    unsupportedSettings: new Set(),
    disabledEnvironmentVariables: 0,
    secretEnvironmentVariables: 0,
    unresolvedEnvironmentVariables: [],
  }
  const raw = list(doc.environments)
  const environments = raw.map((environment, index) => environmentFromExport(environment, index, ctx))
  // `extends` inherits the parent's variables; Postly environments are flat, so they are copied in
  const byName = new Map(environments.map((e) => [e.name, e]))
  const resolve = (name: string, seen: Set<string>): ExportEnvironment['variables'] => {
    const env = byName.get(name)
    const parent = str(raw[environments.indexOf(env as ExportEnvironment)]?.extends)
    if (!env || !parent || seen.has(name) || !byName.has(parent)) return env?.variables ?? []
    seen.add(name)
    const own = new Set(env.variables.map((v) => v.key))
    return [...resolve(parent, seen).filter((v) => !own.has(v.key)), ...env.variables]
  }
  const extended = raw.filter((e) => str(e.extends)).length
  const resolved = environments.map((e) => ({ ...e, variables: resolve(e.name, new Set()) }))
  if (extended > 0) ctx.warnings.push(`${extended} environment${extended === 1 ? ' extends' : 's extend'} another; the inherited variables were copied in.`)
  if (ctx.disabledEnvironmentVariables > 0) ctx.warnings.push(`Bruno environments skipped ${ctx.disabledEnvironmentVariables} disabled variable${ctx.disabledEnvironmentVariables === 1 ? '' : 's'}.`)
  if (ctx.secretEnvironmentVariables > 0) ctx.warnings.push(`Bruno environments imported ${ctx.secretEnvironmentVariables} secret variable${ctx.secretEnvironmentVariables === 1 ? '' : 's'} with blank values; re-enter them in Postly.`)
  return { environments: resolved, warnings: ctx.warnings }
}
