import axios from 'axios'
import crypto from 'crypto'
import { queryOne, run } from '../database'
import { parseOpenApiToRequests } from './openapi-parser'

export interface BackstageSettings {
  baseUrl: string
  token: string
  autoSync: boolean
}

interface BackstageEntity {
  metadata: {
    name: string
    namespace?: string
    annotations?: Record<string, string>
  }
  spec?: {
    definition?: {
      openapi?: object
      swagger?: object
    }
  }
}

export async function syncCatalog(settings: BackstageSettings): Promise<void> {
  const now = Date.now()
  const headers: Record<string, string> = {}
  if (settings.token) headers['Authorization'] = `Bearer ${settings.token}`

  const response = await axios.get<BackstageEntity[]>(
    `${settings.baseUrl}/api/catalog/entities?filter=kind=API`,
    { headers }
  )

  for (const entity of response.data) {
    const entityName = entity.metadata.name
    const entityNamespace = entity.metadata.namespace ?? 'default'

    let spec: object | null = null
    if (entity.spec?.definition?.openapi) spec = entity.spec.definition.openapi
    else if (entity.spec?.definition?.swagger) spec = entity.spec.definition.swagger

    if (!spec) {
      const specUrl = entity.metadata.annotations?.['backstage.io/api-spec']
      if (specUrl) {
        try { spec = (await axios.get(specUrl, { headers })).data }
        catch { continue }
      }
    }
    if (!spec) continue

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
    } catch { /* skip unparseable specs */ }
  }
}
