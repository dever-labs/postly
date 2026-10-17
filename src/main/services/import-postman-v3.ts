import path from 'node:path'
import { CORE_SCHEMA, load as yamlLoad, mergeTag } from 'js-yaml'
import { EXTRACT_RULES_KEY, serializeRules } from '../../shared/extract'
import { DYNAMIC_VARIABLES } from '../../shared/variables'
import type { ExportCollection, ExportFolder, ExportRequest } from '../ipc/export-import'
import { convertPostmanScripts } from './import-postman'
import { ImportBudget, isObj, kv, list, parseQuery, splitUrl, str, type Auth, type Obj } from './import-util'
import type { NetworkSettings } from './network-settings'

export interface PostmanV3File {
  path: string
  text: string
}

interface NormalizedFile extends PostmanV3File {
  path: string
}

interface ParsedFile extends NormalizedFile {
  doc?: unknown
  error?: string
}

interface ConvertContext {
  warnings: string[]
  variables: Map<string, { value: string; isSecret: boolean }>
  pathVariables: Map<string, string>
  dynamic: Set<string>
  budget: ImportBudget
  collapsedFolderVariables: number
  collectionScriptScopes: number
  folderScriptScopes: number
  requestExamples: number
  requestsWithExamples: number
  environmentFiles: number
  nonHttpKinds: Map<string, number>
  unknownByFile: Map<string, Set<string>>
}

interface FolderDoc {
  path: string
  raw: Obj
}

const NO_AUTH: Auth = { type: 'none', config: {} }
const INHERIT: Auth = { type: 'inherit', config: {} }
const SUPPORTED_DYNAMIC = new Set(DYNAMIC_VARIABLES.map((v) => v.name))

const COLLECTION_KEYS = new Set(['id', 'name', 'description', '$kind', 'variables', 'scripts', 'auth', 'uses', 'items'])
const FOLDER_KEYS = new Set(['id', 'name', 'description', '$kind', 'variables', 'scripts', 'auth', 'items'])
const HTTP_REQUEST_KEYS = new Set([
  'id', 'name', 'description', 'url', 'method', 'headers', 'queryParams', 'pathVariables', 'body', 'auth', '$kind',
  'examples', 'settings', 'scripts', 'uses', 'usedBy',
])
const GRAPHQL_REQUEST_KEYS = new Set([
  'id', 'name', 'description', 'url', 'query', 'variables', 'headers', 'settings', 'auth', 'schema', 'operationName',
  '$kind', 'examples', 'scripts',
])
const YAML_OPTIONS = { schema: CORE_SCHEMA.withTags(mergeTag) }

const textValue = (v: unknown): string => (typeof v === 'string' ? v : isObj(v) ? str(v.content) : '')
const stemOfRequest = (p: string) => path.posix.basename(p).replace(/\.request\.ya?ml$/i, '')
const isYamlPath = (p: string) => /\.ya?ml$/i.test(p)
const isDefinitionPath = (p: string) => /(?:^|\/)\.resources\/definition\.ya?ml$/i.test(p)
const isRequestPath = (p: string) => /\.request\.ya?ml$/i.test(p)
const isExamplePath = (p: string) => /\.example\.ya?ml$/i.test(p)
function normalizePath(raw: string): string {
  const normalized = path.posix.normalize(raw.replace(/\\/g, '/')).replace(/^\.(?:\/|$)/, '')
  return normalized === '.' ? '' : normalized.replace(/^\//, '')
}

function parseYaml(text: string): unknown {
  const trimmed = text.replace(/^\uFEFF/, '').trim()
  if (!trimmed) throw new Error('The file is empty.')
  return yamlLoad(trimmed, YAML_OPTIONS)
}

function noteDynamic(ctx: ConvertContext, value: string): void {
  for (const m of value.matchAll(/\{\{\s*(\$[A-Za-z]+)\s*\}\}/g)) if (!SUPPORTED_DYNAMIC.has(m[1])) ctx.dynamic.add(m[1])
}

function warningLabel(p: string): string {
  return p || '(selected folder)'
}

function addUnknownKeys(ctx: ConvertContext, filePath: string, raw: Obj, allowed: Set<string>): void {
  const unknown = Object.keys(raw).filter((key) => !allowed.has(key))
  if (unknown.length === 0) return
  const set = ctx.unknownByFile.get(filePath) ?? new Set<string>()
  for (const key of unknown) set.add(key)
  ctx.unknownByFile.set(filePath, set)
}

function variableRows(raw: unknown): Array<{ key: string; value: string; isSecret: boolean }> {
  const rows: Array<{ key: string; value: string; isSecret: boolean }> = []
  for (const variable of list(raw)) {
    if (variable.disabled === true) continue
    const key = str(variable.key)
    if (!key) continue
    rows.push({ key, value: str(variable.value), isSecret: variable.secret === true })
  }
  return rows
}

function addScopeVariables(ctx: ConvertContext, raw: unknown, scope: 'collection' | 'folder'): void {
  for (const variable of variableRows(raw)) {
    if (scope === 'folder') ctx.collapsedFolderVariables++
    if (!ctx.variables.has(variable.key)) ctx.variables.set(variable.key, { value: variable.value, isSecret: variable.isSecret })
  }
}

function authValue(auth: Obj, key: string): string {
  const credentials = Array.isArray(auth.credentials) ? auth.credentials : []
  const direct = credentials.find((entry) => isObj(entry) && entry.key === key)
  if (direct && !isObj(direct.value)) return str(direct.value)
  const nested = auth[str(auth.type)]
  if (Array.isArray(nested)) {
    const row = nested.find((entry) => isObj(entry) && entry.key === key)
    if (row && !isObj(row.value)) return str(row.value)
  }
  return isObj(nested) ? str(nested[key]) : ''
}

function authEntry(auth: unknown, url: string | undefined, label: string, warnings: string[]): Obj | null {
  if (!Array.isArray(auth)) return isObj(auth) ? auth : null
  const entries = list(auth)
  if (entries.length === 0) return null
  const matches = (entry: Obj): boolean => {
    const rules = list(entry.rules)
    if (rules.length === 0 || !url) return rules.length === 0
    return rules.every((rule) => rule.key === 'url' && str(rule.value) === url)
  }
  const chosen = entries.find(matches) ?? entries.find((entry) => list(entry.rules).length === 0) ?? entries[0]
  if (entries.length > 1 || list(chosen.rules).length > 0) {
    warnings.push(`${label}: conditional auth rules are not supported; only one credential set was imported.`)
  }
  return chosen
}

function convertAuth(raw: unknown, label: string, warnings: string[], url?: string): Auth {
  const auth = authEntry(raw, url, label, warnings)
  if (!auth?.type) return { ...INHERIT }
  const get = (key: string) => authValue(auth, key)
  switch (auth.type) {
    case 'inherit':
      return { ...INHERIT }
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
      const grantType = ({ authorization_code_with_pkce: 'authorization_code', password_credentials: 'password' } as Record<string, string>)[get('grantType') || get('grant_type')] ?? (get('grantType') || get('grant_type') || 'authorization_code')
      if (grantType === 'password') warnings.push(`${label}: the username and password of the OAuth 2.0 password grant were not mapped.`)
      return {
        type: 'oauth2',
        config: {
          grantType,
          clientId: get('clientId'),
          clientSecret: get('clientSecret'),
          authUrl: get('authUrl') || get('authorizationUrl'),
          tokenUrl: get('accessTokenUrl') || get('tokenUrl'),
          scopes: get('scope') || get('scopes'),
          redirectUri: get('redirect_uri') || get('redirectUri'),
        },
      }
    }
    default:
      warnings.push(`${label}: "${str(auth.type)}" authentication is not supported; configure it manually.`)
      return { ...NO_AUTH }
  }
}

function convertBody(body: unknown, headers: Obj[], label: string, warnings: string[]): { bodyType: string; bodyContent: string } {
  if (!isObj(body) || !body.type || body.type === 'none') return { bodyType: 'none', bodyContent: '' }
  switch (body.type) {
    case 'json':
      return { bodyType: 'raw-json', bodyContent: str(body.content) }
    case 'xml':
      return { bodyType: 'raw-xml', bodyContent: str(body.content) }
    case 'html':
      return { bodyType: 'raw-html', bodyContent: str(body.content) }
    case 'javascript':
      return { bodyType: 'raw-javascript', bodyContent: str(body.content) }
    case 'text':
      return { bodyType: 'raw-text', bodyContent: str(body.content) }
    case 'graphql': {
      const gql = isObj(body.content) ? body.content : {}
      return { bodyType: 'graphql', bodyContent: JSON.stringify({ query: str(gql.query), variables: str(gql.variables) }) }
    }
    case 'formdata':
      return {
        bodyType: 'form-data',
        bodyContent: JSON.stringify(list(body.content).map((part) => {
          const file = str(part.type) === 'file'
          const value = file ? (Array.isArray(part.src) ? str(part.src[0]) : str(part.src)) : str(part.value)
          return { ...kv(str(part.key), value, part.disabled !== true), ...(file ? { fieldType: 'file' as const } : {}) }
        })),
      }
    case 'urlencoded':
      return { bodyType: 'x-www-form-urlencoded', bodyContent: JSON.stringify(list(body.content).map((part) => kv(str(part.key), part.value, part.disabled !== true))) }
    case 'file': {
      const content = isObj(body.content) ? body.content : {}
      if (str(content.src)) warnings.push(`${label}: the file for the binary body was not imported; pick it again in the Body tab.`)
      return { bodyType: 'binary', bodyContent: '' }
    }
    default: {
      const contentType = str(headers.find((h) => str(h.key).toLowerCase() === 'content-type' && h.disabled !== true)?.value).toLowerCase()
      if (!contentType && str(body.content)) return { bodyType: 'raw-text', bodyContent: str(body.content) }
      warnings.push(`${label}: body type "${str(body.type)}" is not supported.`)
      return { bodyType: 'none', bodyContent: '' }
    }
  }
}

function convertScripts(name: string, raw: unknown): { rules: ReturnType<typeof convertPostmanScripts>['rules']; warnings: string[]; count: number } {
  const scripts = list(raw)
  const events = scripts
    .map((script) => {
      const code = str(script.code)
      if (!code) return null
      const type = str(script.type).toLowerCase()
      const listen = type.includes('afterresponse') ? 'test' : type.includes('before') ? 'prerequest' : type
      return { listen, script: { exec: code.split(/\r?\n/) } }
    })
    .filter((event): event is { listen: string; script: { exec: string[] } } => event !== null)
  const converted = convertPostmanScripts(name, events)
  return { ...converted, count: events.length }
}

function convertHeaders(raw: unknown): Obj[] {
  return list(raw).filter((row) => str(row.key)).map((row) => kv(str(row.key), row.value, row.disabled !== true))
}

function convertQueryParams(raw: unknown): Obj[] {
  return list(raw).filter((row) => row.key !== undefined && row.key !== null && str(row.key)).map((row) => kv(str(row.key), row.value, row.disabled !== true))
}

function convertSettings(raw: unknown, label: string, warnings: string[]): { ssl: ExportRequest['ssl']; network?: NetworkSettings } {
  if (!isObj(raw)) return { ssl: 'inherit' }
  const ssl = typeof raw.strictSSL === 'boolean' ? (raw.strictSSL ? 'enabled' : 'disabled') : 'inherit'
  const network: NetworkSettings = {}
  if (typeof raw.followRedirects === 'boolean') network.followRedirects = raw.followRedirects
  const maxRedirects = typeof raw.maxRedirects === 'number' && Number.isFinite(raw.maxRedirects)
    ? raw.maxRedirects
    : typeof raw.maxRedirects === 'string' && /^\d+$/.test(raw.maxRedirects) ? Number(raw.maxRedirects) : undefined
  if (maxRedirects !== undefined) network.maxRedirects = maxRedirects
  const ignored = Object.keys(raw).filter((key) => !['strictSSL', 'followRedirects', 'maxRedirects'].includes(key))
  if (ignored.length > 0) warnings.push(`${label}: unsupported request settings were ignored: ${ignored.sort().join(', ')}.`)
  return Object.keys(network).length > 0 ? { ssl, network } : { ssl }
}

function resolveUrlFromDoc(raw: Obj, ctx: ConvertContext): { url: string; params: Obj[] } {
  const declared = list(raw.pathVariables).map((row) => ({ key: str(row.key), value: row.value }))
  const split = splitUrl(str(raw.url), ctx.pathVariables, declared)
  const params = Array.isArray(raw.queryParams) && raw.queryParams.length > 0 ? convertQueryParams(raw.queryParams) : split.query !== null ? parseQuery(split.query) : []
  return { url: split.url, params }
}

function convertHttpRequest(doc: Obj, requestName: string, filePath: string, ctx: ConvertContext): ExportRequest {
  addUnknownKeys(ctx, filePath, doc, HTTP_REQUEST_KEYS)
  const { url, params } = resolveUrlFromDoc(doc, ctx)
  const headers = convertHeaders(doc.headers)
  const body = convertBody(doc.body, headers, `"${requestName}"`, ctx.warnings)
  const scripts = convertScripts(requestName, doc.scripts)
  ctx.warnings.push(...scripts.warnings)
  if (Array.isArray(doc.examples) && doc.examples.length > 0) {
    ctx.requestExamples += doc.examples.length
    ctx.requestsWithExamples++
  }
  const { ssl, network } = convertSettings(doc.settings, `"${requestName}"`, ctx.warnings)
  const auth = convertAuth(doc.auth, `"${requestName}"`, ctx.warnings, url)
  for (const value of [url, ...params.map((row) => str(row.key) + str(row.value)), ...headers.map((row) => str(row.key) + str(row.value)), body.bodyContent]) noteDynamic(ctx, value)
  return {
    name: requestName,
    method: (str(doc.method) || 'GET').toUpperCase(),
    url,
    protocol: 'http',
    params,
    headers,
    bodyType: body.bodyType,
    bodyContent: body.bodyContent,
    auth,
    ssl,
    ...(network ? { network } : {}),
    description: textValue(doc.description),
    protocolConfig: scripts.rules.length > 0 ? { [EXTRACT_RULES_KEY]: serializeRules(scripts.rules) } : {},
  }
}

function convertGraphqlRequest(doc: Obj, requestName: string, filePath: string, ctx: ConvertContext): ExportRequest {
  addUnknownKeys(ctx, filePath, doc, GRAPHQL_REQUEST_KEYS)
  const split = splitUrl(str(doc.url), ctx.pathVariables)
  const headers = convertHeaders(doc.headers)
  const scripts = convertScripts(requestName, doc.scripts)
  ctx.warnings.push(...scripts.warnings)
  if (Array.isArray(doc.examples) && doc.examples.length > 0) {
    ctx.requestExamples += doc.examples.length
    ctx.requestsWithExamples++
  }
  const { ssl, network } = convertSettings(doc.settings, `"${requestName}"`, ctx.warnings)
  const bodyContent = JSON.stringify({ query: str(doc.query), variables: str(doc.variables) })
  const auth = convertAuth(doc.auth, `"${requestName}"`, ctx.warnings, split.url)
  for (const value of [split.url, bodyContent, ...headers.map((row) => str(row.key) + str(row.value))]) noteDynamic(ctx, value)
  return {
    name: requestName,
    method: 'POST',
    url: split.url,
    protocol: 'http',
    params: split.query !== null ? parseQuery(split.query) : [],
    headers,
    bodyType: 'graphql',
    bodyContent,
    auth,
    ssl,
    ...(network ? { network } : {}),
    description: textValue(doc.description),
    protocolConfig: scripts.rules.length > 0 ? { [EXTRACT_RULES_KEY]: serializeRules(scripts.rules) } : {},
  }
}

function countResourceExamples(files: ParsedFile[], rootPath: string): { examples: number; requests: number } {
  const prefix = rootPath ? `${rootPath}/` : ''
  const exampleFiles = files.filter((file) => file.path.startsWith(prefix) && /(?:^|\/)\.resources\/[^/]+\.resources\/examples\/[^/]+\.example\.ya?ml$/i.test(file.path))
  const requests = new Set(exampleFiles.map((file) => file.path.replace(/\/\.resources\/([^/]+)\.resources\/examples\/[^/]+\.example\.ya?ml$/i, '/$1.request.yaml')))
  return { examples: exampleFiles.length, requests: requests.size }
}

function pushSharedWarnings(
  collection: ExportCollection,
  ctx: ConvertContext,
  resourceExamples: { examples: number; requests: number },
): string[] {
  const warnings = [...ctx.warnings]
  if (ctx.collectionScriptScopes + ctx.folderScriptScopes > 0) {
    const parts = [
      ctx.collectionScriptScopes > 0 ? `${ctx.collectionScriptScopes} collection script scope${ctx.collectionScriptScopes === 1 ? '' : 's'}` : '',
      ctx.folderScriptScopes > 0 ? `${ctx.folderScriptScopes} folder script scope${ctx.folderScriptScopes === 1 ? '' : 's'}` : '',
    ].filter(Boolean)
    warnings.push(`${parts.join(' and ')} ${parts.length === 1 ? 'was' : 'were'} not imported.`)
  }
  const totalExamples = ctx.requestExamples + resourceExamples.examples
  const requestsWithExamples = ctx.requestsWithExamples + resourceExamples.requests
  if (totalExamples > 0) warnings.push(`${totalExamples} saved response example${totalExamples === 1 ? '' : 's'} across ${requestsWithExamples} request${requestsWithExamples === 1 ? '' : 's'} were not imported.`)
  if (ctx.environmentFiles > 0) warnings.push(`${ctx.environmentFiles} Postman environment file${ctx.environmentFiles === 1 ? ' was' : 's were'} found but environments are not imported.`)
  if (ctx.nonHttpKinds.size > 0) {
    const labels = new Map<string, string>([
      ['grpc-request', 'gRPC request'],
      ['websocket-request', 'WebSocket request'],
      ['socket.io-request', 'Socket.IO request'],
      ['mqtt-request', 'MQTT request'],
      ['kafka-request', 'Kafka request'],
      ['mcp-request', 'MCP request'],
      ['llm-request', 'LLM request'],
      ['data-request', 'data request'],
      ['graphql-request', 'GraphQL request'],
    ])
    warnings.push(`Unsupported Postman request kinds were skipped: ${[...ctx.nonHttpKinds.entries()].map(([kind, count]) => `${count} ${labels.get(kind) ?? kind}${count === 1 ? '' : 's'}`).join(', ')}.`)
  }
  if (ctx.dynamic.size > 0) warnings.push(`Postman dynamic variables Postly does not provide are used and will stay unresolved: ${[...ctx.dynamic].map((name) => `{{${name}}}`).join(', ')}.`)
  if (ctx.collapsedFolderVariables > 0) warnings.push(`${ctx.collapsedFolderVariables} folder variable${ctx.collapsedFolderVariables === 1 ? ' was' : 's were'} imported as collection variables because Postly only supports collection-scoped variables; collection variables kept priority and the first value won when names collided.`)
  if (ctx.unknownByFile.size > 0) {
    const details = [...ctx.unknownByFile.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([filePath, keys]) => `${warningLabel(filePath)} (${[...keys].sort().join(', ')})`)
    warnings.push(`Unknown keys were ignored in ${details.length} file${details.length === 1 ? '' : 's'}: ${details.join('; ')}.`)
  }
  if (collection.requests.length === 0 && collection.folders.length === 0) warnings.push('The collection has no requests.')
  return warnings
}

function folderNameFromPath(rootPath: string): string {
  if (!rootPath) return 'Imported Postman v3 collection'
  const parts = rootPath.split('/').filter(Boolean)
  return parts[parts.length - 1] || 'Imported Postman v3 collection'
}

function buildFolderTree(
  rootPath: string,
  files: ParsedFile[],
  rootDoc: Obj,
  ctx: ConvertContext,
): { requests: ExportRequest[]; folders: ExportFolder[] } {
  const requestFiles = new Map<string, ParsedFile[]>()
  const folderDefs = new Map<string, FolderDoc>()
  const folderDirs = new Set<string>([''])
  const rootPrefix = rootPath ? `${rootPath}/` : ''

  const relativePath = (filePath: string): string => rootPrefix && filePath.startsWith(rootPrefix) ? filePath.slice(rootPrefix.length) : filePath

  for (const file of files) {
    const rel = relativePath(file.path)
    if (isRequestPath(rel)) {
      const dir = path.posix.dirname(rel)
      const folder = dir === '.' ? '' : dir
      folderDirs.add(folder)
      for (let parent = folder; parent; parent = path.posix.dirname(parent) === '.' ? '' : path.posix.dirname(parent)) folderDirs.add(parent)
      const rows = requestFiles.get(folder) ?? []
      rows.push(file)
      requestFiles.set(folder, rows)
      continue
    }
    if (!isDefinitionPath(rel) || rel === '.resources/definition.yaml' || rel === '.resources/definition.yml') continue
    const folder = path.posix.dirname(path.posix.dirname(rel))
    folderDirs.add(folder)
    for (let parent = folder; parent; parent = path.posix.dirname(parent) === '.' ? '' : path.posix.dirname(parent)) folderDirs.add(parent)
    if (file.doc && isObj(file.doc)) folderDefs.set(folder, { path: file.path, raw: file.doc })
  }

  const childDirs = new Map<string, string[]>()
  for (const folder of folderDirs) {
    if (!folder) continue
    const parent = path.posix.dirname(folder)
    const parentKey = parent === '.' ? '' : parent
    const children = childDirs.get(parentKey) ?? []
    children.push(folder)
    childDirs.set(parentKey, children)
  }

  const convertDir = (folder: string, depth: number): { requests: ExportRequest[]; folders: ExportFolder[] } | ExportFolder => {
    if (folder) ctx.budget.take(depth)
    const def = folder ? folderDefs.get(folder) : undefined
    const raw = def?.raw ?? (folder ? {} : rootDoc)
    const filePath = def?.path ?? (rootPath ? `${rootPath}/.resources/definition.yaml` : '.resources/definition.yaml')

    if (folder) {
      addUnknownKeys(ctx, filePath, raw, FOLDER_KEYS)
      if (list(raw.scripts).length > 0) ctx.folderScriptScopes++
      addScopeVariables(ctx, raw.variables, 'folder')
    } else {
      addUnknownKeys(ctx, filePath, raw, COLLECTION_KEYS)
      if (list(raw.scripts).length > 0) ctx.collectionScriptScopes++
      addScopeVariables(ctx, raw.variables, 'collection')
    }

    const requests = (requestFiles.get(folder) ?? [])
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path))
      .flatMap((file) => {
        ctx.budget.take(depth)
        if (!file.doc || !isObj(file.doc)) return []
        const requestName = str(file.doc.name) || stemOfRequest(file.path)
        const kind = str(file.doc.$kind)
        if (kind === 'http-request') return [convertHttpRequest(file.doc, requestName, file.path, ctx)]
        if (kind === 'graphql-request') return [convertGraphqlRequest(file.doc, requestName, file.path, ctx)]
        ctx.nonHttpKinds.set(kind || 'unknown', (ctx.nonHttpKinds.get(kind || 'unknown') ?? 0) + 1)
        return []
      })

    const folders = (childDirs.get(folder) ?? [])
      .slice()
      .sort((a, b) => a.localeCompare(b))
      .map((child) => convertDir(child, depth + 1) as ExportFolder)

    if (!folder) return { requests, folders }
    return {
      name: str(raw.name) || path.posix.basename(folder),
      description: textValue(raw.description),
      auth: convertAuth(raw.auth, `Folder "${str(raw.name) || path.posix.basename(folder)}"`, ctx.warnings),
      ssl: 'inherit',
      requests,
      folders,
    }
  }

  return convertDir('', 0) as { requests: ExportRequest[]; folders: ExportFolder[] }
}

function convertFolderCollection(rootPath: string, allFiles: ParsedFile[], environmentFiles: number, budget: ImportBudget): { collection: ExportCollection; warnings: string[] } | null {
  const rootPrefix = rootPath ? `${rootPath}/` : ''
  const files = allFiles.filter((file) => file.path === rootPath || file.path.startsWith(rootPrefix) || (!rootPath && !/^postman\//.test(file.path)))
  const rootYaml = rootPath ? `${rootPath}/.resources/definition.yaml` : '.resources/definition.yaml'
  const rootYml = rootPath ? `${rootPath}/.resources/definition.yml` : '.resources/definition.yml'
  const rootDef = files.find((file) => file.path === rootYaml || file.path === rootYml)
  const rootDoc = rootDef?.doc && isObj(rootDef.doc) ? rootDef.doc : {}

  const ctx: ConvertContext = {
    warnings: files.filter((file) => file.error).map((file) => `${warningLabel(file.path)}: ${file.error}`),
    variables: new Map<string, { value: string; isSecret: boolean }>(),
    pathVariables: new Map<string, string>(),
    dynamic: new Set<string>(),
    budget,
    collapsedFolderVariables: 0,
    collectionScriptScopes: 0,
    folderScriptScopes: 0,
    requestExamples: 0,
    requestsWithExamples: 0,
    environmentFiles,
    nonHttpKinds: new Map<string, number>(),
    unknownByFile: new Map<string, Set<string>>(),
  }

  const collectionName = str(rootDoc.name) || folderNameFromPath(rootPath)
  const tree = buildFolderTree(rootPath, files, rootDoc, ctx)
  const rootAuth = convertAuth(rootDoc.auth, 'Collection', ctx.warnings)
  for (const [name, value] of ctx.pathVariables) if (!ctx.variables.has(name)) ctx.variables.set(name, { value, isSecret: false })

  const collection: ExportCollection = {
    name: collectionName,
    description: textValue(rootDoc.description),
    source: 'local',
    auth: rootAuth.type === 'inherit' ? { ...NO_AUTH } : rootAuth,
    ssl: 'inherit',
    variables: [...ctx.variables].map(([key, value]) => ({ key, value: value.isSecret ? '' : value.value, isSecret: value.isSecret })),
    requests: tree.requests,
    folders: tree.folders,
  }

  return { collection, warnings: pushSharedWarnings(collection, ctx, countResourceExamples(allFiles, rootPath)) }
}

function convertCollectionItems(items: unknown, ctx: ConvertContext, depth: number): { requests: ExportRequest[]; folders: ExportFolder[] } {
  const requests: ExportRequest[] = []
  const folders: ExportFolder[] = []
  for (const item of list(items)) {
    ctx.budget.take(depth)
    const kind = str(item.$kind)
    if (kind === 'collection' || kind === 'folder') {
      addUnknownKeys(ctx, '(inline folder)', item, FOLDER_KEYS)
      if (list(item.scripts).length > 0) ctx.folderScriptScopes++
      addScopeVariables(ctx, item.variables, 'folder')
      const inner = convertCollectionItems(item.items, ctx, depth + 1)
      folders.push({
        name: str(item.name) || 'Folder',
        description: textValue(item.description),
        auth: convertAuth(item.auth, `Folder "${str(item.name) || 'Folder'}"`, ctx.warnings),
        ssl: 'inherit',
        requests: inner.requests,
        folders: inner.folders,
      })
      continue
    }
    if (kind === 'http-request') {
      requests.push(convertHttpRequest(item, str(item.name) || 'Request', '(inline request)', ctx))
      continue
    }
    if (kind === 'graphql-request') {
      requests.push(convertGraphqlRequest(item, str(item.name) || 'Request', '(inline request)', ctx))
      continue
    }
    ctx.nonHttpKinds.set(kind || 'unknown', (ctx.nonHttpKinds.get(kind || 'unknown') ?? 0) + 1)
  }
  return { requests, folders }
}

function convertSingleFileCollection(file: ParsedFile, budget: ImportBudget): { collection: ExportCollection; warnings: string[] } | null {
  if (!file.doc || !isObj(file.doc)) return null
  const doc = file.doc
  const ctx: ConvertContext = {
    warnings: file.error ? [`${warningLabel(file.path)}: ${file.error}`] : [],
    variables: new Map<string, { value: string; isSecret: boolean }>(),
    pathVariables: new Map<string, string>(),
    dynamic: new Set<string>(),
    budget,
    collapsedFolderVariables: 0,
    collectionScriptScopes: 0,
    folderScriptScopes: 0,
    requestExamples: 0,
    requestsWithExamples: 0,
    environmentFiles: 0,
    nonHttpKinds: new Map<string, number>(),
    unknownByFile: new Map<string, Set<string>>(),
  }

  addUnknownKeys(ctx, file.path, doc, COLLECTION_KEYS)
  if (list(doc.scripts).length > 0) ctx.collectionScriptScopes++
  addScopeVariables(ctx, doc.variables, 'collection')
  const tree = convertCollectionItems(doc.items, ctx, 0)
  for (const [name, value] of ctx.pathVariables) if (!ctx.variables.has(name)) ctx.variables.set(name, { value, isSecret: false })
  const rootAuth = convertAuth(doc.auth, 'Collection', ctx.warnings)
  const collection: ExportCollection = {
    name: str(doc.name) || 'Imported Postman v3 collection',
    description: textValue(doc.description),
    source: 'local',
    auth: rootAuth.type === 'inherit' ? { ...NO_AUTH } : rootAuth,
    ssl: 'inherit',
    variables: [...ctx.variables].map(([key, value]) => ({ key, value: value.isSecret ? '' : value.value, isSecret: value.isSecret })),
    requests: tree.requests,
    folders: tree.folders,
  }
  return { collection, warnings: pushSharedWarnings(collection, ctx, { examples: 0, requests: 0 }) }
}

function parseFiles(files: PostmanV3File[]): ParsedFile[] {
  return files.map((file) => {
    const normalized: ParsedFile = { path: normalizePath(file.path), text: file.text }
    if (!isYamlPath(normalized.path)) return normalized
    try {
      normalized.doc = parseYaml(normalized.text)
    } catch (error) {
      normalized.error = (error as Error).message
    }
    return normalized
  })
}

function topCollectionRoots(paths: string[]): string[] {
  const roots = new Set<string>()
  for (const filePath of paths) {
    const workspace = /^(postman\/collections\/[^/]+|collections\/[^/]+)(?:\/|$)/.exec(filePath)
    if (workspace) {
      roots.add(workspace[1])
      continue
    }
    if (filePath === '.resources/definition.yaml' || filePath === '.resources/definition.yml') roots.add('')
  }
  if (roots.size > 0) return [...roots].sort()
  if (paths.some((p) => !p.includes('/') && isRequestPath(p))) return ['']
  const topLevel = new Set<string>()
  for (const filePath of paths) {
    if (!isRequestPath(filePath) && !isDefinitionPath(filePath)) continue
    const parts = filePath.split('/')
    if (parts[0] === '.resources') continue
    topLevel.add(parts[0])
  }
  return [...topLevel].sort()
}

function environmentFileCount(files: ParsedFile[]): number {
  const hasWorkspaceRoot = files.some((file) => /^(postman\/collections\/|collections\/|postman\/environments\/|environments\/)/.test(file.path))
  return files.filter((file) => hasWorkspaceRoot
    ? /^(postman\/environments\/|environments\/).+\.ya?ml$/i.test(file.path)
    : /^postman\/environments\/.+\.ya?ml$/i.test(file.path)).length
}

export function isPostmanV3Folder(files: PostmanV3File[]): boolean {
  const parsed = parseFiles(files)
  if (parsed.length === 1 && parsed[0].doc && isObj(parsed[0].doc) && parsed[0].doc.$kind === 'collection') return true
  if (parsed.some((file) => isDefinitionPath(file.path) && file.doc && isObj(file.doc) && file.doc.$kind === 'collection')) return true
  const hasWorkspacePaths = parsed.some((file) => /^(postman\/collections\/|collections\/)/.test(file.path))
  return hasWorkspacePaths && parsed.some((file) => isRequestPath(file.path) || isDefinitionPath(file.path) || isExamplePath(file.path))
}

export function convertPostmanV3Files(files: PostmanV3File[]): Array<{ collection: ExportCollection; warnings: string[] }> {
  const parsed = parseFiles(files)
  const budget = new ImportBudget()
  if (parsed.length === 1 && parsed[0].doc && isObj(parsed[0].doc) && parsed[0].doc.$kind === 'collection') {
    const single = convertSingleFileCollection(parsed[0], budget)
    return single ? [single] : []
  }

  const envFiles = environmentFileCount(parsed)
  const roots = topCollectionRoots(parsed.map((file) => file.path).filter((filePath) => filePath && !/^postman\/environments\//.test(filePath) && !/^environments\//.test(filePath)))
  const entries = roots.map((root) => convertFolderCollection(root, parsed, envFiles, budget)).filter((entry): entry is { collection: ExportCollection; warnings: string[] } => entry !== null)
  return entries
}
