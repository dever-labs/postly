import crypto from 'crypto'
import { queryAll, runTransaction } from '../database'
import type { ScopeValues } from '../../shared/variables'

export type StoredScope = 'global' | 'collection'

export interface VariableRow {
  key: string
  value: string
  isSecret: boolean
}

interface DbRow { key: string; value: string; is_secret: number; scope: string; owner_id: string }

const toRow = (r: DbRow): VariableRow => ({ key: r.key, value: r.value, isSecret: !!r.is_secret })

export function listVariables(scope: StoredScope, ownerId = ''): VariableRow[] {
  return queryAll<DbRow>('SELECT * FROM variables WHERE scope = ? AND owner_id = ? ORDER BY sort_order ASC, key ASC', [scope, ownerId]).map(toRow)
}

export function listAllVariables(): { global: VariableRow[]; collections: Record<string, VariableRow[]> } {
  const collections: Record<string, VariableRow[]> = {}
  const global: VariableRow[] = []
  for (const r of queryAll<DbRow>('SELECT * FROM variables ORDER BY sort_order ASC, key ASC')) {
    if (r.scope === 'global') global.push(toRow(r))
    else (collections[r.owner_id] ??= []).push(toRow(r))
  }
  return { global, collections }
}

export function variableValues(scope: StoredScope, ownerId = ''): ScopeValues {
  return Object.fromEntries(listVariables(scope, ownerId).map((v) => [v.key, v.value]))
}

/** Normalises user input: trims names, drops blanks and braces, and keeps the last value for a repeated name. */
export function cleanVariables(rows: VariableRow[]): VariableRow[] {
  const byKey = new Map<string, VariableRow>()
  for (const r of rows) {
    const key = String(r.key ?? '').trim()
    if (!key || /[{}]/.test(key)) continue
    byKey.set(key, { key, value: String(r.value ?? ''), isSecret: !!r.isSecret })
  }
  return [...byKey.values()]
}

/** Replaces every variable of one scope owner in a single transaction. */
export function replaceVariables(scope: StoredScope, ownerId: string, rows: VariableRow[]): void {
  const owner = scope === 'global' ? '' : ownerId
  if (scope === 'collection' && !owner) throw new Error('A collection is required')
  const statements = [
    { sql: 'DELETE FROM variables WHERE scope = ? AND owner_id = ?', params: [scope, owner] },
    ...cleanVariables(rows).map((r, i) => ({
      sql: 'INSERT INTO variables (id, scope, owner_id, key, value, is_secret, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
      params: [crypto.randomUUID(), scope, owner, r.key, r.value, r.isSecret ? 1 : 0, i],
    })),
  ]
  runTransaction(statements)
}

/**
 * Applies variables read from an exported file. Secret values are never written to files, so for those
 * the value already stored locally is kept.
 */
export function importCollectionVariables(collectionId: string, incoming: VariableRow[] | undefined): void {
  if (!incoming) return
  const local = new Map(listVariables('collection', collectionId).map((v) => [v.key, v]))
  replaceVariables('collection', collectionId, incoming.map((v) => (v.isSecret ? { ...v, value: local.get(v.key)?.value ?? '' } : v)))
}

/** Collection variables for a file. Secret values stay out of the export. */
export function exportCollectionVariables(collectionId: string): VariableRow[] {
  return listVariables('collection', collectionId).map((v) => (v.isSecret ? { ...v, value: '' } : v))
}

export function deleteCollectionVariables(collectionId: string): void {
  runTransaction([{ sql: "DELETE FROM variables WHERE scope = 'collection' AND owner_id = ?", params: [collectionId] }])
}
