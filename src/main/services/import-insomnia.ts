import { DYNAMIC_VARIABLES } from '../../shared/variables'
import type { ExportCollection, ExportFolder, ExportRequest } from '../ipc/export-import'
import { isObj, kv, list, parseQuery, splitUrl, str, type Auth, type Obj } from './import-util'

// Insomnia export format 3/4 (JSON or YAML, a flat `resources` list) and the v5 YAML format
// (`*.insomnia.rest/5.0`, a nested tree).

export interface InsomniaEntry {
  collection: ExportCollection
  warnings: string[]
  /** OpenAPI text of a design document that has no requests of its own. */
  spec?: string
}

export interface InsomniaImport {
  collections: InsomniaEntry[]
}

export type InsomniaKind = 'export' | 'collection' | 'design' | 'environment' | 'unsupported'

const NO_AUTH: Auth = { type: 'none', config: {} }
const INHERIT: Auth = { type: 'inherit', config: {} }
const SUPPORTED_DYNAMIC = new Set(DYNAMIC_VARIABLES.map((v) => v.name))

export function insomniaKind(doc: unknown): InsomniaKind | null {
  if (!isObj(doc)) return null
  if (doc._type === 'export' && Array.isArray(doc.resources)) return 'export'
  const type = str(doc.type)
  if (/^collection\.insomnia\.rest\/5/.test(type)) return 'collection'
  if (/^spec\.insomnia\.rest\/5/.test(type)) return 'design'
  if (/^environment\.insomnia\.rest\/5/.test(type)) return 'environment'
  if (/\.insomnia(\.rest)?\/5/.test(type)) return 'unsupported'
  return null
}

// ─── Template syntax ─────────────────────────────────────────────────────────

/** Insomnia references variables as `{{ _.name }}`; Postly uses `{{name}}`. */
function template(value: unknown, unconverted: Set<string>): string {
  let out = str(value)
  if (!out.includes('{')) return out
  out = out
    .replace(/\{\{\s*_\.([A-Za-z_][\w.-]*)\s*\}\}/g, '{{$1}}')
    .replace(/\{\{\s*_\[\s*(['"])(.+?)\1\s*\]\s*\}\}/g, '{{$2}}')
    .replace(/\{\{\s*(\$?[\w.-]+)\s*\}\}/g, '{{$1}}')
    .replace(/\{%\s*uuid\s+(['"])v4\1\s*%\}/g, '{{$guid}}')
    .replace(/\{%\s*now\s+(['"])iso-8601\1[^%]*%\}/g, '{{$isoTimestamp}}')
    .replace(/\{%\s*now\s+(['"])unix\1[^%]*%\}/g, '{{$timestamp}}')
  for (const m of out.matchAll(/\{%[\s\S]*?%\}/g)) unconverted.add(m[0].length > 60 ? `${m[0].slice(0, 57)}…` : m[0])
  for (const m of out.matchAll(/\{\{([^}]*)\}\}/g)) {
    const inner = m[1].trim()
    if (/^[\w.-]+$/.test(inner) || (inner.startsWith('$') && SUPPORTED_DYNAMIC.has(inner))) continue
    unconverted.add(m[0])
  }
  return out
}

// ─── Auth ────────────────────────────────────────────────────────────────────

const GRANTS = new Set(['authorization_code', 'client_credentials', 'password', 'implicit'])

function convertAuth(auth: unknown, label: string, warnings: string[], t: (v: unknown) => string): Auth {
  if (!isObj(auth) || !auth.type) return { ...INHERIT }
  if (auth.disabled === true || auth.type === 'none') return { ...NO_AUTH }
  switch (auth.type) {
    case 'bearer':
      if (str(auth.prefix) && str(auth.prefix) !== 'Bearer') warnings.push(`${label}: the custom token prefix "${str(auth.prefix)}" was not mapped; Postly sends "Bearer".`)
      return { type: 'bearer', config: { token: t(auth.token) } }
    case 'basic':
      return { type: 'basic', config: { username: t(auth.username), password: t(auth.password) } }
    case 'digest':
      return { type: 'digest', config: { username: t(auth.username), password: t(auth.password) } }
    case 'ntlm':
      return { type: 'ntlm', config: { username: t(auth.username), password: t(auth.password), domain: t(auth.domain), workstation: t(auth.workstation) } }
    case 'apikey':
      return { type: 'apikey', config: { key: t(auth.key), value: t(auth.value), in: auth.addTo === 'queryParams' ? 'query' : 'header' } }
    case 'iam':
    case 'awsiam':
      return { type: 'awsv4', config: { accessKey: t(auth.accessKeyId), secretKey: t(auth.secretAccessKey), sessionToken: t(auth.sessionToken), region: t(auth.region), service: t(auth.service) } }
    case 'oauth2': {
      const grant = str(auth.grantType) || 'authorization_code'
      if (!GRANTS.has(grant)) {
        warnings.push(`${label}: OAuth 2.0 grant type "${grant}" is not supported; configure authentication manually.`)
        return { ...NO_AUTH }
      }
      if (grant === 'password') warnings.push(`${label}: the username and password of the OAuth 2.0 password grant were not mapped.`)
      return {
        type: 'oauth2',
        config: {
          grantType: grant,
          clientId: t(auth.clientId),
          clientSecret: t(auth.clientSecret),
          authUrl: t(auth.authorizationUrl),
          tokenUrl: t(auth.accessTokenUrl),
          scopes: t(auth.scope),
          redirectUri: t(auth.redirectUrl),
        },
      }
    }
    default:
      warnings.push(`${label}: "${str(auth.type)}" authentication is not supported; configure it manually.`)
      return { ...NO_AUTH }
  }
}

// ─── Bodies ──────────────────────────────────────────────────────────────────

function convertBody(body: unknown, label: string, warnings: string[], t: (v: unknown) => string): { bodyType: string; bodyContent: string; contentType?: string } {
  if (!isObj(body)) return { bodyType: 'none', bodyContent: '' }
  const mime = str(body.mimeType).split(';')[0].trim().toLowerCase()
  const content = t(body.text)
  if (mime === 'application/x-www-form-urlencoded') {
    return { bodyType: 'x-www-form-urlencoded', bodyContent: JSON.stringify(list(body.params).map((p) => kv(t(p.name), t(p.value), p.disabled !== true))) }
  }
  if (mime === 'multipart/form-data') {
    return {
      bodyType: 'form-data',
      bodyContent: JSON.stringify(list(body.params).map((p) => {
        const file = p.type === 'file'
        return { ...kv(t(p.name), file ? str(p.fileName) : t(p.value), p.disabled !== true), ...(file ? { fieldType: 'file' } : {}) }
      })),
    }
  }
  if (mime === 'application/graphql') {
    try {
      const parsed = JSON.parse(str(body.text)) as Obj
      const variables = parsed.variables === undefined ? '' : typeof parsed.variables === 'string' ? parsed.variables : JSON.stringify(parsed.variables, null, 2)
      return { bodyType: 'graphql', bodyContent: JSON.stringify({ query: t(parsed.query), variables: t(variables) }) }
    } catch {
      return { bodyType: 'graphql', bodyContent: JSON.stringify({ query: content, variables: '' }) }
    }
  }
  if (mime === 'application/octet-stream' || (!body.text && body.fileName)) {
    warnings.push(`${label}: the file for the binary body was not imported; pick it again in the Body tab.`)
    return { bodyType: 'binary', bodyContent: '' }
  }
  if (!content && !mime) return { bodyType: 'none', bodyContent: '' }
  if (mime === 'application/json' || mime.endsWith('+json')) return { bodyType: 'raw-json', bodyContent: content }
  if (mime === 'application/xml' || mime === 'text/xml' || mime.endsWith('+xml')) return { bodyType: 'raw-xml', bodyContent: content }
  if (mime === 'text/html') return { bodyType: 'raw-html', bodyContent: content }
  if (mime === 'application/javascript' || mime === 'text/javascript') return { bodyType: 'raw-javascript', bodyContent: content }
  const plain = !mime || mime === 'text/plain'
  return { bodyType: 'raw-text', bodyContent: content, ...(plain ? {} : { contentType: mime }) }
}

// ─── Tree ────────────────────────────────────────────────────────────────────

interface Node {
  raw: Obj
  children: Node[]
  isFolder: boolean
  sortKey: number
}

const sortKeyOf = (raw: Obj): number => {
  const meta = isObj(raw.meta) ? raw.meta : {}
  const key = typeof raw.metaSortKey === 'number' ? raw.metaSortKey : typeof meta.sortKey === 'number' ? meta.sortKey : 0
  return key
}
const descriptionOf = (raw: Obj): string => str(raw.description) || (isObj(raw.meta) ? str(raw.meta.description) : '')

/** Flattens nested environment data to dotted keys, because Insomnia reaches into objects with `_.a.b`. */
function flatten(data: unknown, prefix = '', out: Array<[string, string]> = []): Array<[string, string]> {
  if (!isObj(data)) return out
  for (const [key, value] of Object.entries(data)) {
    const name = prefix ? `${prefix}.${key}` : key
    if (isObj(value)) flatten(value, name, out)
    else out.push([name, Array.isArray(value) ? JSON.stringify(value) : str(value)])
  }
  return out
}

const NON_HTTP: Record<string, string> = {
  grpc_request: 'gRPC request',
  websocket_request: 'WebSocket request',
  socketio_request: 'Socket.IO request',
  mock_route: 'mock route',
  mock_server: 'mock server',
}

function convertTree(name: string, description: string, roots: Node[], baseEnv: Obj | undefined, subEnvironments: number, extraWarnings: string[], hasCookies: boolean, tests: number, hasSpec: boolean): { collection: ExportCollection; warnings: string[] } {
  const warnings = [...extraWarnings]
  const variables = new Map<string, string>()
  const pathVariables = new Map<string, string>()
  const scripted: string[] = []
  const unconverted = new Set<string>()
  const t = (v: unknown) => template(v, unconverted)
  const addVariables = (data: unknown) => {
    for (const [key, value] of flatten(data)) if (!variables.has(key)) variables.set(key, t(value))
  }
  addVariables(baseEnv?.data)

  function convertRequest(raw: Obj): ExportRequest {
    const method = (str(raw.method) || 'GET').toUpperCase()
    const url = t(raw.url)
    const label = `"${str(raw.name) || `${method} ${url}`}"`
    const unconvertedBefore = unconverted.size

    const declared = list(raw.pathParameters)
    const split = splitUrl(url, pathVariables, declared)
    const params = [...list(raw.parameters).filter((p) => str(p.name)).map((p) => kv(t(p.name), t(p.value), p.disabled !== true)), ...(split.query ? parseQuery(split.query) : [])]
    const headers = list(raw.headers).filter((h) => str(h.name)).map((h) => kv(t(h.name), t(h.value), h.disabled !== true))

    const body = convertBody(raw.body, label, warnings, t)
    if (body.contentType && !headers.some((h) => h.key.toLowerCase() === 'content-type')) headers.push(kv('Content-Type', body.contentType, true))
    const auth = convertAuth(raw.authentication, label, warnings, t)

    const scripts = isObj(raw.scripts) ? raw.scripts : {}
    const legacy = [raw.preRequestScript, raw.afterResponseScript]
    if ([scripts.preRequest, scripts.afterResponse, ...legacy].some((s) => str(s).trim())) scripted.push(label)
    if (unconverted.size > unconvertedBefore) {
      warnings.push(`${label}: uses Insomnia template tags that were left as text (${[...unconverted].slice(unconvertedBefore).slice(0, 2).join(', ')}).`)
    }

    return {
      name: str(raw.name) || `${method} ${url}`,
      method,
      url: split.url,
      protocol: 'http',
      params,
      headers,
      bodyType: body.bodyType,
      bodyContent: body.bodyContent,
      auth,
      ssl: 'inherit',
      description: descriptionOf(raw),
      protocolConfig: {},
    }
  }

  function convertNodes(nodes: Node[]): { requests: ExportRequest[]; folders: ExportFolder[] } {
    const requests: ExportRequest[] = []
    const folders: ExportFolder[] = []
    for (const node of [...nodes].sort((a, b) => a.sortKey - b.sortKey)) {
      const raw = node.raw
      if (node.isFolder) {
        const folderName = str(raw.name) || 'Folder'
        const label = `Folder "${folderName}"`
        if (list(raw.headers).some((h) => str(h.name))) warnings.push(`${label}: its headers were not imported; add them to each request.`)
        const scripts = isObj(raw.scripts) ? raw.scripts : {}
        if ([scripts.preRequest, scripts.afterResponse].some((s) => str(s).trim())) scripted.push(label)
        if (isObj(raw.environment) && flatten(raw.environment).length > 0) {
          addVariables(raw.environment)
          warnings.push(`${label}: its environment variables were added to the collection variables.`)
        }
        folders.push({
          name: folderName,
          description: descriptionOf(raw),
          auth: convertAuth(raw.authentication, label, warnings, t),
          ssl: 'inherit',
          ...convertNodes(node.children),
        })
      } else if (str(raw._type) in NON_HTTP) {
        warnings.push(`"${str(raw.name)}": ${NON_HTTP[str(raw._type)]}s are not imported.`)
      } else if (raw.protoMethodName !== undefined || raw.protoFileId !== undefined) {
        warnings.push(`"${str(raw.name)}": gRPC requests are not imported.`)
      } else {
        requests.push(convertRequest(raw))
      }
    }
    return { requests, folders }
  }

  const { requests, folders } = convertNodes(roots)
  if (requests.length === 0 && folders.length === 0 && !hasSpec) warnings.push('The workspace has no requests.')
  if (scripted.length > 0) {
    const sample = scripted.slice(0, 3).join(', ')
    warnings.push(`Scripts were not imported for ${scripted.length} item${scripted.length === 1 ? '' : 's'} (${sample}${scripted.length > 3 ? ', …' : ''}).`)
  }
  if (subEnvironments > 0) warnings.push(`${subEnvironments} sub-environment${subEnvironments === 1 ? ' was' : 's were'} not imported (for example Dev or Production); only the base environment became collection variables.`)
  if (hasCookies) warnings.push('The cookie jar was not imported.')
  if (tests > 0) warnings.push(`${tests} unit test${tests === 1 ? '' : 's'} were not imported.`)
  for (const [key, value] of pathVariables) if (!variables.has(key)) variables.set(key, value)

  return {
    collection: {
      name: name || 'Imported Insomnia collection',
      description,
      source: 'local',
      auth: { ...NO_AUTH },
      ssl: 'inherit',
      variables: [...variables].map(([key, value]) => ({ key, value, isSecret: false })),
      requests,
      folders,
    },
    warnings,
  }
}

// ─── v3 / v4 ─────────────────────────────────────────────────────────────────

function convertExport(doc: Obj): InsomniaImport {
  const format = Number(doc.__export_format)
  if (format !== 3 && format !== 4) {
    throw new Error(`Insomnia export format ${str(doc.__export_format) || '(unknown)'} is not supported. Export again from a current Insomnia (Insomnia v4 JSON or YAML).`)
  }
  const resources = list(doc.resources)
  const byParent = new Map<string, Obj[]>()
  for (const r of resources) {
    const parent = str(r.parentId)
    byParent.set(parent, [...(byParent.get(parent) ?? []), r])
  }
  const nodesOf = (parentId: string): Node[] =>
    (byParent.get(parentId) ?? [])
      .filter((r) => r._type === 'request' || r._type === 'request_group' || str(r._type) in NON_HTTP)
      .map((raw) => ({ raw, isFolder: raw._type === 'request_group', children: raw._type === 'request_group' ? nodesOf(str(raw._id)) : [], sortKey: sortKeyOf(raw) }))

  const workspaces = resources.filter((r) => r._type === 'workspace')
  const collections = workspaces.map((ws) => {
    const id = str(ws._id)
    const children = byParent.get(id) ?? []
    const env = children.find((r) => r._type === 'environment')
    const subEnvs = env ? (byParent.get(str(env._id)) ?? []).filter((r) => r._type === 'environment').length : 0
    const hasCookies = children.some((r) => r._type === 'cookie_jar' && list(r.cookies).length > 0)
    const suites = children.filter((r) => r._type === 'unit_test_suite')
    const tests = suites.reduce((n, s) => n + (byParent.get(str(s._id)) ?? []).filter((r) => r._type === 'unit_test').length, 0)
    const roots = nodesOf(id)
    const spec = children.find((r) => r._type === 'api_spec')
    const result = convertTree(str(ws.name), descriptionOf(ws), roots, env, subEnvs, [], hasCookies, tests, roots.length === 0 && !!spec && !!str(spec.contents))
    const contents = roots.length === 0 && spec ? str(spec.contents) : ''
    return { ...result, ...(contents ? { spec: contents } : {}) }
  })
  if (collections.length === 0) throw new Error('The Insomnia export contains no workspaces.')
  return { collections }
}

// ─── v5 ──────────────────────────────────────────────────────────────────────

function convertV5(doc: Obj, kind: InsomniaKind): InsomniaImport {
  const nodesOf = (items: unknown): Node[] =>
    list(items).map((raw) => ({
      raw,
      isFolder: Array.isArray(raw.children),
      children: Array.isArray(raw.children) ? nodesOf(raw.children) : [],
      sortKey: sortKeyOf(raw),
    }))
  const roots = nodesOf(doc.collection)
  const env = isObj(doc.environments) ? doc.environments : undefined
  const subEnvs = env && Array.isArray(env.subEnvironments) ? env.subEnvironments.length : 0
  const hasCookies = isObj(doc.cookieJar) && Array.isArray(doc.cookieJar.cookies) && doc.cookieJar.cookies.length > 0
  const tests = Array.isArray(doc.testSuites) ? doc.testSuites.reduce((n, s) => n + (isObj(s) && Array.isArray(s.tests) ? s.tests.length : 0), 0) : 0
  const specContents = isObj(doc.spec) ? doc.spec.contents : undefined
  const result = convertTree(str(doc.name), isObj(doc.meta) ? str(doc.meta.description) : '', roots, env, subEnvs, [], hasCookies, tests, kind === 'design' && roots.length === 0 && specContents !== undefined)
  const spec = kind === 'design' && roots.length === 0 && specContents !== undefined ? (typeof specContents === 'string' ? specContents : JSON.stringify(specContents)) : ''
  return { collections: [{ ...result, ...(spec ? { spec } : {}) }] }
}

export function convertInsomnia(doc: Obj, kind: InsomniaKind): InsomniaImport {
  if (kind === 'export') return convertExport(doc)
  return convertV5(doc, kind)
}
