import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import initSqlJs, { type Database } from 'sql.js'
import path from 'path'

let db: Database

vi.mock('../../database', () => ({
  queryAll: (sql: string, params: unknown[] = []) => {
    const stmt = db.prepare(sql)
    stmt.bind(params as never)
    const rows: unknown[] = []
    while (stmt.step()) rows.push(stmt.getAsObject())
    stmt.free()
    return rows
  },
  runTransaction: (statements: Array<{ sql: string; params?: unknown[] }>) => {
    db.run('BEGIN TRANSACTION')
    try {
      for (const s of statements) db.run(s.sql, s.params as never)
      db.run('COMMIT')
    } catch (e) { db.run('ROLLBACK'); throw e }
  },
}))

import {
  cleanVariables, deleteCollectionVariables, exportCollectionVariables, importCollectionVariables,
  listAllVariables, listVariables, replaceVariables, variableValues,
} from '../variable-store'

beforeAll(async () => {
  const SQL = await initSqlJs({ locateFile: (f) => path.join(path.dirname(require.resolve('sql.js')), f) })
  db = new SQL.Database()
})

beforeEach(() => {
  db.run('DROP TABLE IF EXISTS variables')
  db.run(`CREATE TABLE variables (
    id TEXT PRIMARY KEY, scope TEXT NOT NULL, owner_id TEXT NOT NULL DEFAULT '', key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '', is_secret INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (scope, owner_id, key))`)
})

const v = (key: string, value = '', isSecret = false) => ({ key, value, isSecret })

describe('variable store', () => {
  it('keeps global and per-collection variables apart and preserves order', () => {
    replaceVariables('global', '', [v('b', '1'), v('a', '2')])
    replaceVariables('collection', 'c1', [v('x', '3')])
    replaceVariables('collection', 'c2', [v('x', '4', true)])
    expect(listVariables('global').map((r) => r.key)).toEqual(['b', 'a'])
    expect(variableValues('collection', 'c1')).toEqual({ x: '3' })
    expect(variableValues('collection', 'c2')).toEqual({ x: '4' })
    expect(listAllVariables().collections['c2'][0].isSecret).toBe(true)
  })

  it('replaces the whole set, drops blanks and braces, and keeps the last duplicate', () => {
    replaceVariables('global', '', [v('a', '1')])
    replaceVariables('global', '', [v(' k ', 'old'), v('k', 'new'), v(''), v('{{bad}}'), v('ok', 'y')])
    expect(listVariables('global')).toEqual([v('k', 'new'), v('ok', 'y')])
    expect(cleanVariables([v('  ', 'x')])).toEqual([])
  })

  it('requires a collection for collection scope', () => {
    expect(() => replaceVariables('collection', '', [v('a')])).toThrow(/collection/i)
  })

  it('deletes only the given collection', () => {
    replaceVariables('collection', 'c1', [v('a')])
    replaceVariables('collection', 'c2', [v('a')])
    deleteCollectionVariables('c1')
    expect(listVariables('collection', 'c1')).toEqual([])
    expect(listVariables('collection', 'c2')).toHaveLength(1)
  })

  it('exports without secret values', () => {
    replaceVariables('collection', 'c1', [v('host', 'h'), v('key', 'sek', true)])
    expect(exportCollectionVariables('c1')).toEqual([v('host', 'h'), v('key', '', true)])
  })

  it('imports non-secret values and keeps a locally stored secret', () => {
    replaceVariables('collection', 'c1', [v('key', 'local-secret', true), v('host', 'old')])
    importCollectionVariables('c1', [v('host', 'new'), v('key', '', true), v('added', 'a')])
    expect(variableValues('collection', 'c1')).toEqual({ host: 'new', key: 'local-secret', added: 'a' })
  })

  it('creates empty secrets for a fresh import and ignores files without variables', () => {
    importCollectionVariables('c9', [v('key', '', true)])
    expect(variableValues('collection', 'c9')).toEqual({ key: '' })
    importCollectionVariables('c1', undefined)
    expect(listVariables('collection', 'c1')).toEqual([])
    replaceVariables('collection', 'c1', [v('keep', '1')])
    importCollectionVariables('c1', undefined)
    expect(variableValues('collection', 'c1')).toEqual({ keep: '1' })
  })
})
