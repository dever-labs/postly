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
  authProvider?: 'token' | 'guest' | 'gitlab' | 'github' | 'google'
  connectedUser?: { name: string; email?: string; picture?: string }
}

export interface SyncResult {
  entitiesFound: number
  synced: number
  skipped: number
  errors: string[]
}

interface BackstageEntity {
  metadata: {
    name: string
    namespace?: string
    annotations?: Record<string, string>
  }
  spec?: {
    type?: string
    // Backstage returns definition as a raw string (YAML, proto, GraphQL SDL, etc.)
    definition?: string | Record<string, unknown>
  }
}

function resolveOpenApiSpec(definition: string | Record<string, unknown>): object | null {
  if (typeof definition === 'object' && definition !== null) return definition
  if (typeof definition !== 'string' || !definition.trim()) return null
  try {
    const parsed = yaml.load(definition)
    if (parsed && typeof parsed === 'object') return parsed as object
  } catch { /* not valid YAML/JSON */ }
  return null
}

export async function syncCatalog(settings: BackstageSettings): Promise<SyncResult> {
  if (!settings.baseUrl) throw new Error('Backstage base URL is not configured')
  if (!settings.token && settings.authProvider === 'token') throw new Error('Backstage token is not configured')

  const result: SyncResult = { entitiesFound: 0, synced: 0, skipped: 0, errors: [] }
  const now = Date.now()
  const headers: Record<string, string> = {}
  if (settings.token) headers['Authorization'] = `Bearer ${settings.token}`

  const response = await axios.get<BackstageEntity[]>(
    `${settings.baseUrl}/api/catalog/entities?filter=kind=API`,
    { headers }
  )

  result.entitiesFound = response.data.length

  for (const entity of response.data) {
    const entityName = entity.metadata.name
    const entityNamespace = entity.metadata.namespace ?? 'default'
    const apiType = entity.spec?.type ?? 'openapi'
    const rawDefinition = entity.spec?.definition

    const sourceMeta = JSON.stringify({ entityName, entityNamespace })
    const existing = queryOne<{ id: string }>(`SELECT id FROM collections WHERE source = 'backstage' AND source_meta = ?`, [sourceMeta])

    let collectionId: string
    if (existing) {
      collectionId = existing.id
      run('UPDATE collections SET name = ?, updated_at = ? WHERE id = ?', [entityName, now, collectionId])
    } else {
      collectionId = crypto.randomUUID()
      run(`INSERT INTO collections (id, name, source, source_meta, created_at, updated_at) VALUES (?, ?, 'backstage', ?, ?, ?)`,
        [collectionId, entityName, sourceMeta, now, now])
    }

    try {
      if (apiType === 'openapi' || apiType === 'swagger') {
        let spec: object | null = rawDefinition ? resolveOpenApiSpec(rawDefinition) : null

        if (!spec) {
          const specUrl = entity.metadata.annotations?.['backstage.io/api-spec']
          if (specUrl) {
            try { spec = (await axios.get(specUrl, { headers })).data }
            catch (err) {
              result.skipped++
              result.errors.push(`${entityName}: failed to fetch spec — ${String(err)}`)
              continue
            }
          }
        }
        if (!spec) { result.skipped++; continue }

        const { groups, requests } = await parseOpenApiToRequests(spec, collectionId)
        run('DELETE FROM groups WHERE collection_id = ?', [collectionId])

        for (const g of groups) {
          run(
            `INSERT INTO groups (id, collection_id, name, description, collapsed, hidden, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [g.id, g.collectionId, g.name, g.description ?? null, g.collapsed ? 1 : 0, g.hidden ? 1 : 0, g.sortOrder, g.createdAt, g.updatedAt]
          )
        }
        for (const req of requests) {
          run(
            `INSERT INTO requests (id, group_id, name, method, url, params, headers, body_type, body_content, auth_type, auth_config, description, scm_path, scm_sha, is_dirty, sort_order, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [req.id, req.groupId, req.name, req.method, req.url, req.params, req.headers, req.bodyType,
             req.bodyContent, req.authType, req.authConfig, req.description ?? null, req.scmPath ?? null,
             req.scmSha ?? null, req.isDirty ? 1 : 0, req.sortOrder, req.createdAt, req.updatedAt]
          )
        }
      } else {
        // graphql / grpc / asyncapi — store the raw definition as a single reference request
        run('DELETE FROM groups WHERE collection_id = ?', [collectionId])
        const groupId = crypto.randomUUID()
        const label = apiType === 'graphql' ? 'GraphQL' : apiType === 'grpc' ? 'gRPC' : apiType.toUpperCase()
        run(
          `INSERT INTO groups (id, collection_id, name, description, collapsed, hidden, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?)`,
          [groupId, collectionId, `${label} Schema`, `${label} API definition from Backstage`, now, now]
        )
        const requestId = crypto.randomUUID()
        const protocol = apiType === 'grpc' ? 'grpc' : apiType === 'graphql' ? 'graphql' : 'http'
        const definitionStr = typeof rawDefinition === 'string' ? rawDefinition : JSON.stringify(rawDefinition ?? '', null, 2)
        run(
          `INSERT INTO requests (id, group_id, name, method, url, params, headers, body_type, body_content, auth_type, auth_config, description, scm_path, scm_sha, is_dirty, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
          [requestId, groupId, `${entityName} schema`, protocol === 'grpc' ? 'POST' : 'POST',
           settings.baseUrl, '[]', '[]', protocol === 'graphql' ? 'graphql' : 'raw-text',
           definitionStr, 'none', '{}', `${label} definition synced from Backstage catalog`, null, null, now, now]
        )
      }
      result.synced++
    } catch (err) {
      result.skipped++
      result.errors.push(`${entityName}: failed to parse spec — ${String(err)}`)
    }
  }

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
  const base = baseUrl.replace(/\/$/, '')

  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    title: `Sign in to Backstage via ${provider}`,
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })

  win.loadURL(`${base}/api/auth/${provider}/start?env=production`)

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
              const resp = await fetch('/api/auth/${provider}/refresh', { credentials: 'include' })
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
              name: result?.profile?.displayName ?? provider,
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
