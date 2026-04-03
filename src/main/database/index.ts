import initSqlJs, { Database, SqlJsStatic } from 'sql.js'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { migrations } from './migrations'

let db: Database
let SQL: SqlJsStatic
let dbPath: string

export async function initDatabase(): Promise<void> {
  dbPath = path.join(app.getPath('userData'), 'postly.db')

  // Locate the WASM file next to the sql.js JS module
  const sqlJsDir = path.dirname(require.resolve('sql.js'))
  SQL = await initSqlJs({ locateFile: (f) => path.join(sqlJsDir, f) })

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath)
    db = new SQL.Database(fileBuffer)
  } else {
    db = new SQL.Database()
  }

  db.run('PRAGMA foreign_keys = ON')
  runMigrations()
  // is_dirty for local requests is an in-session editor flag — reset on startup.
  // Git-sourced requests keep is_dirty as "uncommitted to git" across restarts.
  db.run(`UPDATE requests SET is_dirty = 0 WHERE group_id IN (
    SELECT g.id FROM groups g
    JOIN collections c ON c.id = g.collection_id
    WHERE c.source NOT IN ('git', 'github', 'gitlab')
  )`)
  persistDb()
}

function runMigrations(): void {
  for (const sql of migrations) {
    db.run(sql)
  }
  // Add integration_id to collections if not already present (ignore if column already exists)
  try {
    db.run('ALTER TABLE collections ADD COLUMN integration_id TEXT REFERENCES integrations(id)')
  } catch {
    // column already exists, ignore
  }
  // Collections: add description, auth_type, auth_config
  try { db.run("ALTER TABLE collections ADD COLUMN description TEXT DEFAULT ''") } catch {}
  try { db.run("ALTER TABLE collections ADD COLUMN auth_type TEXT DEFAULT 'none'") } catch {}
  try { db.run("ALTER TABLE collections ADD COLUMN auth_config TEXT DEFAULT '{}'") } catch {}
  // Groups: add auth columns (description already exists)
  try { db.run("ALTER TABLE groups ADD COLUMN auth_type TEXT DEFAULT 'none'") } catch {}
  try { db.run("ALTER TABLE groups ADD COLUMN auth_config TEXT DEFAULT '{}'") } catch {}
  try { db.run("ALTER TABLE groups ADD COLUMN ssl_verification TEXT DEFAULT 'inherit'") } catch {}
  // Collections ssl
  try { db.run("ALTER TABLE collections ADD COLUMN ssl_verification TEXT DEFAULT 'inherit'") } catch {}
  // Requests ssl
  try { db.run("ALTER TABLE requests ADD COLUMN ssl_verification TEXT DEFAULT 'inherit'") } catch {}
  // Requests protocol support
  try { db.run("ALTER TABLE requests ADD COLUMN protocol TEXT NOT NULL DEFAULT 'http'") } catch {}
  try { db.run("ALTER TABLE requests ADD COLUMN protocol_config TEXT NOT NULL DEFAULT '{}'") } catch {}
  // Collections collapsed state
  try { db.run('ALTER TABLE collections ADD COLUMN collapsed INTEGER NOT NULL DEFAULT 0') } catch {}
  // Draft cache tables (Issue #14) — changes are auto-saved here until explicit save
  db.run(`CREATE TABLE IF NOT EXISTS request_drafts (
    request_id TEXT PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
    method TEXT, url TEXT, params TEXT, headers TEXT,
    body_type TEXT, body_content TEXT,
    auth_type TEXT, auth_config TEXT,
    ssl_verification TEXT, protocol TEXT, protocol_config TEXT,
    updated_at INTEGER NOT NULL
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS collection_drafts (
    collection_id TEXT PRIMARY KEY REFERENCES collections(id) ON DELETE CASCADE,
    name TEXT, description TEXT,
    auth_type TEXT, auth_config TEXT, ssl_verification TEXT,
    updated_at INTEGER NOT NULL
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS group_drafts (
    group_id TEXT PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
    name TEXT, description TEXT,
    auth_type TEXT, auth_config TEXT, ssl_verification TEXT,
    updated_at INTEGER NOT NULL
  )`)
  db.run(`CREATE TABLE IF NOT EXISTS env_drafts (
    env_id TEXT PRIMARY KEY REFERENCES environments(id) ON DELETE CASCADE,
    vars_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`)
}

/** Flush the in-memory DB to disk. Call after every write. */
export function persistDb(): void {
  if (!db || !dbPath) return
  const data = db.export()
  fs.writeFileSync(dbPath, Buffer.from(data))
}

let deferredPersistTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Schedule a debounced persist (2 s). Use for high-frequency writes such as
 * draft auto-saves where an immediate full-DB flush on every keystroke would
 * cause excessive synchronous disk I/O.
 */
export function schedulePersist(delayMs = 2000): void {
  if (deferredPersistTimer) clearTimeout(deferredPersistTimer)
  deferredPersistTimer = setTimeout(() => {
    deferredPersistTimer = null
    persistDb()
  }, delayMs)
}

export function getDb(): Database {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.')
  return db
}

/** Execute a SELECT and return all rows as typed objects. */
export function queryAll<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] {
  const stmt = db.prepare(sql)
  if (params?.length) stmt.bind(params as Parameters<typeof stmt.bind>[0])
  const results: T[] = []
  while (stmt.step()) results.push(stmt.getAsObject() as T)
  stmt.free()
  return results
}

/** Execute a SELECT and return the first row, or null. */
export function queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | null {
  const stmt = db.prepare(sql)
  if (params?.length) stmt.bind(params as Parameters<typeof stmt.bind>[0])
  const result = stmt.step() ? (stmt.getAsObject() as T) : null
  stmt.free()
  return result
}

/** Execute an INSERT / UPDATE / DELETE statement. Persists to disk immediately. */
export function run(sql: string, params?: unknown[]): void {
  db.run(sql, params as Parameters<typeof db.run>[1])
  persistDb()
}

/**
 * Execute an INSERT / UPDATE / DELETE and schedule a debounced persist.
 * Use for draft upserts that fire on every keystroke to avoid frequent full-DB flushes.
 */
export function runDraft(sql: string, params?: unknown[]): void {
  db.run(sql, params as Parameters<typeof db.run>[1])
  schedulePersist()
}
