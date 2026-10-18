import crypto from 'crypto'
import type { ExportCollection, ExportEnvironment, ExportFolder, ExportRequest } from '../ipc/export-import'
import type { VariableRow } from './variable-store'

type Obj = Record<string, unknown>
type Auth = { type: string; config: Record<string, unknown> }

export interface ImportResult {
  collection: ExportCollection
  warnings: string[]
}

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']
const NO_AUTH: Auth = { type: 'none', config: {} }

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const ABSOLUTE_URL = /^[a-z][a-z0-9+.-]*:\/\//i

export function isOpenApiDocument(doc: unknown): boolean {
  return isObj(doc) && (typeof doc.openapi === 'string' || typeof doc.swagger === 'string') && isObj(doc.paths)
}

/** A representative value for a schema: explicit example, default, first enum value, or a typed placeholder. */
export function sampleValue(schema: unknown, depth = 0): unknown {
  if (!isObj(schema) || depth > 5) return null
  if (schema.example !== undefined) return schema.example
  if (Array.isArray(schema.examples) && schema.examples.length > 0) return schema.examples[0]
  if (schema.default !== undefined) return schema.default
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0]
  const composed = (schema.allOf ?? schema.oneOf ?? schema.anyOf) as unknown
  if (Array.isArray(composed) && composed.length > 0) {
    if (schema.allOf) {
      return Object.assign({}, ...composed.map((s) => { const v = sampleValue(s, depth + 1); return isObj(v) ? v : {} }))
    }
    return sampleValue(composed[0], depth + 1)
  }
  // OpenAPI 3.1 allows type: [string, 'null']
  const declared = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type
  const type = declared ?? (schema.properties ? 'object' : undefined)
  switch (type) {
    case 'object': {
      const out: Obj = {}
      for (const [key, value] of Object.entries(isObj(schema.properties) ? schema.properties : {})) {
        if (isObj(value) && value.readOnly === true) continue
        out[key] = sampleValue(value, depth + 1)
      }
      return out
    }
    case 'array': return [sampleValue(schema.items, depth + 1)]
    case 'integer':
    case 'number': return 0
    case 'boolean': return false
    case 'string': return schema.format === 'date-time' ? '2024-01-01T00:00:00Z' : schema.format === 'date' ? '2024-01-01' : 'string'
    default: return null
  }
}

function firstExample(media: Obj): unknown {
  if (media.example !== undefined) return media.example
  if (isObj(media.examples)) {
    const first = Object.values(media.examples).find(isObj)
    if (first && first.value !== undefined) return first.value
  }
  return sampleValue(media.schema)
}

const kv = (key: string, value: unknown, enabled: boolean) => ({
  id: crypto.randomUUID(),
  key,
  value: value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value),
  enabled,
})

function serverUrl(server: Obj): string {
  const variables = isObj(server.variables) ? server.variables : {}
  return str(server.url).replace(/\{([^}]+)\}/g, (match, name: string) => {
    const variable = variables[name]
    return isObj(variable) && variable.default !== undefined ? String(variable.default) : match
  })
}

/** A server variable called baseUrl would overwrite the URL variable of the same environment, so it is renamed. */
const serverVariableKey = (name: string) => (name === 'baseUrl' ? 'serverBaseUrl' : name)

function serverTemplateUrl(server: Obj): string {
  return str(server.url).replace(/\{([^}]+)\}/g, (_match, name: string) => `{{${serverVariableKey(name)}}}`)
}

/** Same treatment as the collection baseUrl: relative URLs resolve against the source, trailing slashes go. */
function normalizeBaseUrl(value: string, sourceUrl?: string): string {
  let url = value
  if (url && !ABSOLUTE_URL.test(url) && sourceUrl) {
    const placeholders: string[] = []
    const safeUrl = url.replace(/\{\{[^}]+\}\}/g, (match) => {
      const token = `__POSTLY_TEMPLATE_${placeholders.length}__`
      placeholders.push(match)
      return token
    })
    try {
      url = new URL(safeUrl, sourceUrl).href
      placeholders.forEach((match, index) => {
        url = url.replaceAll(`__POSTLY_TEMPLATE_${index}__`, match)
      })
    } catch { /* kept as written */ }
  }
  if (url === '/') return ''
  return url.replace(/\/+$/, '')
}

function relativeServerWarning(value: string): string {
  return `The server URL "${value}" is relative; set {{baseUrl}} to the full address (for example https://host${value.startsWith('/') ? '' : '/'}${value}).`
}

function rootServers(doc: Obj, isV3: boolean): Obj[] {
  if (!isV3) return []
  const servers = (Array.isArray(doc.servers) ? doc.servers : []).filter(isObj)
  return servers.length > 0 ? servers : [{ url: '/' }]
}

function queryRowsFromString(query: string): Array<ReturnType<typeof kv>> {
  return query.split('&').filter(Boolean).map((pair) => {
    const eq = pair.indexOf('=')
    return kv(eq < 0 ? pair : pair.slice(0, eq), eq < 0 ? '' : pair.slice(eq + 1), true)
  })
}

function mergeQueryRows(serverQuery: string | null, operationQuery: Array<ReturnType<typeof kv>>): Array<ReturnType<typeof kv>> {
  if (!serverQuery) return operationQuery
  const overriddenKeys = new Set(operationQuery.map((row) => row.key))
  return [
    ...queryRowsFromString(serverQuery).filter((row) => !overriddenKeys.has(row.key)),
    ...operationQuery,
  ]
}

function resolvedServerUrl(rawUrl: string, sourceUrl?: string): { rawUrl: string; url: string; query: string | null } {
  const hash = rawUrl.indexOf('#')
  const withoutHash = hash >= 0 ? rawUrl.slice(0, hash) : rawUrl
  const queryIndex = withoutHash.indexOf('?')
  const url = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash
  return {
    rawUrl,
    url: normalizeBaseUrl(url, sourceUrl),
    query: queryIndex >= 0 ? withoutHash.slice(queryIndex + 1) : null,
  }
}

function resolvedServer(server: Obj | undefined, sourceUrl?: string): { rawUrl: string; url: string; query: string | null } {
  return resolvedServerUrl(server ? serverUrl(server) : '/', sourceUrl)
}

function requestUrl(base: string, path: string): string {
  if (!base || base === '/') return path
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`
}

function serverVariableValue(variable: unknown): string {
  if (!isObj(variable)) return ''
  if (variable.default !== undefined) return String(variable.default)
  if (Array.isArray(variable.enum) && variable.enum.length > 0) return String(variable.enum[0])
  return ''
}

function serverVariableRows(server: Obj): VariableRow[] {
  const variables = isObj(server.variables) ? server.variables : {}
  return Object.entries(variables)
    .map(([key, value]) => ({ key: serverVariableKey(key), value: serverVariableValue(value), isSecret: false }))
    .filter((row) => row.key)
}

function serverName(rawUrl: string, sourceUrl: string | undefined, fallback: string): string {
  try { return new URL(rawUrl, sourceUrl).host || fallback } catch { return fallback }
}

function openApiServerEnvironment(server: Obj, index: number, sourceUrl?: string): ExportEnvironment {
  const resolved = serverUrl(server)
  const fallback = str(server.url) || `server-${index + 1}`
  const description = str(server.description).trim()
  const name = description || serverName(resolved || str(server.url), sourceUrl, fallback)
  return {
    name,
    variables: [
      { key: 'baseUrl', value: resolvedServerUrl(serverTemplateUrl(server), sourceUrl).url, isSecret: false },
      ...serverVariableRows(server),
    ],
  }
}

function swaggerBaseUrl(host: string, basePath: string, scheme: string): string {
  return host ? `${scheme || 'https'}://${host}${basePath}` : basePath
}

function swaggerEnvironments(doc: Obj, sourceUrl?: string): ExportEnvironment[] {
  const host = str(doc.host)
  if (!host) return []
  const basePath = str(doc.basePath)
  const schemes = (Array.isArray(doc.schemes) ? doc.schemes : []).map(str).filter(Boolean)
  const urls = (schemes.length > 0 ? schemes : ['https']).map((scheme) => ({ scheme, url: swaggerBaseUrl(host, basePath, scheme) }))
  if (urls.length <= 1) return []
  return urls.map(({ scheme, url }) => ({
    name: `${host} (${scheme})`,
    variables: [{ key: 'baseUrl', value: normalizeBaseUrl(url, sourceUrl), isSecret: false }],
  }))
}

const GRANT_ORDER = ['authorization_code', 'client_credentials', 'password', 'implicit'] as const
type Grant = (typeof GRANT_ORDER)[number]

/** OAuth 2 flows by grant type, from either the OpenAPI 3 `flows` object or the single Swagger 2 `flow`. */
function oauthFlows(scheme: Obj): Partial<Record<Grant, Obj>> {
  const out: Partial<Record<Grant, Obj>> = {}
  if (isObj(scheme.flows)) {
    const f = scheme.flows
    if (isObj(f.authorizationCode)) out.authorization_code = f.authorizationCode
    if (isObj(f.clientCredentials)) out.client_credentials = f.clientCredentials
    if (isObj(f.password)) out.password = f.password
    if (isObj(f.implicit)) out.implicit = f.implicit
  } else {
    const grant: Record<string, Grant> = { accessCode: 'authorization_code', application: 'client_credentials', password: 'password', implicit: 'implicit' }
    const g = grant[str(scheme.flow)]
    if (g) out[g] = scheme
  }
  return out
}

function mapScheme(name: string, scheme: unknown, scopes: string[], warnings: string[]): Auth | null {
  if (!isObj(scheme)) return null
  const type = str(scheme.type).toLowerCase()
  const httpScheme = str(scheme.scheme).toLowerCase()
  if (type === 'http' && httpScheme === 'bearer') return { type: 'bearer', config: { token: '' } }
  if (type === 'http' && httpScheme === 'basic') return { type: 'basic', config: { username: '', password: '' } }
  if (type === 'basic') return { type: 'basic', config: { username: '', password: '' } }
  if (type === 'apikey') {
    if (scheme.in === 'header' || scheme.in === 'query') return { type: 'apikey', config: { key: str(scheme.name), value: '', in: scheme.in } }
    warnings.push(`Security scheme "${name}": API keys sent in cookies are not supported; set the Cookie header manually.`)
    return null
  }
  if (type === 'oauth2') {
    const flows = oauthFlows(scheme)
    const grant = GRANT_ORDER.find((g) => flows[g])
    if (!grant) {
      warnings.push(`Security scheme "${name}" (oauth2) defines no usable flow; configure authentication manually.`)
      return null
    }
    const flow = flows[grant] as Obj
    const unused = GRANT_ORDER.filter((g) => flows[g] && g !== grant)
    if (unused.length > 0) warnings.push(`Security scheme "${name}" offers several OAuth 2 flows; ${grant} was mapped (also available: ${unused.join(', ')}).`)
    const declared = isObj(flow.scopes) ? Object.keys(flow.scopes) : []
    return {
      type: 'oauth2',
      config: {
        grantType: grant,
        clientId: '',
        clientSecret: '',
        authUrl: str(flow.authorizationUrl),
        tokenUrl: str(flow.tokenUrl),
        scopes: (scopes.length > 0 ? scopes : declared).join(' '),
        redirectUri: '',
      },
    }
  }
  if (type === 'openidconnect') {
    warnings.push(`Security scheme "${name}" uses OpenID Connect discovery (${str(scheme.openIdConnectUrl)}); the endpoints are not fetched during import, so enter them in the OAuth 2.0 auth settings.`)
    return null
  }
  warnings.push(`Security scheme "${name}" (${type}${httpScheme ? ` ${httpScheme}` : ''}) is not mapped; configure authentication manually.`)
  return null
}

/** Query parameter rows following the declared style/explode; arrays and objects are never sent as JSON text. */
function queryRows(p: Obj, value: unknown): Array<ReturnType<typeof kv>> {
  const key = str(p.name)
  const enabled = p.required === true
  const explode = typeof p.explode === 'boolean' ? p.explode : p.style === undefined || p.style === 'form'
  if (Array.isArray(value)) {
    const sep = p.style === 'spaceDelimited' ? ' ' : p.style === 'pipeDelimited' ? '|' : ','
    if (explode && (p.style === undefined || p.style === 'form')) return value.map((v) => kv(key, v, enabled))
    return [kv(key, value.join(sep), enabled)]
  }
  if (isObj(value)) {
    if (p.style === 'deepObject') return Object.entries(value).map(([k, v]) => kv(`${key}[${k}]`, v, enabled))
    if (explode) return Object.entries(value).map(([k, v]) => kv(k, v, enabled))
    return [kv(key, Object.entries(value).flat().join(','), enabled)]
  }
  return [kv(key, value, enabled)]
}

// Per the OpenAPI spec these header parameters are defined elsewhere and must be ignored
const IGNORED_HEADERS = new Set(['accept', 'content-type', 'authorization'])

/** Remaining $refs after dereferencing are the ones that point outside the document. */
function externalRefs(node: unknown, found = new Set<string>(), seen = new Set<unknown>()): Set<string> {
  if (typeof node !== 'object' || node === null || seen.has(node)) return found
  seen.add(node)
  if (!Array.isArray(node) && typeof (node as Obj).$ref === 'string') found.add(String((node as Obj).$ref))
  for (const value of Object.values(node)) externalRefs(value, found, seen)
  return found
}

/** Converts an already dereferenced OpenAPI 3.x or Swagger 2 document into a Postly collection. */
export function convertOpenApi(doc: Obj, sourceUrl?: string): ImportResult {
  const warnings: string[] = []
  const isV3 = str(doc.openapi).startsWith('3')
  const info = isObj(doc.info) ? doc.info : {}
  const variables = new Map<string, string>()
  const environments: ExportEnvironment[] = []
  const v3RootServers = isV3 ? rootServers(doc, true) : []
  const rootServer = v3RootServers[0]
  const usesDefaultRootServer = isV3 && (!Array.isArray(doc.servers) || doc.servers.filter(isObj).length === 0)

  let baseUrl = ''
  if (isV3) {
    const servers = v3RootServers
    const root = resolvedServer(servers[0], sourceUrl)
    baseUrl = root.url
    if (servers.length > 1) environments.push(...servers.map((server, index) => openApiServerEnvironment(server, index, sourceUrl)))
    if (!usesDefaultRootServer && root.rawUrl && !ABSOLUTE_URL.test(root.rawUrl) && !sourceUrl) warnings.push(relativeServerWarning(root.rawUrl))
  } else {
    const host = str(doc.host)
    const schemes = Array.isArray(doc.schemes) ? doc.schemes : []
    const rawBaseUrl = swaggerBaseUrl(host, str(doc.basePath), str(schemes[0]) || 'https')
    baseUrl = normalizeBaseUrl(rawBaseUrl, sourceUrl)
    environments.push(...swaggerEnvironments(doc, sourceUrl))
    if (rawBaseUrl && !/^[a-z][a-z0-9+.-]*:\/\//i.test(rawBaseUrl) && !sourceUrl) warnings.push(relativeServerWarning(rawBaseUrl))
  }
  if (isV3 || baseUrl) variables.set('baseUrl', baseUrl)
  if (!baseUrl && (!isV3 || usesDefaultRootServer) && !sourceUrl) warnings.push('No server URL found; set {{baseUrl}} in the collection variables.')

  const schemes: Obj = isV3
    ? (isObj(doc.components) && isObj(doc.components.securitySchemes) ? doc.components.securitySchemes : {})
    : (isObj(doc.securityDefinitions) ? doc.securityDefinitions : {})
  const authCache = new Map<string, Auth | null>()
  const schemeAuth = (name: string, scopes: string[]): Auth | null => {
    const cacheKey = `${name}|${scopes.join(' ')}`
    if (!authCache.has(cacheKey)) authCache.set(cacheKey, mapScheme(name, schemes[name], scopes, warnings))
    return authCache.get(cacheKey) ?? null
  }
  const authFor = (security: unknown): Auth => {
    const requirement = Array.isArray(security) ? security.find((r) => isObj(r) && Object.keys(r).length > 0) : undefined
    if (!isObj(requirement)) return NO_AUTH
    const names = Object.keys(requirement)
    const mapped = names.map((n) => schemeAuth(n, Array.isArray(requirement[n]) ? (requirement[n] as unknown[]).map(String) : [])).find((a): a is Auth => a !== null)
    if (mapped && names.length > 1) warnings.push(`A security requirement combines ${names.join(' + ')}; only ${mapped.type} was mapped.`)
    return mapped ?? NO_AUTH
  }

  const collectionAuth = authFor(doc.security)
  const inheritedType = collectionAuth.type === 'none' ? 'none' : 'inherit'

  const folders = new Map<string, ExportFolder>()
  const rootRequests: ExportRequest[] = []
  const tagDescriptions = new Map<string, string>()
  for (const tag of Array.isArray(doc.tags) ? doc.tags : []) if (isObj(tag) && str(tag.name)) tagDescriptions.set(str(tag.name), str(tag.description))

  const paths = isObj(doc.paths) ? doc.paths : {}
  // Documents that do not use tags at all (Stripe, Kubernetes) are grouped by resource instead of one long flat list
  const usesTags = Object.values(paths).some((item) => isObj(item) && METHODS.some((m) => isObj(item[m]) && Array.isArray((item[m] as Obj).tags) && ((item[m] as Obj).tags as unknown[]).length > 0))
  const resourceOf = (path: string): string =>
    path.split('/').find((segment) => segment && !/^v\d+(\.\d+)*$/i.test(segment) && segment.toLowerCase() !== 'api' && !segment.startsWith('{')) ?? ''
  let count = 0
  for (const [path, rawItem] of Object.entries(paths)) {
    if (!isObj(rawItem)) continue
    const pathParams = Array.isArray(rawItem.parameters) ? rawItem.parameters.filter(isObj) : []
    for (const key of ['query', 'additionalOperations']) {
      if (isObj(rawItem[key]) && (key !== 'query' || Object.keys(rawItem[key] as Obj).length > 0)) {
        warnings.push(`${path}: the "${key}" operation${key === 'query' ? '' : 's'} (OpenAPI 3.2) ${key === 'query' ? 'is' : 'are'} not imported.`)
      }
    }
    for (const method of METHODS) {
      const op = rawItem[method]
      if (!isObj(op)) continue
      count++
      const label = `${method.toUpperCase()} ${path}`
      const operationServers = (Array.isArray(op.servers) ? op.servers : []).filter(isObj)
      const pathServers = (Array.isArray(rawItem.servers) ? rawItem.servers : []).filter(isObj)
      const effectiveServer = operationServers[0] ?? pathServers[0] ?? rootServer
      const resolvedEffectiveServer = resolvedServer(effectiveServer, sourceUrl)
      if (effectiveServer !== rootServer && resolvedEffectiveServer.rawUrl && !/^[a-z][a-z0-9+.-]*:\/\//i.test(resolvedEffectiveServer.rawUrl) && !sourceUrl) {
        warnings.push(`${label}: ${relativeServerWarning(resolvedEffectiveServer.rawUrl)}`)
      }

      const own = Array.isArray(op.parameters) ? op.parameters.filter(isObj) : []
      const merged = new Map<string, Obj>()
      for (const p of [...pathParams, ...own]) merged.set(`${str(p.in)}:${str(p.name)}`, p)
      const params: Obj[] = [...merged.values()]

      const query = params.filter((p) => p.in === 'query')
      const headers = params.filter((p) => p.in === 'header' && !IGNORED_HEADERS.has(str(p.name).toLowerCase()))
      if (params.some((p) => p.in === 'cookie')) warnings.push(`${label}: cookie parameters are not mapped; set them in the cookie jar or a Cookie header.`)
      // Only values the author supplied; invented placeholders would be sent as real data
      const paramValue = (p: Obj): unknown => {
        const source = isV3 && isObj(p.schema) ? p.schema : p
        if (p.example !== undefined) return p.example
        if (source.default !== undefined) return source.default
        return Array.isArray(source.enum) ? source.enum[0] : ''
      }

      const urlUsesRootServer = !isV3 || resolvedEffectiveServer.url === baseUrl
      let url = urlUsesRootServer && baseUrl ? requestUrl('{{baseUrl}}', path) : requestUrl(resolvedEffectiveServer.url, path)
      for (const p of params.filter((x) => x.in === 'path')) {
        const name = str(p.name)
        const value = paramValue(p)
        if (!variables.has(name)) variables.set(name, value === null || value === undefined ? '' : String(value))
        url = url.split(`{${name}}`).join(`{{${name}}}`)
      }

      let bodyType = 'none'
      let bodyContent = ''
      if (isV3) {
        const content = isObj(op.requestBody) && isObj(op.requestBody.content) ? op.requestBody.content : null
        if (content) {
          const types = Object.keys(content)
          const json = types.find((t) => /^application\/(.+\+)?json/.test(t))
          const form = types.find((t) => t === 'application/x-www-form-urlencoded')
          const multipart = types.find((t) => t === 'multipart/form-data')
          const xml = types.find((t) => /xml/.test(t))
          const text = types.find((t) => t.startsWith('text/'))
          const media = (t: string) => (isObj(content[t]) ? content[t] as Obj : {})
          if (json) {
            bodyType = 'raw-json'
            bodyContent = JSON.stringify(firstExample(media(json)), null, 2)
          } else if (form || multipart) {
            bodyType = form ? 'x-www-form-urlencoded' : 'form-data'
            const schema = media((form ?? multipart) as string).schema
            const props = isObj(schema) && isObj(schema.properties) ? schema.properties : {}
            const required = isObj(schema) && Array.isArray(schema.required) ? schema.required.map(String) : []
            // Optional fields stay listed but disabled so a send does not submit invented values
            bodyContent = JSON.stringify(Object.entries(props).map(([k, v]) => {
              const binary = isObj(v) && v.format === 'binary'
              const sample = binary ? '' : sampleValue(v)
              return {
                ...kv(k, typeof sample === 'object' ? '' : sample, required.includes(k)),
                ...(binary ? { fieldType: 'file' } : {}),
              }
            }))
          } else if (xml) {
            bodyType = 'raw-xml'
            const example = media(xml).example
            bodyContent = typeof example === 'string' ? example : ''
          } else if (text) {
            bodyType = 'raw-text'
            const example = media(text).example
            bodyContent = typeof example === 'string' ? example : ''
          } else if (types.length > 0) {
            bodyType = 'binary'
            warnings.push(`${label}: request body type ${types[0]} is mapped as a binary body.`)
          }
        }
      } else {
        const consumes = [...(Array.isArray(op.consumes) ? op.consumes : []), ...(Array.isArray(doc.consumes) ? doc.consumes : [])].map(String)
        const body = params.find((p) => p.in === 'body')
        const formData = params.filter((p) => p.in === 'formData')
        if (body) {
          bodyType = 'raw-json'
          bodyContent = JSON.stringify(body.example !== undefined ? body.example : sampleValue(body.schema), null, 2)
        } else if (formData.length > 0) {
          const urlencoded = consumes.includes('application/x-www-form-urlencoded') && !consumes.includes('multipart/form-data')
          bodyType = urlencoded ? 'x-www-form-urlencoded' : 'form-data'
          bodyContent = JSON.stringify(formData.map((p) => ({ ...kv(str(p.name), p.type === 'file' ? '' : paramValue(p), true), ...(p.type === 'file' ? { fieldType: 'file' } : {}) })))
        }
      }

      const hasSecurity = Array.isArray(op.security)
      const auth: Auth = hasSecurity ? authFor(op.security) : { type: inheritedType, config: {} }
      if (hasSecurity && (op.security as unknown[]).length === 0) auth.type = 'none'

      for (const unmapped of ['callbacks', 'links']) {
        if (isObj(op[unmapped]) && Object.keys(op[unmapped] as Obj).length > 0) warnings.push(`${label}: ${unmapped} are not imported.`)
      }

      const request: ExportRequest = {
        name: str(op.summary) || str(op.operationId) || label,
        method: method.toUpperCase(),
        url,
        protocol: 'http',
        params: mergeQueryRows(resolvedEffectiveServer.query, query.flatMap((p) => queryRows(p, paramValue(p)))),
        headers: headers.map((p) => kv(str(p.name), paramValue(p), p.required === true)),
        bodyType,
        bodyContent,
        auth,
        ssl: 'inherit',
        description: str(op.description) || str(op.summary),
        protocolConfig: {},
      }

      const tag = Array.isArray(op.tags) ? str(op.tags[0]) : usesTags ? '' : resourceOf(path)
      if (!tag) { rootRequests.push(request); continue }
      let folder = folders.get(tag)
      if (!folder) {
        folder = { name: tag, description: tagDescriptions.get(tag) ?? '', auth: { type: 'inherit', config: {} }, ssl: 'inherit', requests: [], folders: [] }
        folders.set(tag, folder)
      }
      folder.requests.push(request)
    }
  }

  const external = externalRefs(doc)
  if (external.size > 0) {
    const sample = [...external].slice(0, 3).join(', ')
    warnings.push(`${external.size} reference${external.size === 1 ? '' : 's'} to other files or URLs were not followed (${sample}${external.size > 3 ? ', …' : ''}), so the affected bodies and parameters are incomplete. Bundle the document into a single file first (for example with "redocly bundle" or "swagger-cli bundle").`)
  }
  if (isObj(doc.webhooks) && Object.keys(doc.webhooks).length > 0) warnings.push('Webhooks are not imported.')
  if (count === 0) warnings.push('The document has no operations.')

  return {
    collection: {
      name: str(info.title) || 'Imported API',
      description: str(info.description),
      source: 'local',
      auth: collectionAuth,
      ssl: 'inherit',
      variables: [...variables].map(([key, value]) => ({ key, value, isSecret: false })),
      ...(environments.length > 0 ? { environments } : {}),
      requests: rootRequests,
      folders: [...folders.values()],
    },
    warnings: [...new Set(warnings)],
  }
}

/** Resolves $refs inside the document only; remote and file references are never followed. */
export async function parseOpenApi(doc: Obj, sourceUrl?: string): Promise<ImportResult> {
  const SwaggerParser = (await import('@apidevtools/swagger-parser')).default
  const dereference = SwaggerParser.dereference as unknown as (api: object, options: object) => Promise<Obj>
  const dereferenced = await dereference(structuredClone(doc), { resolve: { external: false } })
  return convertOpenApi(dereferenced, sourceUrl)
}
