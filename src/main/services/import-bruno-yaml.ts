import crypto from 'crypto'
import { CORE_SCHEMA, load as yamlLoad, mergeTag } from 'js-yaml'
import { EXTRACT_RULES_KEY, serializeRules, type ExtractRule } from '../../shared/extract'
import { DYNAMIC_VARIABLES } from '../../shared/variables'
import type { ExportCollection, ExportEnvironment, ExportFolder, ExportRequest } from '../ipc/export-import'
import type { BrunoEntry, BrunoFile } from './import-bruno'
import { ImportBudget, isObj, kv, list, parseQuery, splitUrl, str, type Auth, type Obj } from './import-util'
import { MAX_REDIRECT_LIMIT, MAX_TIMEOUT_MS, type NetworkSettings } from './network-settings'

const NO_AUTH: Auth = { type: 'none', config: {} }
const INHERIT: Auth = { type: 'inherit', config: {} }
const SUPPORTED_DYNAMIC = new Set(DYNAMIC_VARIABLES.map((v) => v.name))
const POST_VAR = /^\$?res\.(body|status|headers)(.*)$/
const IGNORED_DIRS = new Set(['node_modules', '.git'])

type VariableSource = 'collection' | 'folder' | 'request' | 'path'

interface Ordered {
  name: string
  seq?: number
}

interface FolderDraft extends Ordered {
  description: string
  auth: Auth
  network?: NetworkSettings
}

interface VariableEntry {
  value: string
  isSecret: boolean
}

interface Context {
  warnings: string[]
  variables: Map<string, VariableEntry>
  pathVariables: Map<string, string>
  dynamic: Set<string>
  scripted: string[]
  tested: string[]
  docs: string[]
  defaultHeaders: string[]
  defaultActions: string[]
  unsupportedActions: string[]
  unsupportedRequests: string[]
  unknownKeys: Map<string, Set<string>>
  multipartContentTypes: boolean
  oauthDrops: Set<string>
  unsupportedSettings: Set<string>
  variableCounts: Record<VariableSource, number>
  variableCollision: boolean
  disabledEnvironmentVariables: number
  secretEnvironmentVariables: number
  unresolvedEnvironmentVariables: string[]
}

const ENV_REF = /\{\{\s*(?:process\.env|dotenv)\b[^}]*\}\}/i

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)
const dirName = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

function normalizeFiles(input: BrunoFile[]): BrunoFile[] {
  return input
    .map((f) => ({ ...f, path: f.path.replace(/\\/g, '/').replace(/^\.?\//, '') }))
    .filter((f) => !f.path.split('/').some((seg) => IGNORED_DIRS.has(seg)))
}

function compareOrdered(a: Ordered, b: Ordered): number {
  const aSeq = typeof a.seq === 'number' && Number.isFinite(a.seq)
  const bSeq = typeof b.seq === 'number' && Number.isFinite(b.seq)
  if (aSeq && bSeq && a.seq !== b.seq) return (a.seq as number) - (b.seq as number)
  if (aSeq !== bSeq) return aSeq ? -1 : 1
  return a.name.localeCompare(b.name)
}

function loadYaml(text: string): unknown {
  return yamlLoad(text.replace(/^\uFEFF/, ''), { schema: CORE_SCHEMA.withTags(mergeTag) })
}

function textContent(value: unknown): string {
  if (typeof value === 'string') return value
  if (isObj(value) && typeof value.content === 'string') return value.content
  return ''
}

function num(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return undefined
}

function chosen(raw: unknown): Obj {
  if (Array.isArray(raw)) return list(raw).find((item) => item.selected === true) ?? list(raw)[0] ?? {}
  return isObj(raw) ? raw : {}
}

function boolValue(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v
  if (v === 'inherit') return undefined
  const s = str(v).toLowerCase()
  return s === 'true' ? true : s === 'false' ? false : undefined
}

function intValue(v: unknown): number | undefined {
  if (v === 'inherit') return undefined
  if (typeof v === 'number' && Number.isInteger(v)) return v
  const s = str(v).trim()
  return /^-?\d+$/.test(s) ? Number(s) : undefined
}

function noteUnknown(ctx: Context, label: string, raw: unknown, allowed: Set<string>, prefix = ''): void {
  if (!isObj(raw)) return
  const unknown = ctx.unknownKeys.get(label) ?? new Set<string>()
  for (const key of Object.keys(raw)) if (!allowed.has(key)) unknown.add(prefix ? `${prefix}.${key}` : key)
  if (unknown.size > 0) ctx.unknownKeys.set(label, unknown)
}

function noteDynamic(ctx: Context, value: string): void {
  for (const m of value.matchAll(/\{\{\s*(\$[A-Za-z]+)\s*\}\}/g)) if (!SUPPORTED_DYNAMIC.has(m[1])) ctx.dynamic.add(m[1])
}

function variableValue(raw: unknown): string {
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
  if (Array.isArray(raw)) {
    const variant = list(raw).find((item) => item.selected === true) ?? list(raw)[0]
    return variant ? variableValue(variant.value) : ''
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

function trackVariable(ctx: Context, source: VariableSource, name: string, value: string, isSecret: boolean): void {
  if (!name) return
  if (ctx.variables.has(name)) {
    ctx.variableCollision = true
    return
  }
  ctx.variableCounts[source]++
  ctx.variables.set(name, { value: isSecret ? '' : value, isSecret })
  if (!isSecret) noteDynamic(ctx, value)
}

function collectVariables(raw: unknown, source: VariableSource, ctx: Context): void {
  for (const entry of list(raw)) {
    if (entry.disabled === true) continue
    const name = str(entry.name)
    if (!name) continue
    const isSecret = entry.secret === true
      || (!('value' in entry) && ('path' in entry || 'secretName' in entry || 'vaultName' in entry || 'projectId' in entry))
    trackVariable(ctx, source, name, variableValue(entry.value), isSecret)
  }
}

function extractRule(variable: string, expression: string, enabled: boolean): ExtractRule | null {
  const m = POST_VAR.exec(expression.trim().replace(/^\{\{|\}\}$/g, '').trim())
  if (!m) return null
  const rule = { id: crypto.randomUUID(), variable, scope: 'collection' as const, enabled }
  if (m[1] === 'status' && !m[2]) return { ...rule, source: 'status', expression: '' }
  if (m[1] === 'body' && /^(\.\w+|\[\d+\]|\[(?:'[^']*'|"[^"]*")\])*$/.test(m[2])) return { ...rule, source: 'json', expression: `$${m[2]}` }
  const header = m[1] === 'headers' ? /^(?:\.([\w-]+)|\[(['"])([^'"]+)\2\])$/.exec(m[2]) : null
  if (header) return { ...rule, source: 'header', expression: header[1] ?? header[3] }
  return null
}

const SUPPORTED_GRANTS = new Map<string, string>([
  ['authorization_code', 'authorization_code'],
  ['client_credentials', 'client_credentials'],
  ['resource_owner_password_credentials', 'password'],
  ['implicit', 'implicit'],
])

function noteOAuthDrops(raw: Obj, grant: string, ctx: Context): void {
  if (str(raw.refreshTokenUrl)) ctx.oauthDrops.add('refresh token URL')
  if (str(raw.state)) ctx.oauthDrops.add('state')
  if (isObj(raw.pkce) && (raw.pkce.disabled !== true || str(raw.pkce.method))) ctx.oauthDrops.add('PKCE')
  if (isObj(raw.credentials) && (str(raw.credentials.placement) || str(raw.credentials.id))) ctx.oauthDrops.add('credentials placement / saved credentials')
  if (isObj(raw.tokenConfig) && (str(raw.tokenConfig.id) || isObj(raw.tokenConfig.placement) || str(raw.tokenConfig.source))) ctx.oauthDrops.add('token placement / saved token source')
  if (isObj(raw.settings) && (raw.settings.autoFetchToken !== undefined || raw.settings.autoRefreshToken !== undefined)) ctx.oauthDrops.add('automatic token fetch / refresh')
  if (isObj(raw.additionalParameters)) {
    const params = [raw.additionalParameters.authorizationRequest, raw.additionalParameters.accessTokenRequest, raw.additionalParameters.refreshTokenRequest]
    if (params.some((value) => Array.isArray(value) && value.length > 0)) ctx.oauthDrops.add('additional auth/token/refresh parameters')
  }
  if (grant === 'password' && isObj(raw.resourceOwner) && (str(raw.resourceOwner.username) || str(raw.resourceOwner.password))) ctx.oauthDrops.add('password grant username / password')
}

function convertAuth(raw: unknown, label: string, ctx: Context): Auth {
  if (raw === 'inherit') return { ...INHERIT }
  if (!isObj(raw) || !raw.type) return { ...INHERIT }
  switch (raw.type) {
    case 'basic':
      return { type: 'basic', config: { username: str(raw.username), password: str(raw.password) } }
    case 'bearer':
      return { type: 'bearer', config: { token: str(raw.token) } }
    case 'digest':
      return { type: 'digest', config: { username: str(raw.username), password: str(raw.password) } }
    case 'ntlm':
      return { type: 'ntlm', config: { username: str(raw.username), password: str(raw.password), domain: str(raw.domain), workstation: '' } }
    case 'apikey':
      return { type: 'apikey', config: { key: str(raw.key), value: str(raw.value), in: raw.placement === 'query' ? 'query' : 'header' } }
    case 'awsv4':
      return {
        type: 'awsv4',
        config: {
          accessKey: str(raw.accessKeyId),
          secretKey: str(raw.secretAccessKey),
          sessionToken: str(raw.sessionToken),
          region: str(raw.region),
          service: str(raw.service),
        },
      }
    case 'oauth2': {
      const flow = str(raw.flow) || 'authorization_code'
      const grantType = SUPPORTED_GRANTS.get(flow)
      if (!grantType) {
        ctx.warnings.push(`${label}: OAuth 2.0 grant type "${flow}" is not supported; configure authentication manually.`)
        return { ...NO_AUTH }
      }
      noteOAuthDrops(raw, grantType, ctx)
      const credentials = isObj(raw.credentials) ? raw.credentials : {}
      return {
        type: 'oauth2',
        config: {
          grantType,
          clientId: str(credentials.clientId),
          clientSecret: str(credentials.clientSecret),
          authUrl: str(raw.authorizationUrl),
          tokenUrl: str(raw.accessTokenUrl),
          scopes: str(raw.scope),
          redirectUri: str(raw.callbackUrl),
        },
      }
    }
    case 'none':
      return { ...NO_AUTH }
    default:
      ctx.warnings.push(`${label}: "${str(raw.type)}" authentication is not supported; configure it manually.`)
      return { ...NO_AUTH }
  }
}

function networkFromSettings(raw: unknown, ctx: Context): NetworkSettings | undefined {
  if (!isObj(raw)) return undefined
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
      case 'encodeUrl':
      case 'forwardAuthorizationHeader':
      case 'omitHeaders':
        if (value !== 'inherit') ctx.unsupportedSettings.add(key)
        break
      default:
        ctx.unsupportedSettings.add(key)
        break
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function mergeNetworks(a?: NetworkSettings, b?: NetworkSettings): NetworkSettings | undefined {
  if (!a) return b
  if (!b) return a
  return { ...a, ...b }
}

function networkFromRequestDefaults(raw: unknown, ctx: Context): NetworkSettings | undefined {
  if (!isObj(raw)) return undefined
  noteUnknown(ctx, 'opencollection.yml', raw, new Set(['http', 'graphql']), 'request.settings')
  return mergeNetworks(networkFromSettings(raw.http, ctx), networkFromSettings(raw.graphql, ctx))
}

function rows(raw: unknown): Obj[] {
  return list(raw)
}

function mapMultipartEntries(raw: unknown, label: string, ctx: Context): Array<ReturnType<typeof kv> & { fieldType?: 'file' }> {
  const out: Array<ReturnType<typeof kv> & { fieldType?: 'file' }> = []
  let warnedMissing = false
  for (const part of rows(raw)) {
    const name = str(part.name)
    const enabled = part.disabled !== true
    if (part.contentType) ctx.multipartContentTypes = true
    if (part.type === 'file') {
      const values = Array.isArray(part.value)
        ? part.value.map((value) => str(value)).filter(Boolean)
        : [str(part.value)].filter(Boolean)
      if (values.length === 0) {
        if (!warnedMissing) ctx.warnings.push(`${label}: one or more multipart file fields were not imported; pick them again in the Body tab.`)
        warnedMissing = true
        continue
      }
      out.push(...values.map((value) => ({ ...kv(name, value, enabled), fieldType: 'file' as const })))
      continue
    }
    out.push(kv(name, str(part.value), enabled))
  }
  return out
}

function convertHttpBody(raw: unknown, label: string, ctx: Context): { bodyType: string; bodyContent: string } {
  const body = Array.isArray(raw) ? chosen(raw).body : raw
  if (!isObj(body)) return { bodyType: 'none', bodyContent: '' }
  const mode = str(body.type || body.mode)
  switch (mode) {
    case 'json':
      return { bodyType: 'raw-json', bodyContent: str(body.data || body.json) }
    case 'text':
      return { bodyType: 'raw-text', bodyContent: str(body.data || body.text) }
    case 'xml':
      return { bodyType: 'raw-xml', bodyContent: str(body.data || body.xml) }
    case 'sparql':
      return { bodyType: 'raw-text', bodyContent: str(body.data || body.sparql) }
    case 'graphql':
      {
        const graphql = isObj(body.graphql) ? body.graphql : {}
        const variables = typeof body.variables === 'string'
          ? body.variables
          : str(graphql.variables) || JSON.stringify(body.variables ?? graphql.variables ?? '')
        return {
          bodyType: 'graphql',
          bodyContent: JSON.stringify({
            query: str(body.query) || str(graphql.query),
            variables,
          }),
        }
      }
    case 'form-urlencoded':
    case 'formUrlEncoded':
      return {
        bodyType: 'x-www-form-urlencoded',
        bodyContent: JSON.stringify(rows(body.data || body.formUrlEncoded).map((entry) => kv(str(entry.name), str(entry.value), entry.disabled !== true))),
      }
    case 'multipart-form':
    case 'multipartForm':
      return { bodyType: 'form-data', bodyContent: JSON.stringify(mapMultipartEntries(body.data || body.multipartForm, label, ctx)) }
    case 'file':
      ctx.warnings.push(`${label}: the file for the binary body was not imported; pick it again in the Body tab.`)
      return { bodyType: 'binary', bodyContent: '' }
    case 'none':
      return { bodyType: 'none', bodyContent: '' }
    default:
      ctx.warnings.push(`${label}: body type "${mode}" is not supported.`)
      return { bodyType: 'none', bodyContent: '' }
  }
}

function convertGraphqlBody(raw: unknown): { bodyType: string; bodyContent: string } {
  const body = Array.isArray(raw) ? chosen(raw).body : raw
  const picked = isObj(body) ? body : {}
  const variables = typeof picked.variables === 'string' ? picked.variables : JSON.stringify(picked.variables ?? '')
  return { bodyType: 'graphql', bodyContent: JSON.stringify({ query: str(picked.query), variables }) }
}

function rulesFromActions(raw: unknown, label: string, ctx: Context): ExtractRule[] {
  const rules: ExtractRule[] = []
  const skipped: string[] = []
  let unsupported = 0
  for (const action of list(raw)) {
    if (action.type !== 'set-variable' || str(action.phase || 'after-response') !== 'after-response') {
      unsupported++
      continue
    }
    const variable = isObj(action.variable) ? action.variable : {}
    const selector = isObj(action.selector) ? action.selector : {}
    const name = str(variable.name)
    const rule = extractRule(name, str(selector.expression), action.disabled !== true)
    if (rule) rules.push(rule)
    else skipped.push(name || '?')
  }
  if (unsupported > 0) ctx.unsupportedActions.push(`${label} (${unsupported})`)
  if (skipped.length > 0) ctx.warnings.push(`${label}: ${skipped.length} post-response action${skipped.length === 1 ? '' : 's'} could not be converted (${skipped.slice(0, 3).join(', ')}).`)
  return rules
}

function pushRequest(
  raw: unknown,
  relPath: string,
  budget: ImportBudget,
  ctx: Context,
  requestsByDir: Map<string, Array<Ordered & { request: ExportRequest }>>
): void {
  if (!isObj(raw)) {
    ctx.warnings.push(`"${relPath}": expected a YAML object.`)
    return
  }
  budget.take(relPath.split('/').length - 1)
  noteUnknown(ctx, relPath, raw, new Set(['info', 'http', 'graphql', 'grpc', 'websocket', 'runtime', 'settings', 'app', 'examples', 'docs']))
  const info = isObj(raw.info) ? raw.info : {}
  noteUnknown(ctx, relPath, info, new Set(['name', 'description', 'type', 'seq', 'tags']), 'info')
  const type = str(info.type) || (isObj(raw.http) ? 'http' : isObj(raw.graphql) ? 'graphql' : isObj(raw.grpc) ? 'grpc' : isObj(raw.websocket) ? 'websocket' : 'http')
  const name = str(info.name) || baseName(relPath).replace(/\.ya?ml$/i, '')
  const label = `"${name}"`
  if (textContent(raw.docs).trim()) ctx.docs.push(label)
  const runtime = isObj(raw.runtime) ? raw.runtime : {}
  noteUnknown(ctx, relPath, runtime, new Set(['variables', 'scripts', 'assertions', 'actions']), 'runtime')
  collectVariables(runtime.variables, 'request', ctx)
  if (list(runtime.scripts).length > 0) ctx.scripted.push(label)
  if (list(runtime.assertions).length > 0 || list(runtime.scripts).some((script) => script.type === 'tests')) ctx.tested.push(label)
  if (type === 'grpc' || type === 'websocket') {
    ctx.unsupportedRequests.push(name)
    return
  }

  const block = isObj(raw[type]) ? raw[type] : {}
  noteUnknown(ctx, relPath, block, new Set(['method', 'url', 'headers', 'params', 'body', 'auth']), type)
  const declared = rows(block.params).filter((param) => str(param.type) === 'path').map((param) => ({ key: str(param.name), value: str(param.value) }))
  const split = splitUrl(str(block.url), ctx.pathVariables, declared)
  const paramsRaw = rows(block.params)
  const queryParams = paramsRaw.filter((param) => str(param.type) !== 'path')
  const params = queryParams.length > 0 || split.query === null
    ? queryParams.map((param) => kv(str(param.name), str(param.value), param.disabled !== true))
    : parseQuery(split.query)
  const headers = rows(block.headers).map((header) => kv(str(header.name), str(header.value), header.disabled !== true)).filter((header) => header.key)
  const body = type === 'graphql' ? convertGraphqlBody(block.body) : convertHttpBody(block.body, label, ctx)
  const auth = convertAuth(block.auth, label, ctx)
  const settings = networkFromSettings(raw.settings, ctx)
  const rules = rulesFromActions(runtime.actions, label, ctx)
  for (const value of [split.url, ...params.map((param) => param.key + param.value), ...headers.map((header) => header.key + header.value), body.bodyContent]) noteDynamic(ctx, value)
  const request: ExportRequest = {
    name,
    method: str(block.method || (type === 'graphql' ? 'POST' : 'GET')).toUpperCase(),
    url: split.url,
    protocol: 'http',
    params,
    headers,
    bodyType: body.bodyType,
    bodyContent: body.bodyContent,
    auth,
    ssl: 'inherit',
    ...(settings ? { network: settings } : {}),
    description: textContent(info.description),
    protocolConfig: rules.length > 0 ? { [EXTRACT_RULES_KEY]: serializeRules(rules) } : {},
  }
  const bucket = requestsByDir.get(dirName(relPath)) ?? []
  bucket.push({ name, seq: num(info.seq), request })
  requestsByDir.set(dirName(relPath), bucket)
}

function parseFolderFile(raw: unknown, relPath: string, ctx: Context): FolderDraft {
  if (!isObj(raw)) {
    ctx.warnings.push(`"${relPath}": expected a YAML object.`)
    return { name: dirName(relPath).split('/').pop() || 'Folder', description: '', auth: { ...INHERIT } }
  }
  noteUnknown(ctx, relPath, raw, new Set(['info', 'items', 'request', 'docs']))
  const info = isObj(raw.info) ? raw.info : {}
  noteUnknown(ctx, relPath, info, new Set(['name', 'description', 'type', 'seq', 'tags']), 'info')
  const name = str(info.name) || dirName(relPath).split('/').pop() || 'Folder'
  const label = `Folder "${name}"`
  if (textContent(raw.docs).trim()) ctx.docs.push(label)
  const request = isObj(raw.request) ? raw.request : {}
  noteUnknown(ctx, relPath, request, new Set(['headers', 'metadata', 'auth', 'variables', 'actions', 'scripts', 'settings']), 'request')
  if (rows(request.headers).some((header) => str(header.name))) ctx.defaultHeaders.push(label)
  collectVariables(request.variables, 'folder', ctx)
  if (list(request.actions).length > 0) ctx.defaultActions.push(label)
  if (list(request.scripts).length > 0) ctx.scripted.push(label)
  const network = networkFromRequestDefaults(request.settings, ctx)
  return { name, seq: num(info.seq), description: textContent(info.description), auth: convertAuth(request.auth, label, ctx), ...(network ? { network } : {}) }
}

function applyCollectionDefaults(raw: unknown, rootDir: string, ctx: Context): { name: string; description: string; auth: Auth; network?: NetworkSettings } {
  const fallback = baseName(rootDir) || 'Imported Bruno YAML collection'
  if (!isObj(raw)) return { name: fallback, description: '', auth: { ...NO_AUTH } }
  noteUnknown(ctx, 'opencollection.yml', raw, new Set(['opencollection', 'info', 'request', 'docs', 'extensions', 'config', 'bundled', 'items']))
  const info = isObj(raw.info) ? raw.info : {}
  noteUnknown(ctx, 'opencollection.yml', info, new Set(['name', 'summary', 'version', 'authors']), 'info')
  if (textContent(raw.docs).trim()) ctx.docs.push('Collection')
  const request = isObj(raw.request) ? raw.request : {}
  noteUnknown(ctx, 'opencollection.yml', request, new Set(['headers', 'metadata', 'auth', 'variables', 'actions', 'scripts', 'settings']), 'request')
  if (rows(request.headers).some((header) => str(header.name))) ctx.defaultHeaders.push('Collection')
  collectVariables(request.variables, 'collection', ctx)
  if (list(request.actions).length > 0) ctx.defaultActions.push('Collection')
  if (list(request.scripts).length > 0) ctx.scripted.push('Collection')
  const network = networkFromRequestDefaults(request.settings, ctx)
  return {
    name: str(info.name) || fallback,
    description: str(info.summary),
    auth: convertAuth(request.auth, 'Collection', ctx),
    ...(network ? { network } : {}),
  }
}

function parseEnvironmentFile(raw: unknown, relPath: string, ctx: Context): ExportEnvironment | null {
  if (!isObj(raw)) {
    ctx.warnings.push(`"${relPath}": expected a YAML object.`)
    return null
  }
  noteUnknown(ctx, relPath, raw, new Set(['name', 'variables']))
  const name = str(raw.name) || baseName(relPath).replace(/\.ya?ml$/i, '')
  const variables: ExportEnvironment['variables'] = []
  for (const variable of list(raw.variables)) {
    noteUnknown(ctx, relPath, variable, new Set(['name', 'value', 'enabled', 'disabled', 'secret', 'type', 'path', 'secretName', 'vaultName', 'projectId']), 'variables[]')
    const isSecret = variable.secret === true
      || (!('value' in variable) && ('path' in variable || 'secretName' in variable || 'vaultName' in variable || 'projectId' in variable))
    importEnvironmentVariable(variables, ctx, name, variable.name, variable.value, {
      enabled: variable.disabled !== true && variable.enabled !== false,
      isSecret,
    })
  }
  return { name, variables }
}

function addDirWithAncestors(set: Set<string>, dir: string): void {
  let current = dir
  while (current) {
    if (set.has(current)) break
    set.add(current)
    current = dirName(current)
  }
}

function buildFolderTree(
  folderDrafts: Map<string, FolderDraft>,
  requestsByDir: Map<string, Array<Ordered & { request: ExportRequest }>>,
  budget: ImportBudget
): ExportFolder[] {
  const dirs = new Set<string>()
  for (const dir of folderDrafts.keys()) if (dir) addDirWithAncestors(dirs, dir)
  for (const dir of requestsByDir.keys()) if (dir) addDirWithAncestors(dirs, dir)
  const children = new Map<string, string[]>()
  for (const dir of dirs) {
    const parent = dirName(dir)
    const list = children.get(parent) ?? []
    list.push(dir)
    children.set(parent, list)
  }

  const build = (dir: string, depth: number): ExportFolder => {
    budget.take(depth)
    const draft = folderDrafts.get(dir) ?? { name: baseName(dir) || 'Folder', description: '', auth: { ...INHERIT } }
    const requests = [...(requestsByDir.get(dir) ?? [])].sort(compareOrdered).map((entry) => entry.request)
    const folders = [...(children.get(dir) ?? [])].sort((a, b) => compareOrdered(folderDrafts.get(a) ?? { name: baseName(a) }, folderDrafts.get(b) ?? { name: baseName(b) })).map((child) => build(child, depth + 1))
    return {
      name: draft.name,
      description: draft.description,
      auth: draft.auth,
      ssl: 'inherit',
      ...(draft.network ? { network: draft.network } : {}),
      requests,
      folders,
    }
  }

  return [...(children.get('') ?? [])].sort((a, b) => compareOrdered(folderDrafts.get(a) ?? { name: baseName(a) }, folderDrafts.get(b) ?? { name: baseName(b) })).map((child) => build(child, 1))
}

function finishCollection(collection: ExportCollection, ctx: Context): BrunoEntry {
  if (collection.requests.length === 0 && collection.folders.length === 0) ctx.warnings.push('The collection has no requests.')
  if (ctx.scripted.length > 0) ctx.warnings.push(`Scripts were not imported for ${ctx.scripted.length} item${ctx.scripted.length === 1 ? '' : 's'} (${ctx.scripted.slice(0, 3).join(', ')}${ctx.scripted.length > 3 ? ', …' : ''}).`)
  if (ctx.tested.length > 0) ctx.warnings.push(`Tests and assertions were not imported for ${ctx.tested.length} request${ctx.tested.length === 1 ? '' : 's'}.`)
  if (ctx.docs.length > 0) ctx.warnings.push(`Documentation blocks were not imported for ${ctx.docs.length} item${ctx.docs.length === 1 ? '' : 's'} (${ctx.docs.slice(0, 3).join(', ')}${ctx.docs.length > 3 ? ', …' : ''}).`)
  if (ctx.defaultHeaders.length > 0) ctx.warnings.push(`Inherited headers were not imported for ${ctx.defaultHeaders.length} item${ctx.defaultHeaders.length === 1 ? '' : 's'} (${ctx.defaultHeaders.slice(0, 3).join(', ')}${ctx.defaultHeaders.length > 3 ? ', …' : ''}); add them to each request.`)
  if (ctx.defaultActions.length > 0) ctx.warnings.push(`Collection or folder post-response actions were not imported for ${ctx.defaultActions.length} item${ctx.defaultActions.length === 1 ? '' : 's'} (${ctx.defaultActions.slice(0, 3).join(', ')}${ctx.defaultActions.length > 3 ? ', …' : ''}).`)
  if (ctx.unsupportedActions.length > 0) ctx.warnings.push(`Actions other than after-response variable setters were not imported for ${ctx.unsupportedActions.length} request${ctx.unsupportedActions.length === 1 ? '' : 's'} (${ctx.unsupportedActions.slice(0, 3).join(', ')}${ctx.unsupportedActions.length > 3 ? ', …' : ''}).`)
  if (ctx.unsupportedRequests.length > 0) ctx.warnings.push(`Only HTTP and GraphQL requests were imported; ${ctx.unsupportedRequests.length} request${ctx.unsupportedRequests.length === 1 ? '' : 's'} ${ctx.unsupportedRequests.length === 1 ? 'was' : 'were'} skipped (${ctx.unsupportedRequests.slice(0, 3).join(', ')}${ctx.unsupportedRequests.length > 3 ? ', …' : ''}).`)
  if (ctx.variableCounts.folder > 0 || ctx.variableCounts.request > 0) {
    const parts = [
      ctx.variableCounts.folder > 0 ? `${ctx.variableCounts.folder} folder variable${ctx.variableCounts.folder === 1 ? '' : 's'}` : '',
      ctx.variableCounts.request > 0 ? `${ctx.variableCounts.request} request variable${ctx.variableCounts.request === 1 ? '' : 's'}` : '',
    ].filter(Boolean)
    ctx.warnings.push(`${parts.join(' and ')} were imported as collection variables${ctx.variableCollision ? '; first value won when names collided' : ''}.`)
  }
  if (ctx.disabledEnvironmentVariables > 0) ctx.warnings.push(`Bruno environments skipped ${ctx.disabledEnvironmentVariables} disabled variable${ctx.disabledEnvironmentVariables === 1 ? '' : 's'}.`)
  if (ctx.secretEnvironmentVariables > 0) ctx.warnings.push(`Bruno environments imported ${ctx.secretEnvironmentVariables} secret variable${ctx.secretEnvironmentVariables === 1 ? '' : 's'} with blank values; re-enter them in Postly.`)
  if (ctx.unresolvedEnvironmentVariables.length > 0) ctx.warnings.push(`Bruno environment values using dotenv/process.env references were not imported for ${ctx.unresolvedEnvironmentVariables.length} variable${ctx.unresolvedEnvironmentVariables.length === 1 ? '' : 's'} (${ctx.unresolvedEnvironmentVariables.slice(0, 3).join(', ')}${ctx.unresolvedEnvironmentVariables.length > 3 ? ', …' : ''}); enter them manually in Postly.`)
  if (ctx.dynamic.size > 0) ctx.warnings.push(`Dynamic variables Postly does not provide are used and will stay unresolved: ${[...ctx.dynamic].map((value) => `{{${value}}}`).join(', ')}.`)
  if (ctx.multipartContentTypes) ctx.warnings.push('Multipart part content types were not imported because Postly form-data rows do not support them.')
  if (ctx.oauthDrops.size > 0) ctx.warnings.push(`OAuth 2.0 settings were not imported: ${[...ctx.oauthDrops].join(', ')}.`)
  if (ctx.unsupportedSettings.size > 0) ctx.warnings.push(`Bruno request settings were not imported: ${[...ctx.unsupportedSettings].sort().join(', ')}.`)
  if (ctx.unknownKeys.size > 0) ctx.warnings.push(`Unknown OpenCollection keys were ignored: ${[...ctx.unknownKeys.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, keys]) => `${label} (${[...keys].sort().join(', ')})`).join('; ')}.`)
  return { collection, warnings: [...new Set(ctx.warnings)] }
}

export function isBrunoYamlFolder(files: BrunoFile[]): boolean {
  return normalizeFiles(files).some((file) => baseName(file.path).toLowerCase() === 'opencollection.yml')
}

export function convertBrunoYamlFiles(input: BrunoFile[]): BrunoEntry[] {
  const files = normalizeFiles(input)
  const roots = files.filter((file) => baseName(file.path).toLowerCase() === 'opencollection.yml').map((file) => dirName(file.path))
  if (roots.length === 0) return []
  roots.sort((a, b) => b.length - a.length)
  const owner = (path: string) => roots.find((root) => root === '' || path.startsWith(`${root}/`))

  return roots.map((root) => {
    const budget = new ImportBudget()
    const prefix = root ? `${root}/` : ''
    const mine = files.filter((file) => owner(file.path) === root)
    const relative = (file: BrunoFile) => file.path.slice(prefix.length)
    const folderDrafts = new Map<string, FolderDraft>()
    const requestsByDir = new Map<string, Array<Ordered & { request: ExportRequest }>>()
    const environments: ExportEnvironment[] = []
    const ctx: Context = {
      warnings: [],
      variables: new Map(),
      pathVariables: new Map(),
      dynamic: new Set(),
      scripted: [],
      tested: [],
      docs: [],
      defaultHeaders: [],
      defaultActions: [],
      unsupportedActions: [],
      unsupportedRequests: [],
      unknownKeys: new Map(),
      multipartContentTypes: false,
      oauthDrops: new Set(),
      unsupportedSettings: new Set(),
      variableCounts: { collection: 0, folder: 0, request: 0, path: 0 },
      variableCollision: false,
      disabledEnvironmentVariables: 0,
      secretEnvironmentVariables: 0,
      unresolvedEnvironmentVariables: [],
    }

    let collectionMeta: { name: string; description: string; auth: Auth; network?: NetworkSettings } = {
      name: baseName(root) || 'Imported Bruno YAML collection',
      description: '',
      auth: { ...NO_AUTH },
    }

    for (const file of mine) {
      const relPath = relative(file)
      if (/^environments\/[^/]+\.ya?ml$/i.test(relPath)) {
        let doc: unknown
        try {
          doc = loadYaml(file.text)
        } catch (error) {
          ctx.warnings.push(`"${relPath}": could not read YAML (${(error as Error).message}).`)
          continue
        }
        const environment = parseEnvironmentFile(doc, relPath, ctx)
        if (environment) environments.push(environment)
        continue
      }
      if (!/\.ya?ml$/i.test(relPath)) continue
      let doc: unknown
      try {
        doc = loadYaml(file.text)
      } catch (error) {
        ctx.warnings.push(`"${relPath}": could not read YAML (${(error as Error).message}).`)
        continue
      }
      if (relPath === 'opencollection.yml') {
        collectionMeta = applyCollectionDefaults(doc, root, ctx)
        continue
      }
      if (/^(.+\/)?folder\.ya?ml$/i.test(relPath)) {
        budget.take(relPath.split('/').length - 1)
        folderDrafts.set(dirName(relPath), parseFolderFile(doc, relPath, ctx))
        continue
      }
      pushRequest(doc, relPath, budget, ctx, requestsByDir)
    }

    for (const [key, value] of ctx.pathVariables) trackVariable(ctx, 'path', key, value, false)
    const folders = buildFolderTree(folderDrafts, requestsByDir, budget)
    const requests = [...(requestsByDir.get('') ?? [])].sort(compareOrdered).map((entry) => entry.request)
    const collection: ExportCollection = {
      name: collectionMeta.name,
      description: collectionMeta.description,
      source: 'local',
      auth: collectionMeta.auth.type === 'inherit' ? { ...NO_AUTH } : collectionMeta.auth,
      ssl: 'inherit',
      ...(collectionMeta.network ? { network: collectionMeta.network } : {}),
      variables: [...ctx.variables.entries()].map(([key, value]) => ({ key, value: value.value, isSecret: value.isSecret })),
      ...(environments.length > 0 ? { environments } : {}),
      requests,
      folders,
    }
    return finishCollection(collection, ctx)
  })
}
