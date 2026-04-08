import SwaggerParser from '@apidevtools/swagger-parser'
import crypto from 'crypto'

export interface ParsedGroup {
  id: string
  collectionId: string
  name: string
  description: string
  collapsed: boolean
  hidden: boolean
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface ParsedRequest {
  id: string
  groupId: string
  name: string
  method: string
  url: string
  params: string
  headers: string
  bodyType: string
  bodyContent: string
  authType: string
  authConfig: string
  description: string
  scmPath: string | null
  scmSha: string | null
  isDirty: number
  sortOrder: number
  createdAt: number
  updatedAt: number
}

/** Build a minimal JSON skeleton from an OpenAPI schema object */
function buildJsonSkeleton(schema: Record<string, unknown>, depth = 0): string {
  if (depth > 4) return 'null'
  const type = schema['type'] as string | undefined
  if (type === 'object' || schema['properties']) {
    const props = (schema['properties'] ?? {}) as Record<string, Record<string, unknown>>
    const pairs = Object.entries(props).map(([k, v]) => `  "${k}": ${buildJsonSkeleton(v, depth + 1)}`)
    return pairs.length > 0 ? `{\n${pairs.join(',\n')}\n}` : '{}'
  }
  if (type === 'array' && schema['items']) {
    return `[${buildJsonSkeleton(schema['items'] as Record<string, unknown>, depth + 1)}]`
  }
  if (type === 'string') return '"string"'
  if (type === 'integer' || type === 'number') return '0'
  if (type === 'boolean') return 'false'
  return 'null'
}

export async function parseOpenApiToRequests(
  spec: object,
  collectionId: string
): Promise<{ groups: ParsedGroup[]; requests: ParsedRequest[] }> {
  const dereferenced = (await SwaggerParser.dereference(spec as never)) as Record<string, unknown>

  const now = Date.now()
  const groups: ParsedGroup[] = []
  const requests: ParsedRequest[] = []

  const groupMap = new Map<string, ParsedGroup>()

  function getOrCreateGroup(tag: string): ParsedGroup {
    const existing = groupMap.get(tag)
    if (existing) return existing
    const group: ParsedGroup = {
      id: crypto.randomUUID(),
      collectionId,
      name: tag,
      description: '',
      collapsed: false,
      hidden: false,
      sortOrder: groups.length,
      createdAt: now,
      updatedAt: now
    }
    groupMap.set(tag, group)
    groups.push(group)
    return group
  }

  const paths = dereferenced['paths'] as Record<string, Record<string, unknown>> | undefined
  if (!paths) return { groups, requests }

  // Determine base URL
  let baseUrl = ''
  const isOas3 = !!(dereferenced['openapi'] as string | undefined)?.startsWith('3')
  if (isOas3) {
    const servers = dereferenced['servers'] as Array<{ url: string }> | undefined
    baseUrl = servers?.[0]?.url ?? ''
  } else {
    // Swagger 2.x
    const schemes = dereferenced['schemes'] as string[] | undefined
    const scheme = schemes?.[0] ?? 'https'
    const host = (dereferenced['host'] as string | undefined) ?? ''
    const basePath = (dereferenced['basePath'] as string | undefined) ?? ''
    baseUrl = host ? `${scheme}://${host}${basePath}` : basePath
  }

  const httpMethods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace']

  for (const [pathKey, pathItem] of Object.entries(paths)) {
    for (const method of httpMethods) {
      const operation = pathItem[method] as Record<string, unknown> | undefined
      if (!operation) continue

      const tags = (operation['tags'] as string[] | undefined) ?? []
      const tag = tags[0] ?? 'Default'
      const group = getOrCreateGroup(tag)

      const operationId = (operation['operationId'] as string | undefined) ?? ''
      const summary = (operation['summary'] as string | undefined) ?? ''
      const description = (operation['description'] as string | undefined) ?? summary

      const name = summary || operationId || `${method.toUpperCase()} ${pathKey}`

      const parameters = (operation['parameters'] as Array<Record<string, unknown>> | undefined) ?? []

      const queryParams = parameters
        .filter((p) => p['in'] === 'query')
        .map((p) => ({ id: crypto.randomUUID(), key: String(p['name'] ?? ''), value: '', enabled: true }))

      const headerParams = parameters
        .filter((p) => p['in'] === 'header')
        .map((p) => ({ id: crypto.randomUUID(), key: String(p['name'] ?? ''), value: '', enabled: true }))

      // Derive body type and content from requestBody
      let bodyType: string = 'none'
      let bodyContent = ''
      const requestBody = operation['requestBody'] as { content?: Record<string, { schema?: unknown }> } | undefined
      if (requestBody?.content) {
        if (requestBody.content['application/json']) {
          bodyType = 'raw-json'
          const schema = requestBody.content['application/json'].schema
          bodyContent = schema ? buildJsonSkeleton(schema as Record<string, unknown>) : '{}'
        } else if (requestBody.content['application/xml']) {
          bodyType = 'raw-xml'
        } else if (requestBody.content['text/plain']) {
          bodyType = 'raw-text'
        } else {
          bodyType = 'raw-json'
          bodyContent = '{}'
        }
      }

      requests.push({
        id: crypto.randomUUID(),
        groupId: group.id,
        name,
        method: method.toUpperCase(),
        url: `${baseUrl}${pathKey}`,
        params: JSON.stringify(queryParams),
        headers: JSON.stringify(headerParams),
        bodyType,
        bodyContent,
        authType: 'none',
        authConfig: '{}',
        description,
        scmPath: null,
        scmSha: null,
        isDirty: 0,
        sortOrder: requests.length,
        createdAt: now,
        updatedAt: now
      })
    }
  }

  return { groups, requests }
}
