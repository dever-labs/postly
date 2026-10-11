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
  run: (sql: string, params: unknown[] = []) => { db.run(sql, params as never) },
  runTransaction: (statements: Array<{ sql: string; params?: unknown[] }>) => {
    db.run('BEGIN TRANSACTION')
    try { for (const s of statements) db.run(s.sql, s.params as never); db.run('COMMIT') } catch (e) { db.run('ROLLBACK'); throw e }
  },
}))

import { applyExtraction } from '../extract-apply'
import { listVariables } from '../variable-store'
import type { ExtractResult } from '../../../shared/extract'

beforeAll(async () => {
  const SQL = await initSqlJs({ locateFile: (f) => path.join(path.dirname(require.resolve('sql.js')), f) })
  db = new SQL.Database()
})

beforeEach(() => {
  db.run('DROP TABLE IF EXISTS variables')
  db.run('DROP TABLE IF EXISTS env_vars')
  db.run(`CREATE TABLE variables (
    id TEXT PRIMARY KEY, scope TEXT NOT NULL, owner_id TEXT NOT NULL DEFAULT '', key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '', is_secret INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (scope, owner_id, key))`)
  db.run('CREATE TABLE env_vars (id TEXT PRIMARY KEY, env_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL DEFAULT \'\', is_secret INTEGER NOT NULL DEFAULT 0)')
})

const ok = (variable: string, value: string, scope: 'environment' | 'collection' = 'environment'): ExtractResult => ({
  rule: { id: variable, source: 'status', expression: '', variable, scope, enabled: true }, ok: true, value,
})
const envRows = () => db.exec('SELECT id, key, value, is_secret FROM env_vars ORDER BY key')[0]?.values ?? []

describe('applyExtraction', () => {
  it('creates an environment variable, then updates it in place and keeps its secret flag', () => {
    applyExtraction([ok('token', 'one')], { envId: 'e1', collectionId: null })
    const [[id]] = envRows()
    db.run("UPDATE env_vars SET is_secret = 1 WHERE key = 'token'")
    const [outcome] = applyExtraction([ok('token', 'two')], { envId: 'e1', collectionId: null })
    expect(envRows()).toEqual([[id, 'token', 'two', 1]])
    expect(outcome.display).not.toContain('two')
  })

  it('writes collection variables, preserving the others', () => {
    db.run("INSERT INTO variables (id, scope, owner_id, key, value, is_secret) VALUES ('1','collection','c1','keep','k',1)")
    applyExtraction([ok('a', '1', 'collection'), ok('a', '2', 'collection')], { envId: null, collectionId: 'c1' })
    expect(listVariables('collection', 'c1')).toEqual([{ key: 'keep', value: 'k', isSecret: true }, { key: 'a', value: '2', isSecret: false }])
  })

  it('reports missing targets and failed rules instead of throwing', () => {
    const failed: ExtractResult = { rule: ok('x', '').rule, ok: false, error: 'Nothing found at $.x' }
    const out = applyExtraction([ok('e', '1'), ok('c', '1', 'collection'), failed], { envId: null, collectionId: null })
    expect(out.map((o) => o.ok)).toEqual([false, false, false])
    expect(out[0].error).toMatch(/active environment/)
    expect(out[1].error).toMatch(/collection/)
    expect(out[2].error).toBe('Nothing found at $.x')
  })

  it('truncates long values in the display', () => {
    const [o] = applyExtraction([ok('big', 'x'.repeat(500))], { envId: 'e1', collectionId: null })
    expect(o.display?.length).toBeLessThan(100)
  })
})

describe('guardedRegex', () => {
  it('matches like a normal regex', async () => {
    const { guardedRegex } = await import('../extract-apply')
    expect(guardedRegex('token=(\\w+)', 'a token=xyz b')).toEqual(['token=xyz', 'xyz'])
    expect(guardedRegex('zzz', 'abc')).toBeNull()
  })

  it('stops a catastrophic pattern instead of freezing', async () => {
    const { guardedRegex } = await import('../extract-apply')
    const started = Date.now()
    expect(() => guardedRegex('(a+)+$', `${'a'.repeat(60)}b`)).toThrow(/stopped/)
    expect(Date.now() - started).toBeLessThan(3000)
  })
})
