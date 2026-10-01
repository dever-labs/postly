import { describe, it, expect, beforeAll } from 'vitest'
import initSqlJs, { type Database } from 'sql.js'
import path from 'path'
import { migrations } from '../migrations'

let SQL: Awaited<ReturnType<typeof initSqlJs>>

beforeAll(async () => {
  const dir = path.dirname(require.resolve('sql.js'))
  SQL = await initSqlJs({ locateFile: (f) => path.join(dir, f) })
})

function freshDb(): Database {
  const db = new SQL.Database()
  db.run('PRAGMA foreign_keys = ON')
  for (const m of migrations) db.run(m)
  return db
}

function scalar(db: Database, sql: string, params: (string | number)[] = []): unknown {
  const res = db.exec(sql, params)
  return res[0]?.values[0]?.[0]
}

describe('migrations', () => {
  it('creates every expected table', () => {
    const db = freshDb()
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0].values.map((r) => r[0])
    expect(tables).toEqual(expect.arrayContaining([
      'settings', 'folders', 'requests', 'environments', 'env_vars', 'oauth_configs', 'tokens', 'integrations',
    ]))
  })

  it('is idempotent (safe to run on every startup)', () => {
    const db = freshDb()
    expect(() => { for (const m of migrations) db.run(m) }).not.toThrow()
  })

  it('applies defaults to new folders and requests', () => {
    const db = freshDb()
    db.run("INSERT INTO folders (id, name, created_at, updated_at) VALUES ('f1', 'Root', 1, 1)")
    db.run("INSERT INTO requests (id, folder_id, name, created_at, updated_at) VALUES ('r1', 'f1', 'Req', 1, 1)")
    expect(scalar(db, "SELECT source FROM folders WHERE id = 'f1'")).toBe('local')
    expect(scalar(db, "SELECT ssl_verification FROM folders WHERE id = 'f1'")).toBe('inherit')
    expect(scalar(db, "SELECT method FROM requests WHERE id = 'r1'")).toBe('GET')
    expect(scalar(db, "SELECT body_type FROM requests WHERE id = 'r1'")).toBe('none')
    expect(scalar(db, "SELECT is_dirty FROM requests WHERE id = 'r1'")).toBe(0)
  })

  it('cascades deletes down the folder tree to requests', () => {
    const db = freshDb()
    db.run("INSERT INTO folders (id, name, created_at, updated_at) VALUES ('root', 'Root', 1, 1)")
    db.run("INSERT INTO folders (id, parent_id, name, created_at, updated_at) VALUES ('child', 'root', 'Child', 1, 1)")
    db.run("INSERT INTO requests (id, folder_id, name, created_at, updated_at) VALUES ('r1', 'child', 'Req', 1, 1)")
    db.run("DELETE FROM folders WHERE id = 'root'")
    expect(scalar(db, 'SELECT COUNT(*) FROM folders')).toBe(0)
    expect(scalar(db, 'SELECT COUNT(*) FROM requests')).toBe(0)
  })

  it('rejects requests that reference a missing folder', () => {
    const db = freshDb()
    expect(() => db.run("INSERT INTO requests (id, folder_id, name, created_at, updated_at) VALUES ('r', 'nope', 'x', 1, 1)")).toThrow()
  })

  it('cascades environment deletes to env_vars', () => {
    const db = freshDb()
    db.run("INSERT INTO environments (id, name, created_at, updated_at) VALUES ('e1', 'Dev', 1, 1)")
    db.run("INSERT INTO env_vars (id, env_id, key) VALUES ('v1', 'e1', 'HOST')")
    db.run("DELETE FROM environments WHERE id = 'e1'")
    expect(scalar(db, 'SELECT COUNT(*) FROM env_vars')).toBe(0)
  })

  it('defaults integrations to disconnected on branch main', () => {
    const db = freshDb()
    db.run("INSERT INTO integrations (id, type, name, base_url, created_at, updated_at) VALUES ('i1', 'git', 'G', 'https://x', 1, 1)")
    expect(scalar(db, "SELECT status FROM integrations WHERE id = 'i1'")).toBe('disconnected')
    expect(scalar(db, "SELECT branch FROM integrations WHERE id = 'i1'")).toBe('main')
  })
})
