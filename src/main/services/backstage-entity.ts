/**
 * Finds the Postly collection that a Backstage API or Component entity was
 * synced into (used by `postly://open` deep links).
 *
 * syncCatalog() makes one collection per Component that provides APIs
 * (source_meta {component, namespace}) and one per API nobody provides
 * (source_meta {entityName, entityNamespace}). An API provided by a Component
 * lives in that Component's collection, so it is found via the API's
 * `apiProvidedBy` relations in the catalog.
 */
import { queryAll } from '../database'
import type { EntityRef } from './deep-link'

interface CollectionRow { id: string; source_meta: string | null }

const eq = (a: unknown, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase()

function backstageCollections(integrationId: string): Array<{ id: string; meta: Record<string, unknown> }> {
  const rows = queryAll<CollectionRow>(
    `SELECT id, source_meta FROM folders WHERE parent_id IS NULL AND source = 'backstage' AND integration_id = ?`,
    [integrationId],
  )
  return rows.flatMap((row) => {
    try {
      const meta = JSON.parse(row.source_meta ?? '') as unknown
      return meta && typeof meta === 'object' ? [{ id: row.id, meta: meta as Record<string, unknown> }] : []
    } catch { return [] }
  })
}

export function findComponentCollection(integrationId: string, namespace: string, name: string): string | null {
  const hit = backstageCollections(integrationId).find(({ meta }) =>
    eq(meta.component, name) && eq(meta.namespace ?? 'default', namespace))
  return hit?.id ?? null
}

export function findStandaloneApiCollection(integrationId: string, namespace: string, name: string): string | null {
  const hit = backstageCollections(integrationId).find(({ meta }) =>
    eq(meta.entityName, name) && eq(meta.entityNamespace ?? 'default', namespace))
  return hit?.id ?? null
}

/** Component refs (namespace/name) from an API entity's `apiProvidedBy` relations. */
export function providingComponents(entity: unknown): Array<{ namespace: string; name: string }> {
  const relations = (entity as { relations?: unknown })?.relations
  if (!Array.isArray(relations)) return []
  return relations.flatMap((rel) => {
    const r = rel as { type?: unknown; targetRef?: unknown }
    if (r?.type !== 'apiProvidedBy' || typeof r.targetRef !== 'string') return []
    const m = /^component:([^/]+)\/(.+)$/i.exec(r.targetRef)
    return m ? [{ namespace: m[1], name: m[2] }] : []
  })
}

/**
 * Collection id for `entity`, or null when it hasn't been synced (yet).
 * `fetchEntity` is only called for APIs that aren't standalone collections.
 */
export async function findEntityCollection(
  integrationId: string,
  entity: EntityRef,
  fetchEntity: (ref: EntityRef) => Promise<unknown>,
): Promise<string | null> {
  if (entity.kind === 'component') return findComponentCollection(integrationId, entity.namespace, entity.name)
  const standalone = findStandaloneApiCollection(integrationId, entity.namespace, entity.name)
  if (standalone) return standalone
  const apiEntity = await fetchEntity(entity)
  for (const comp of providingComponents(apiEntity)) {
    const id = findComponentCollection(integrationId, comp.namespace, comp.name)
    if (id) return id
  }
  return null
}
