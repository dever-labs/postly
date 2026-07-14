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
  db.run(`
    WITH RECURSIVE folder_root AS (
      SELECT id, parent_id, id AS root_id FROM folders
      UNION ALL
      SELECT fr.id, parent.parent_id, parent.id AS root_id
      FROM folder_root fr
      JOIN folders parent ON parent.id = fr.parent_id
    )
    UPDATE requests
    SET is_dirty = 0
    WHERE folder_id IN (
      SELECT DISTINCT fr.id
      FROM folder_root fr
      JOIN folders root ON root.id = fr.root_id
      WHERE fr.parent_id IS NULL
        AND root.source NOT IN ('git', 'github', 'gitlab')
    )
  `)
  persistDb()
}

function tableExists(table: string): boolean {
  const result = db.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '${table.replace(/'/g, "''")}'`)
  return (result[0]?.values.length ?? 0) > 0
}

function hasColumn(table: string, col: string): boolean {
  if (!tableExists(table)) return false
  const result = db.exec(`SELECT name FROM pragma_table_info('${table.replace(/'/g, "''")}') WHERE name = '${col.replace(/'/g, "''")}'`)
  return (result[0]?.values.length ?? 0) > 0
}

function recreateDraftTables(): void {
  db.run('PRAGMA foreign_keys = OFF')
  try {
    if (tableExists('collection_drafts')) {
      db.run(`CREATE TABLE collection_drafts_v2 (
        collection_id TEXT PRIMARY KEY REFERENCES folders(id) ON DELETE CASCADE,
        name TEXT, description TEXT,
        auth_type TEXT, auth_config TEXT, ssl_verification TEXT,
        updated_at INTEGER NOT NULL
      )`)
      db.run(`
        INSERT OR REPLACE INTO collection_drafts_v2
          (collection_id, name, description, auth_type, auth_config, ssl_verification, updated_at)
        SELECT collection_id, name, description, auth_type, auth_config, ssl_verification, updated_at
        FROM collection_drafts
      `)
      db.run('DROP TABLE collection_drafts')
      db.run('ALTER TABLE collection_drafts_v2 RENAME TO collection_drafts')
    } else {
      db.run(`CREATE TABLE IF NOT EXISTS collection_drafts (
        collection_id TEXT PRIMARY KEY REFERENCES folders(id) ON DELETE CASCADE,
        name TEXT, description TEXT,
        auth_type TEXT, auth_config TEXT, ssl_verification TEXT,
        updated_at INTEGER NOT NULL
      )`)
    }

    if (tableExists('group_drafts')) {
      db.run(`CREATE TABLE group_drafts_v2 (
        group_id TEXT PRIMARY KEY REFERENCES folders(id) ON DELETE CASCADE,
        name TEXT, description TEXT,
        auth_type TEXT, auth_config TEXT, ssl_verification TEXT,
        updated_at INTEGER NOT NULL
      )`)
      db.run(`
        INSERT OR REPLACE INTO group_drafts_v2
          (group_id, name, description, auth_type, auth_config, ssl_verification, updated_at)
        SELECT group_id, name, description, auth_type, auth_config, ssl_verification, updated_at
        FROM group_drafts
      `)
      db.run('DROP TABLE group_drafts')
      db.run('ALTER TABLE group_drafts_v2 RENAME TO group_drafts')
    } else {
      db.run(`CREATE TABLE IF NOT EXISTS group_drafts (
        group_id TEXT PRIMARY KEY REFERENCES folders(id) ON DELETE CASCADE,
        name TEXT, description TEXT,
        auth_type TEXT, auth_config TEXT, ssl_verification TEXT,
        updated_at INTEGER NOT NULL
      )`)
    }
  } finally {
    db.run('PRAGMA foreign_keys = ON')
  }
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
  try { db.run("ALTER TABLE collections ADD COLUMN auth_config TEXT DEFAULT '{}'" ) } catch {}
  // Groups: add auth columns (description already exists)
  try { db.run("ALTER TABLE groups ADD COLUMN auth_type TEXT DEFAULT 'none'") } catch {}
  try { db.run("ALTER TABLE groups ADD COLUMN auth_config TEXT DEFAULT '{}'" ) } catch {}
  try { db.run("ALTER TABLE groups ADD COLUMN ssl_verification TEXT DEFAULT 'inherit'") } catch {}
  // Collections ssl
  try { db.run("ALTER TABLE collections ADD COLUMN ssl_verification TEXT DEFAULT 'inherit'") } catch {}
  // Requests ssl
  try { db.run("ALTER TABLE requests ADD COLUMN ssl_verification TEXT DEFAULT 'inherit'") } catch {}
  // Requests protocol support
  try { db.run("ALTER TABLE requests ADD COLUMN protocol TEXT NOT NULL DEFAULT 'http'") } catch {}
  try { db.run("ALTER TABLE requests ADD COLUMN protocol_config TEXT NOT NULL DEFAULT '{}'" ) } catch {}
  // Collections collapsed state
  try { db.run('ALTER TABLE collections ADD COLUMN collapsed INTEGER NOT NULL DEFAULT 0') } catch {}
  // Integrations ssl verification
  try { db.run("ALTER TABLE integrations ADD COLUMN ssl_verification TEXT NOT NULL DEFAULT 'enabled'") } catch {}

  db.run(`CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    source TEXT NOT NULL DEFAULT 'local',
    source_meta TEXT,
    integration_id TEXT REFERENCES integrations(id),
    auth_type TEXT NOT NULL DEFAULT 'none',
    auth_config TEXT NOT NULL DEFAULT '{}',
    ssl_verification TEXT NOT NULL DEFAULT 'inherit',
    hidden INTEGER NOT NULL DEFAULT 0,
    collapsed INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`)

  if (tableExists('collections')) {
    db.run(`
      INSERT OR IGNORE INTO folders
      SELECT
        id,
        NULL AS parent_id,
        name,
        COALESCE(description, ''),
        source,
        source_meta,
        integration_id,
        COALESCE(auth_type, 'none'),
        COALESCE(auth_config, '{}'),
        COALESCE(ssl_verification, 'inherit'),
        0,
        COALESCE(collapsed, 0),
        0,
        created_at,
        updated_at
      FROM collections
    `)
  }

  if (tableExists('groups')) {
    db.run(`
      INSERT OR IGNORE INTO folders
      SELECT
        id,
        collection_id AS parent_id,
        name,
        COALESCE(description, ''),
        'local',
        NULL,
        NULL,
        COALESCE(auth_type, 'none'),
        COALESCE(auth_config, '{}'),
        COALESCE(ssl_verification, 'inherit'),
        hidden,
        collapsed,
        sort_order,
        created_at,
        updated_at
      FROM groups
    `)
  }

  if (!hasColumn('requests', 'folder_id') && hasColumn('requests', 'group_id')) {
    db.run('PRAGMA foreign_keys = OFF')
    try {
      db.run(`CREATE TABLE requests_v2 (
        id TEXT PRIMARY KEY,
        folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        method TEXT NOT NULL DEFAULT 'GET',
        url TEXT NOT NULL DEFAULT '',
        params TEXT NOT NULL DEFAULT '[]',
        headers TEXT NOT NULL DEFAULT '[]',
        body_type TEXT NOT NULL DEFAULT 'none',
        body_content TEXT NOT NULL DEFAULT '',
        auth_type TEXT NOT NULL DEFAULT 'none',
        auth_config TEXT NOT NULL DEFAULT '{}',
        description TEXT,
        scm_path TEXT,
        scm_sha TEXT,
        is_dirty INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        ssl_verification TEXT NOT NULL DEFAULT 'inherit',
        protocol TEXT NOT NULL DEFAULT 'http',
        protocol_config TEXT NOT NULL DEFAULT '{}'
      )`)
      db.run(`
        INSERT INTO requests_v2
          (id, folder_id, name, method, url, params, headers, body_type, body_content,
           auth_type, auth_config, description, scm_path, scm_sha, is_dirty, sort_order,
           created_at, updated_at, ssl_verification, protocol, protocol_config)
        SELECT
          id, group_id AS folder_id, name, method, url, params, headers, body_type, body_content,
          auth_type, auth_config, description, scm_path, scm_sha, is_dirty, sort_order,
          created_at, updated_at,
          COALESCE(ssl_verification, 'inherit'),
          COALESCE(protocol, 'http'),
          COALESCE(protocol_config, '{}')
        FROM requests
      `)
      db.run('DROP TABLE requests')
      db.run('ALTER TABLE requests_v2 RENAME TO requests')
    } finally {
      db.run('PRAGMA foreign_keys = ON')
    }
  }

  // Remove FK constraint from tokens so inline OAuth tokens (keyed by config hash,
  // not by an oauth_configs row) can be persisted across restarts.
  const tokensFkList = db.exec('PRAGMA foreign_key_list(tokens)')
  const tokensFkToOauthConfigs = tokensFkList.length > 0 &&
    tokensFkList[0].values.some((row) => row[2] === 'oauth_configs')
  if (tokensFkToOauthConfigs) {
    db.run('PRAGMA foreign_keys = OFF')
    try {
      db.run(`CREATE TABLE tokens_v2 (
        id TEXT PRIMARY KEY,
        oauth_config_id TEXT NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT,
        token_type TEXT NOT NULL DEFAULT 'Bearer',
        expires_at INTEGER,
        scope TEXT,
        created_at INTEGER NOT NULL
      )`)
      db.run('INSERT OR IGNORE INTO tokens_v2 SELECT * FROM tokens')
      db.run('DROP TABLE tokens')
      db.run('ALTER TABLE tokens_v2 RENAME TO tokens')
    } finally {
      db.run('PRAGMA foreign_keys = ON')
    }
  }

  // Draft cache tables (Issue #14) — changes are auto-saved here until explicit save
  db.run(`CREATE TABLE IF NOT EXISTS request_drafts (
    request_id TEXT PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
    method TEXT, url TEXT, params TEXT, headers TEXT,
    body_type TEXT, body_content TEXT,
    auth_type TEXT, auth_config TEXT,
    ssl_verification TEXT, protocol TEXT, protocol_config TEXT,
    updated_at INTEGER NOT NULL
  )`)
  recreateDraftTables()
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
 * Execute multiple write statements inside a single SQLite transaction.
 * Unlike calling `run` multiple times, this does NOT call `persistDb()` between
 * statements — it calls it exactly once after a successful COMMIT.
 * Rolls back automatically on error.
 */
export function runTransaction(statements: Array<{ sql: string; params?: unknown[] }>): void {
  db.run('BEGIN TRANSACTION')
  try {
    for (const { sql, params } of statements) {
      db.run(sql, params as Parameters<typeof db.run>[1])
    }
    db.run('COMMIT')
  } catch (err) {
    try { db.run('ROLLBACK') } catch { /* ignore rollback errors */ }
    throw err
  }
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
