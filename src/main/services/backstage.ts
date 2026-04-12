import { BrowserWindow } from 'electron'
import axios from 'axios'
import crypto from 'crypto'
import yaml from 'js-yaml'
import { queryOne, run } from '../database'
import { parseOpenApiToRequests } from './openapi-parser'

export interface BackstageSettings {
  baseUrl: string
  token: string
  autoSync: boolean
  integrationId?: string
  authProvider?: 'token' | 'guest' | 'gitlab' | 'github' | 'google'
  connectedUser?: { name: string; email?: string; picture?: string }
}

export interface SyncResult {
  entitiesFound: number
  synced: number
  skipped: number
  errors: string[]
}

interface BackstageApiEntity {
  metadata: {
    name: string
    namespace?: string
    annotations?: Record<string, string>
  }
  spec?: {
    type?: string
    definition?: string | Record<string, unknown>
  }
}

interface BackstageComponentEntity {
  metadata: {
    name: string
    namespace?: string
    description?: string
  }
  spec?: {
    providesApis?: string[]
  }
  relations?: Array<{ type: string; targetRef: string }>
}

function resolveOpenApiSpec(definition: string | Record<string, unknown>): object | null {
  if (typeof definition === 'object' && Object(definition) === definition) return definition
  if (typeof definition !== 'string' || !definition.trim()) return null
  try {
    const parsed = yaml.load(definition)
    if (parsed && typeof parsed === 'object') return parsed as object
  } catch { /* not valid YAML/JSON */ }
  return null
}

/** Normalise a Backstage entity ref to just the name portion */
function refName(ref: string): string {
  // e.g. 'api:default/user-management-api' → 'user-management-api'
  //       'default/user-management-api'    → 'user-management-api'
  //       'user-management-api'            → 'user-management-api'
  return ref.replace(/^[^:]+:/i, '').split('/').pop() ?? ref
}

export async function syncCatalog(settings: BackstageSettings): Promise<SyncResult> {
  if (!settings.baseUrl) throw new Error('Backstage base URL is not configured')
  if (!settings.token && settings.authProvider === 'token') throw new Error('Backstage token is not configured')

  const result: SyncResult = { entitiesFound: 0, synced: 0, skipped: 0, errors: [] }
  const now = Date.now()
  const headers: Record<string, string> = {}
  if (settings.token) headers['Authorization'] = `Bearer ${settings.token}`

  // Fetch all API + Component entities in parallel
  const [apisRes, compsRes] = await Promise.all([
    axios.get<BackstageApiEntity[]>(`${settings.baseUrl}/api/catalog/entities?filter=kind=API`, { headers }),
    axios.get<BackstageComponentEntity[]>(`${settings.baseUrl}/api/catalog/entities?filter=kind=Component`, { headers }),
  ])

  const allApis = Array.isArray(apisRes.data) ? apisRes.data : []
  const allComponents = Array.isArray(compsRes.data) ? compsRes.data : []

  // Build fast-lookup: name → API entity
  const apiByName = new Map<string, BackstageApiEntity>()
  for (const api of allApis) apiByName.set(api.metadata.name, api)

  // Group APIs by component using spec.providesApis or relations
  const componentApis = new Map<BackstageComponentEntity, BackstageApiEntity[]>()
  const claimedApiNames = new Set<string>()

  for (const comp of allComponents) {
    // Collect API names via spec.providesApis
    const providedRefs: string[] = comp.spec?.providesApis ?? []
    // Also collect via relations (type: 'providesApi')
    for (const rel of comp.relations ?? []) {
      if (rel.type === 'providesApi') providedRefs.push(rel.targetRef)
    }
    const apis = [...new Set(providedRefs.map(refName))]
      .map(name => apiByName.get(name))
      .filter((a): a is BackstageApiEntity => !!a)

    if (apis.length > 0) {
      componentApis.set(comp, apis)
      apis.forEach(a => claimedApiNames.add(a.metadata.name))
    }
  }

  // APIs with no owning component become standalone collections
  const standaloneApis = allApis.filter(a => !claimedApiNames.has(a.metadata.name))

  // Build collection list: [{ label, apis }]
  type CollectionSpec = { label: string; sourceMeta: string; apis: BackstageApiEntity[] }
  const collections: CollectionSpec[] = [
    ...Array.from(componentApis.entries()).map(([comp, apis]) => ({
      label: comp.metadata.name,
      sourceMeta: JSON.stringify({ component: comp.metadata.name, namespace: comp.metadata.namespace ?? 'default' }),
      apis,
    })),
    ...standaloneApis.map(api => ({
      label: api.metadata.name,
      sourceMeta: JSON.stringify({ entityName: api.metadata.name, entityNamespace: api.metadata.namespace ?? 'default' }),
      apis: [api],
    })),
  ]

  result.entitiesFound = collections.length
  console.log(`[Backstage] syncCatalog: ${allComponents.length} components, ${allApis.length} APIs → ${collections.length} collections`)

  for (const col of collections) {
    // Upsert the collection row
    const existing = queryOne<{ id: string }>(`SELECT id FROM collections WHERE source = 'backstage' AND source_meta = ?`, [col.sourceMeta])
    let collectionId: string
    if (existing) {
      collectionId = existing.id
      run('UPDATE collections SET name = ?, integration_id = ?, updated_at = ? WHERE id = ?', [col.label, settings.integrationId ?? null, now, collectionId])
    } else {
      collectionId = crypto.randomUUID()
    run(`INSERT INTO collections (id, name, source, source_meta, integration_id, created_at, updated_at) VALUES (?, ?, 'backstage', ?, ?, ?, ?)`,
        [collectionId, col.label, col.sourceMeta, settings.integrationId ?? null, now, now])
    }

    // Clear old groups + requests before re-importing
    run('DELETE FROM requests WHERE group_id IN (SELECT id FROM groups WHERE collection_id = ?)', [collectionId])
    run('DELETE FROM groups WHERE collection_id = ?', [collectionId])

    let anySucceeded = false
    for (const api of col.apis) {
      const apiName = api.metadata.name
      const apiType = api.spec?.type ?? 'openapi'
      const rawDefinition = api.spec?.definition
      console.log(`[Backstage] ${col.label}/${apiName} type=${apiType} hasDefinition=${!!rawDefinition}`)

      try {
        if (apiType === 'openapi' || apiType === 'swagger') {
          let spec: object | null = rawDefinition ? resolveOpenApiSpec(rawDefinition) : null
          if (!spec) {
            const specUrl = api.metadata.annotations?.['backstage.io/api-spec']
            if (specUrl) {
              try { spec = (await axios.get(specUrl, { headers })).data }
              catch (err) { result.errors.push(`${col.label}/${apiName}: failed to fetch spec — ${String(err)}`); continue }
            }
          }
          if (!spec) {
            result.errors.push(`${col.label}/${apiName}: no definition found (definition=${JSON.stringify(rawDefinition)?.slice(0, 100)})`)
            continue
          }
          const { groups, requests } = await parseOpenApiToRequests(spec, collectionId)
          for (const g of groups) {
            run(`INSERT INTO groups (id, collection_id, name, description, collapsed, hidden, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [g.id, g.collectionId, g.name, g.description ?? null, g.collapsed ? 1 : 0, g.hidden ? 1 : 0, g.sortOrder, g.createdAt, g.updatedAt])
          }
          for (const req of requests) {
            run(`INSERT INTO requests (id, group_id, name, method, url, params, headers, body_type, body_content, auth_type, auth_config, description, scm_path, scm_sha, is_dirty, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [req.id, req.groupId, req.name, req.method, req.url, req.params, req.headers, req.bodyType,
               req.bodyContent, req.authType, req.authConfig, req.description ?? null, req.scmPath ?? null,
               req.scmSha ?? null, req.isDirty ? 1 : 0, req.sortOrder, req.createdAt, req.updatedAt])
          }
          anySucceeded = true
        } else {
          // graphql / grpc / asyncapi — store raw definition as a schema request
          const groupId = crypto.randomUUID()
          const label = apiType === 'graphql' ? 'GraphQL' : apiType === 'grpc' ? 'gRPC' : apiType.toUpperCase()
          run(`INSERT INTO groups (id, collection_id, name, description, collapsed, hidden, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?)`,
            [groupId, collectionId, `${label} Schema`, `${label} API from Backstage`, now, now])
          const requestId = crypto.randomUUID()
          const definitionStr = typeof rawDefinition === 'string' ? rawDefinition : JSON.stringify(rawDefinition ?? '', null, 2)
          const protocol = apiType === 'grpc' ? 'grpc' : apiType === 'graphql' ? 'graphql' : 'http'
          // GraphQL: store SDL in protocol_config.schema so it's visible in the schema tab
          // gRPC: store proto in protocol_config.protoContent (matches GrpcView prop)
          const protocolConfig = apiType === 'graphql'
            ? JSON.stringify({ schema: definitionStr })
            : apiType === 'grpc'
              ? JSON.stringify({ protoContent: definitionStr })
              : '{}'
          run(`INSERT INTO requests (id, group_id, name, method, url, params, headers, body_type, body_content, auth_type, auth_config, protocol, protocol_config, description, scm_path, scm_sha, is_dirty, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
            [requestId, groupId, apiName, 'POST', settings.baseUrl, '[]', '[]',
             'none', '', 'none', '{}', protocol, protocolConfig,
             `${label} definition synced from Backstage`, null, null, now, now])
          anySucceeded = true
        }
      } catch (err) {
        console.error(`[Backstage] failed to process ${col.label}/${apiName}:`, err)
        result.errors.push(`${col.label}/${apiName}: ${String(err)}`)
      }
    }

    if (anySucceeded) result.synced++
    else result.skipped++
  }

  console.log(`[Backstage] sync done — synced=${result.synced} skipped=${result.skipped} errors=${result.errors.length}`)
  return result
}

const AUTH_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Fetch a Backstage guest token. No browser window — just a direct HTTP call
 * to /api/auth/guest/refresh. Works when dangerouslyAllowOutsideDevelopment is true.
 */
export async function authenticateWithBackstageGuest(
  baseUrl: string,
): Promise<{ token: string; user: { name: string; email?: string; picture?: string } }> {
  const base = baseUrl.replace(/\/$/, '')
  const resp = await axios.post<{
    backstageIdentity?: { token?: string }
    profile?: { displayName?: string; email?: string; picture?: string }
  }>(`${base}/api/auth/guest/refresh`, {}, { headers: { 'Content-Type': 'application/json' } })

  const token = resp.data?.backstageIdentity?.token
  if (!token) throw new Error('Guest refresh did not return a token')

  return {
    token,
    user: {
      name: resp.data?.profile?.displayName ?? 'Guest',
      email: resp.data?.profile?.email,
      picture: resp.data?.profile?.picture,
    },
  }
}

/**
 * Opens a BrowserWindow to the Backstage auth start endpoint for the given
 * provider (e.g. 'gitlab', 'github', 'google'). After the OAuth dance
 * completes and Backstage sets a session, the window's JavaScript context
 * calls the Backstage refresh endpoint (with the session cookies) to
 * retrieve the Backstage-signed token.
 */
export async function authenticateWithBackstage(
  baseUrl: string,
  provider: string,
): Promise<{ token: string; user: { name: string; email?: string; picture?: string } }> {
  const ALLOWED = ['gitlab', 'github', 'google'] as const
  type OAuthProvider = typeof ALLOWED[number]
  if (!ALLOWED.includes(provider as OAuthProvider)) {
    throw new Error(`Unsupported Backstage OAuth provider: ${JSON.stringify(provider)}`)
  }
  const safeProvider = provider as OAuthProvider
  const base = baseUrl.replace(/\/$/, '')

  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    title: `Sign in to Backstage via ${safeProvider}`,
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })

  win.loadURL(`${base}/api/auth/${safeProvider}/start?env=production`)

  return new Promise((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      if (!win.isDestroyed()) win.webContents.off('did-finish-load', tryExtract)
      win.off('closed', onClosed)
      clearTimeout(timer)
    }

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }

    const tryExtract = async () => {
      const url = win.webContents.getURL()
      // Skip while still in the OAuth redirect dance
      if (url.includes('/api/auth/') || url.includes('/oauth/') || url.includes('/login')) return
      try {
        const result = await win.webContents.executeJavaScript(`
          (async () => {
            try {
              const resp = await fetch('/api/auth/${safeProvider}/refresh', { credentials: 'include' })
              if (!resp.ok) return null
              return await resp.json()
            } catch { return null }
          })()
        `) as { backstageIdentity?: { token?: string }; profile?: { displayName?: string; email?: string; picture?: string } } | null

        const token = result?.backstageIdentity?.token
        if (token) {
          settle(() => resolve({
            token,
            user: {
              name: result?.profile?.displayName ?? safeProvider,
              email: result?.profile?.email,
              picture: result?.profile?.picture,
            },
          }))
        }
      } catch { /* keep waiting for next navigation */ }
    }

    const onClosed = () => settle(() => reject(new Error('Authentication window closed')))
    const timer = setTimeout(
      () => settle(() => reject(new Error('Backstage authentication timed out'))),
      AUTH_TIMEOUT_MS,
    )

    win.webContents.on('did-finish-load', tryExtract)
    win.on('closed', onClosed)
  }).finally(() => {
    if (!win.isDestroyed()) win.close()
  }) as Promise<{ token: string; user: { name: string; email?: string; picture?: string } }>
}
