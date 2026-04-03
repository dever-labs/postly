// Postman Collection Format v2.0 / v2.1

interface PostmanUrl {
  raw?: string
  protocol?: string
  host?: string | string[]
  path?: Array<string | { value?: string }>
  query?: Array<{ key?: string; value?: string; disabled?: boolean }>
  variable?: Array<{ key?: string; value?: string }>
}

interface PostmanHeader {
  key: string
  value?: string
  disabled?: boolean
}

interface PostmanBody {
  mode?: 'none' | 'raw' | 'formdata' | 'urlencoded' | 'graphql' | 'binary' | 'file'
  raw?: string
  options?: { raw?: { language?: string } }
  formdata?: Array<{ key?: string; value?: string; disabled?: boolean; type?: string }>
  urlencoded?: Array<{ key?: string; value?: string; disabled?: boolean }>
  graphql?: { query?: string; variables?: string }
}

interface PostmanAuthEntry {
  key: string
  value?: string
}

interface PostmanAuth {
  type?: string
  bearer?: PostmanAuthEntry[]
  basic?: PostmanAuthEntry[]
  oauth2?: PostmanAuthEntry[]
  ntlm?: PostmanAuthEntry[]
  apikey?: PostmanAuthEntry[]
  digest?: PostmanAuthEntry[]
}

interface PostmanRequest {
  method?: string
  url?: string | PostmanUrl
  header?: PostmanHeader[]
  body?: PostmanBody
  auth?: PostmanAuth
  description?: string | { content?: string }
}

interface PostmanItem {
  name?: string
  description?: string | { content?: string }
  request?: PostmanRequest
  item?: PostmanItem[]
  auth?: PostmanAuth
}

interface PostmanCollection {
  info?: {
    name?: string
    description?: string | { content?: string }
    schema?: string
  }
  item?: PostmanItem[]
  auth?: PostmanAuth
  variable?: Array<{ key?: string; value?: string }>
}

// ─── Output types (matching ExportCollection shape in export-import.ts) ──────

export interface PostmanKV {
  key: string
  value: string
  enabled: boolean
}

export interface PostmanOutRequest {
  name: string
  method: string
  url: string
  protocol: string
  params: PostmanKV[]
  headers: PostmanKV[]
  bodyType: string
  bodyContent: string
  auth: { type: string; config: Record<string, string> }
  ssl: string
  description: string
  protocolConfig: Record<string, never>
}

export interface PostmanOutGroup {
  name: string
  description: string
  auth: { type: string; config: Record<string, string> }
  ssl: string
  requests: PostmanOutRequest[]
}

export interface PostmanOutCollection {
  name: string
  description: string
  source: string
  auth: { type: string; config: Record<string, string> }
  ssl: string
  groups: PostmanOutGroup[]
}

// ─── Detection ────────────────────────────────────────────────────────────────

export function isPostmanCollection(json: unknown): boolean {
  if (!json || typeof json !== 'object') return false
  const obj = json as Record<string, unknown>
  const info = obj['info']
  if (!info || typeof info !== 'object') return false
  const schema = (info as Record<string, unknown>)['schema']
  if (typeof schema !== 'string') return false
  try {
    const { hostname } = new URL(schema)
    return hostname === 'getpostman.com' || hostname.endsWith('.getpostman.com')
  } catch {
    return false
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _idCounter = 0
function nextId(): string {
  return String(++_idCounter)
}

function extractText(val?: string | { content?: string }): string {
  if (!val) return ''
  if (typeof val === 'string') return val
  return val.content ?? ''
}

function resolveUrl(url?: string | PostmanUrl): { raw: string; query: PostmanKV[] } {
  if (!url) return { raw: '', query: [] }
  if (typeof url === 'string') return { raw: url, query: [] }

  let raw = url.raw ?? ''
  if (!raw) {
    const protocol = url.protocol ?? 'https'
    const host = Array.isArray(url.host) ? url.host.join('.') : (url.host ?? '')
    const path = (url.path ?? [])
      .map((p) => (typeof p === 'string' ? p : (p.value ?? '')))
      .join('/')
    const portPart = ''
    raw = `${protocol}://${host}${portPart}/${path}`
  }

  const query = (url.query ?? [])
    .filter((q) => q.key)
    .map((q) => ({ key: q.key ?? '', value: q.value ?? '', enabled: !q.disabled }))

  return { raw, query }
}

function parseBody(body?: PostmanBody): { bodyType: string; bodyContent: string } {
  if (!body || !body.mode || body.mode === 'none') return { bodyType: 'none', bodyContent: '' }

  switch (body.mode) {
    case 'raw': {
      const lang = body.options?.raw?.language?.toLowerCase() ?? 'text'
      const typeMap: Record<string, string> = {
        json: 'raw-json',
        javascript: 'raw-javascript',
        html: 'raw-html',
        xml: 'raw-xml',
        text: 'raw-text',
      }
      return { bodyType: typeMap[lang] ?? 'raw-text', bodyContent: body.raw ?? '' }
    }
    case 'graphql': {
      const query = body.graphql?.query ?? ''
      const variables = body.graphql?.variables ?? ''
      return { bodyType: 'graphql', bodyContent: JSON.stringify({ query, variables }) }
    }
    case 'formdata': {
      const pairs = (body.formdata ?? []).map((f) => ({
        key: f.key ?? '',
        value: f.value ?? '',
        enabled: !f.disabled,
        fieldType: f.type === 'file' ? 'file' : 'text',
      }))
      return { bodyType: 'form-data', bodyContent: JSON.stringify(pairs) }
    }
    case 'urlencoded': {
      const pairs = (body.urlencoded ?? []).map((f) => ({
        key: f.key ?? '',
        value: f.value ?? '',
        enabled: !f.disabled,
      }))
      return { bodyType: 'x-www-form-urlencoded', bodyContent: JSON.stringify(pairs) }
    }
    case 'binary':
      return { bodyType: 'binary', bodyContent: '' }
    default:
      return { bodyType: 'none', bodyContent: '' }
  }
}

function getAuthEntry(entries: PostmanAuthEntry[] | undefined, key: string): string {
  return entries?.find((e) => e.key === key)?.value ?? ''
}

function parseAuth(auth?: PostmanAuth): { type: string; config: Record<string, string> } {
  if (!auth || !auth.type || auth.type === 'noauth') return { type: 'none', config: {} }

  switch (auth.type) {
    case 'bearer':
      return { type: 'bearer', config: { token: getAuthEntry(auth.bearer, 'token') } }
    case 'basic':
      return {
        type: 'basic',
        config: {
          username: getAuthEntry(auth.basic, 'username'),
          password: getAuthEntry(auth.basic, 'password'),
        },
      }
    case 'ntlm':
      return {
        type: 'ntlm',
        config: {
          username: getAuthEntry(auth.ntlm, 'username'),
          password: getAuthEntry(auth.ntlm, 'password'),
          domain: getAuthEntry(auth.ntlm, 'domain'),
        },
      }
    case 'oauth2':
      return { type: 'oauth2', config: {} }
    default:
      return { type: 'none', config: {} }
  }
}

function convertItem(item: PostmanItem): PostmanOutRequest {
  const req = item.request ?? {}
  const { raw: url, query } = resolveUrl(req.url)
  const { bodyType, bodyContent } = parseBody(req.body)

  const headers = (req.header ?? [])
    .filter((h) => h.key)
    .map((h) => ({ key: h.key, value: h.value ?? '', enabled: !h.disabled }))

  return {
    name: item.name ?? 'Request',
    method: (req.method ?? 'GET').toUpperCase(),
    url,
    protocol: 'http',
    params: query,
    headers,
    bodyType,
    bodyContent,
    auth: parseAuth(req.auth),
    ssl: 'inherit',
    description: extractText(req.description),
    protocolConfig: {},
  }
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export function parsePostmanCollection(json: unknown): PostmanOutCollection {
  _idCounter = 0
  const col = json as PostmanCollection

  const name = col.info?.name ?? 'Imported Collection'
  const description = extractText(col.info?.description)

  // Map<groupName, group>
  const groupMap = new Map<
    string,
    { description: string; auth: PostmanAuth | undefined; requests: PostmanOutRequest[] }
  >()

  function ensureGroup(groupName: string, desc: string, auth?: PostmanAuth) {
    if (!groupMap.has(groupName)) {
      groupMap.set(groupName, { description: desc, auth, requests: [] })
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- just set above if absent
    return groupMap.get(groupName)!
  }

  function processItems(items: PostmanItem[], parentFolder?: string) {
    for (const item of items) {
      if (item.item) {
        // Folder — recurse, building a nested name
        const folderName = parentFolder
          ? `${parentFolder} / ${item.name ?? 'Folder'}`
          : (item.name ?? 'Folder')
        processItems(item.item, folderName)
      } else if (item.request) {
        const groupName = parentFolder ?? 'Default'
        const group = ensureGroup(groupName, extractText(item.description), undefined)
        group.requests.push(convertItem(item))
      }
    }
  }

  processItems(col.item ?? [])

  const groups: PostmanOutGroup[] = []
  for (const [groupName, { description: gDesc, auth: gAuth, requests }] of groupMap) {
    if (requests.length === 0) continue
    groups.push({
      name: groupName,
      description: gDesc,
      auth: parseAuth(gAuth),
      ssl: 'inherit',
      requests,
    })
  }

  // If no folders existed, all requests are in Default group —
  // but if groups were found, drop an empty Default
  const finalGroups =
    groups.length > 1 ? groups.filter((g) => g.name !== 'Default' || g.requests.length > 0) : groups

  return {
    name,
    description,
    source: 'local',
    auth: parseAuth(col.auth),
    ssl: 'inherit',
    groups: finalGroups,
  }
}

// Re-export for convenience
export { nextId }
