import { DYNAMIC_VARIABLES, type VarScope, type VariableScopes } from '../../../shared/variables'
import type { EnvVar, Folder } from '@/types'
import type { VariableRow } from '@/store/variables'

export interface ScopedVar {
  key: string
  value: string
  isSecret: boolean
  scope: VarScope
}

/** The collection (top-level folder) a folder belongs to. */
export function rootCollectionId(folderId: string | undefined, folders: Folder[]): string | undefined {
  const byId = new Map(folders.map((f) => [f.id, f]))
  let current = folderId ? byId.get(folderId) : undefined
  for (let guard = 0; current && guard < 100; guard++) {
    if (!current.parentId) return current.id
    current = byId.get(current.parentId)
  }
  return undefined
}

interface Inputs {
  environment: Pick<EnvVar, 'key' | 'value' | 'isSecret'>[]
  collection: VariableRow[]
  global: VariableRow[]
}

/** Every variable visible to a request, one per name, with the highest-precedence scope winning. Built-ins come last. */
export function mergeScopedVars({ environment, collection, global }: Inputs): ScopedVar[] {
  const out = new Map<string, ScopedVar>()
  const add = (rows: Pick<EnvVar, 'key' | 'value' | 'isSecret'>[], scope: VarScope) => {
    for (const r of rows) if (r.key && !out.has(r.key)) out.set(r.key, { key: r.key, value: r.value, isSecret: r.isSecret, scope })
  }
  add(environment, 'environment')
  add(collection, 'collection')
  add(global, 'global')
  for (const d of DYNAMIC_VARIABLES) if (!out.has(d.name)) out.set(d.name, { key: d.name, value: d.description, isSecret: false, scope: 'dynamic' })
  return [...out.values()]
}

/** Scope values for interpolation, optionally leaving secrets out so they stay as {{placeholders}}. */
export function toVariableScopes({ environment, collection, global }: Inputs, includeSecrets: boolean): VariableScopes {
  const values = (rows: Pick<EnvVar, 'key' | 'value' | 'isSecret'>[]) =>
    Object.fromEntries(rows.filter((r) => r.key && (includeSecrets || !r.isSecret)).map((r) => [r.key, r.value]))
  return { global: values(global), collection: values(collection), environment: values(environment) }
}
