import { BrowserWindow } from 'electron'
import axios from 'axios'
import https from 'https'
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
  sslVerification?: boolean
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

function refName(ref: string): string {
  return ref.replace(/^[^:]+:/i, '').split('/').pop() ?? ref
}

export async function syncCatalog(settings: BackstageSettings): Promise<SyncResult> {
  if (!settings.baseUrl) throw new Error('Backstage base URL is not configured')
  if (!settings.token && settings.authProvider === 'token') throw new Error('Backstage token is not configured')

  const result: SyncResult = { entitiesFound: 0, synced: 0, skipped: 0, errors: [] }
  const now = Date.now()
  const headers: Record<string, string> = {}
  if (settings.token) headers['Authorization'] = `Bearer ${settings.token}`

  // codeql[js/disabling-certificate-validation] -- intentional: user-controlled dev setting
  const httpsAgent = settings.sslVerification === false
    ? new https.Agent({ rejectUnauthorized: false })
    : undefined

  const [apisRes, compsRes] = await Promise.all([
    axios.get<BackstageApiEntity[]>(`${settings.baseUrl}/api/catalog/entities?filter=kind=API`, { headers, httpsAgent }),
    axios.get<BackstageComponentEntity[]>(`${settings.baseUrl}/api/catalog/entities?filter=kind=Component`, { headers, httpsAgent }),
  ])

  const allApis = Array.isArray(apisRes.data) ? apisRes.data : []
  const allComponents = Array.isArray(compsRes.data) ? compsRes.data : []

  const apiByName = new Map<string, BackstageApiEntity>()
  for (const api of allApis) apiByName.set(api.metadata.name, api)

  const componentApis = new Map<BackstageComponentEntity, BackstageApiEntity[]>()
  const claimedApiNames = new Set<string>()

  for (const comp of allComponents) {
    const providedRefs: string[] = comp.spec?.providesApis ?? []
    for (const rel of comp.relations ?? []) {
      if (rel.type === 'providesApi') providedRefs.push(rel.targetRef)
    }
    const apis = [...new Set(providedRefs.map(refName))]
      .map((name) => apiByName.get(name))
      .filter((api): api is BackstageApiEntity => !!api)

    if (apis.length > 0) {
      componentApis.set(comp, apis)
      apis.forEach((api) => claimedApiNames.add(api.metadata.name))
    }
  }

  const standaloneApis = allApis.filter((api) => !claimedApiNames.has(api.metadata.name))

  type CollectionSpec = { label: string; sourceMeta: string; apis: BackstageApiEntity[] }
  const collections: CollectionSpec[] = [
    ...Array.from(componentApis.entries()).map(([comp, apis]) => ({
      label: comp.metadata.name,
      sourceMeta: JSON.stringify({ component: comp.metadata.name, namespace: comp.metadata.namespace ?? 'default' }),
      apis,
    })),
    ...standaloneApis.map((api) => ({
      label: api.metadata.name,
      sourceMeta: JSON.stringify({ entityName: api.metadata.name, entityNamespace: api.metadata.namespace ?? 'default' }),
      apis: [api],
    })),
  ]

  result.entitiesFound = collections.length
  console.warn(`[Backstage] syncCatalog: ${allComponents.length} components, ${allApis.length} APIs → ${collections.length} collections`)

  for (const collection of collections) {
    const existing = queryOne<{ id: string }>(`SELECT id FROM folders WHERE parent_id IS NULL AND source = 'backstage' AND source_meta = ?`, [collection.sourceMeta])
    let collectionId: string
    if (existing) {
      collectionId = existing.id
      run('UPDATE folders SET name = ?, integration_id = ?, updated_at = ? WHERE id = ?', [collection.label, settings.integrationId ?? null, now, collectionId])
    } else {
      collectionId = crypto.randomUUID()
      run(
        `INSERT INTO folders (id, parent_id, name, source, source_meta, integration_id, auth_type, auth_config, ssl_verification, hidden, collapsed, sort_order, created_at, updated_at)
         VALUES (?, NULL, ?, 'backstage', ?, ?, 'none', '{}', 'inherit', 0, 0, 0, ?, ?)`,
        [collectionId, collection.label, collection.sourceMeta, settings.integrationId ?? null, now, now]
      )
    }

    run('DELETE FROM requests WHERE folder_id = ?', [collectionId])
    run('DELETE FROM folders WHERE parent_id = ?', [collectionId])

    let anySucceeded = false
    for (const api of collection.apis) {
      const apiName = api.metadata.name
      const apiType = api.spec?.type ?? 'openapi'
      const rawDefinition = api.spec?.definition
      console.warn(`[Backstage] ${collection.label}/${apiName} type=${apiType} hasDefinition=${!!rawDefinition}`)

      try {
        if (apiType === 'openapi' || apiType === 'swagger') {
          let spec: object | null = rawDefinition ? resolveOpenApiSpec(rawDefinition) : null
          if (!spec) {
            const specUrl = api.metadata.annotations?.['backstage.io/api-spec']
            if (specUrl) {
              try {
                spec = (await axios.get(specUrl, { headers, httpsAgent })).data
              } catch (err) {
                result.errors.push(`${collection.label}/${apiName}: failed to fetch spec — ${String(err)}`)
                continue
              }
            }
          }
          if (!spec) {
            result.errors.push(`${collection.label}/${apiName}: no definition found (definition=${JSON.stringify(rawDefinition)?.slice(0, 100)})`)
            continue
          }

          const { folders, requests } = await parseOpenApiToRequests(spec, collectionId)
          for (const folder of folders) {
            run(
              `INSERT INTO folders (id, parent_id, name, description, source, source_meta, integration_id, auth_type, auth_config, ssl_verification, hidden, collapsed, sort_order, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'local', NULL, NULL, 'none', '{}', 'inherit', ?, ?, ?, ?, ?)`,
              [folder.id, folder.parentId, folder.name, folder.description ?? '', folder.hidden ? 1 : 0, folder.collapsed ? 1 : 0, folder.sortOrder, folder.createdAt, folder.updatedAt]
            )
          }
          for (const request of requests) {
            run(
              `INSERT INTO requests (id, folder_id, name, method, url, params, headers, body_type, body_content, auth_type, auth_config, description, scm_path, scm_sha, is_dirty, sort_order, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [request.id, request.folderId, request.name, request.method, request.url, request.params, request.headers, request.bodyType,
                request.bodyContent, request.authType, request.authConfig, request.description ?? null, request.scmPath ?? null,
                request.scmSha ?? null, request.isDirty ? 1 : 0, request.sortOrder, request.createdAt, request.updatedAt]
            )
          }
          anySucceeded = true
        } else {
          const folderId = crypto.randomUUID()
          const label = apiType === 'graphql' ? 'GraphQL' : apiType === 'grpc' ? 'gRPC' : apiType.toUpperCase()
          run(
            `INSERT INTO folders (id, parent_id, name, description, source, source_meta, integration_id, auth_type, auth_config, ssl_verification, hidden, collapsed, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'local', NULL, NULL, 'none', '{}', 'inherit', 0, 0, 0, ?, ?)`,
            [folderId, collectionId, `${label} Schema`, `${label} API from Backstage`, now, now]
          )
          const requestId = crypto.randomUUID()
          const definitionStr = typeof rawDefinition === 'string' ? rawDefinition : JSON.stringify(rawDefinition ?? '', null, 2)
          const protocol = apiType === 'grpc' ? 'grpc' : apiType === 'graphql' ? 'graphql' : 'http'
          const protocolConfig = apiType === 'graphql'
            ? JSON.stringify({ schema: definitionStr })
            : apiType === 'grpc'
              ? JSON.stringify({ protoContent: definitionStr })
              : '{}'
          run(
            `INSERT INTO requests (id, folder_id, name, method, url, params, headers, body_type, body_content, auth_type, auth_config, protocol, protocol_config, description, scm_path, scm_sha, is_dirty, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
            [requestId, folderId, apiName, 'POST', settings.baseUrl, '[]', '[]',
              'none', '', 'none', '{}', protocol, protocolConfig,
              `${label} definition synced from Backstage`, null, null, now, now]
          )
          anySucceeded = true
        }
      } catch (err) {
        console.error(`[Backstage] failed to process ${collection.label}/${apiName}:`, err)
        result.errors.push(`${collection.label}/${apiName}: ${String(err)}`)
      }
    }

    if (anySucceeded) result.synced++
    else result.skipped++
  }

  console.warn(`[Backstage] sync done — synced=${result.synced} skipped=${result.skipped} errors=${result.errors.length}`)
  return result
}

const AUTH_TIMEOUT_MS = 5 * 60 * 1000

export async function authenticateWithBackstageGuest(
  baseUrl: string,
  options: { sslVerification?: boolean } = {},
): Promise<{ token: string; user: { name: string; email?: string; picture?: string } }> {
  const base = baseUrl.replace(/\/$/, '')
  // codeql[js/disabling-certificate-validation] -- intentional: user-controlled dev setting
  const httpsAgent = options.sslVerification === false
    ? new https.Agent({ rejectUnauthorized: false })
    : undefined
  const resp = await axios.post<{
    backstageIdentity?: { token?: string }
    profile?: { displayName?: string; email?: string; picture?: string }
  }>(`${base}/api/auth/guest/refresh`, {}, { headers: { 'Content-Type': 'application/json' }, httpsAgent })

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
