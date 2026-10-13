import crypto from 'crypto'
import type { ExportCollection, ExportFolder, ExportRequest } from '../ipc/export-import'

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

function mapScheme(name: string, scheme: unknown, warnings: string[]): Auth | null {
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
  warnings.push(`Security scheme "${name}" (${type}${httpScheme ? ` ${httpScheme}` : ''}) is not mapped; configure authentication manually.`)
  return null
}

/** Converts an already dereferenced OpenAPI 3.x or Swagger 2 document into a Postly collection. */
export function convertOpenApi(doc: Obj, sourceUrl?: string): ImportResult {
  const warnings: string[] = []
  const isV3 = str(doc.openapi).startsWith('3')
  const info = isObj(doc.info) ? doc.info : {}
  const variables = new Map<string, string>()

  let baseUrl = ''
  if (isV3) {
    const servers = (Array.isArray(doc.servers) ? doc.servers : []).filter(isObj)
    baseUrl = servers[0] ? serverUrl(servers[0]) : ''
    if (servers.length > 1) warnings.push(`${servers.length} servers are defined; only the first is used as {{baseUrl}} (others: ${servers.slice(1).map((s) => str(s.url)).join(', ')}).`)
  } else {
    const host = str(doc.host)
    const schemes = Array.isArray(doc.schemes) ? doc.schemes : []
    baseUrl = host ? `${str(schemes[0]) || 'https'}://${host}${str(doc.basePath)}` : str(doc.basePath)
  }
  if (baseUrl && !/^[a-z][a-z0-9+.-]*:\/\//i.test(baseUrl)) {
    const relative = baseUrl
    try {
      if (!sourceUrl) throw new Error('no source')
      baseUrl = new URL(relative, sourceUrl).href
    } catch {
      warnings.push(`The server URL "${relative}" is relative; set {{baseUrl}} to the full address (for example https://host${relative.startsWith('/') ? '' : '/'}${relative}).`)
    }
  }
  baseUrl = baseUrl.replace(/\/+$/, '')
  if (baseUrl) variables.set('baseUrl', baseUrl)
  else warnings.push('No server URL found; set {{baseUrl}} in the collection variables.')

  const schemes: Obj = isV3
    ? (isObj(doc.components) && isObj(doc.components.securitySchemes) ? doc.components.securitySchemes : {})
    : (isObj(doc.securityDefinitions) ? doc.securityDefinitions : {})
  const authCache = new Map<string, Auth | null>()
  const schemeAuth = (name: string): Auth | null => {
    if (!authCache.has(name)) authCache.set(name, mapScheme(name, schemes[name], warnings))
    return authCache.get(name) ?? null
  }
  const authFor = (security: unknown): Auth => {
    const requirement = Array.isArray(security) ? security.find((r) => isObj(r) && Object.keys(r).length > 0) : undefined
    if (!isObj(requirement)) return NO_AUTH
    const names = Object.keys(requirement)
    const mapped = names.map(schemeAuth).find((a): a is Auth => a !== null)
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
  let count = 0
  for (const [path, rawItem] of Object.entries(paths)) {
    if (!isObj(rawItem)) continue
    const pathParams = Array.isArray(rawItem.parameters) ? rawItem.parameters.filter(isObj) : []
    for (const method of METHODS) {
      const op = rawItem[method]
      if (!isObj(op)) continue
      count++
      const label = `${method.toUpperCase()} ${path}`

      const own = Array.isArray(op.parameters) ? op.parameters.filter(isObj) : []
      const merged = new Map<string, Obj>()
      for (const p of [...pathParams, ...own]) merged.set(`${str(p.in)}:${str(p.name)}`, p)
      const params: Obj[] = [...merged.values()]

      const query = params.filter((p) => p.in === 'query')
      const headers = params.filter((p) => p.in === 'header')
      if (params.some((p) => p.in === 'cookie')) warnings.push(`${label}: cookie parameters are not mapped; set them in the cookie jar or a Cookie header.`)
      // Only values the author supplied; invented placeholders would be sent as real data
      const paramValue = (p: Obj): unknown => {
        const source = isV3 && isObj(p.schema) ? p.schema : p
        if (p.example !== undefined) return p.example
        if (source.default !== undefined) return source.default
        return Array.isArray(source.enum) ? source.enum[0] : ''
      }

      let url = `{{baseUrl}}${path}`
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
        params: query.map((p) => kv(str(p.name), paramValue(p), p.required === true)),
        headers: headers.map((p) => kv(str(p.name), paramValue(p), p.required === true)),
        bodyType,
        bodyContent,
        auth,
        ssl: 'inherit',
        description: str(op.description) || str(op.summary),
        protocolConfig: {},
      }

      const tag = Array.isArray(op.tags) ? str(op.tags[0]) : ''
      if (!tag) { rootRequests.push(request); continue }
      let folder = folders.get(tag)
      if (!folder) {
        folder = { name: tag, description: tagDescriptions.get(tag) ?? '', auth: { type: 'inherit', config: {} }, ssl: 'inherit', requests: [], folders: [] }
        folders.set(tag, folder)
      }
      folder.requests.push(request)
    }
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
