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
  persistDb()
}

function runMigrations(): void {
  for (const sql of migrations) {
    db.run(sql)
  }
}

/** Flush the in-memory DB to disk. Call after every write. */
export function persistDb(): void {
  if (!db || !dbPath) return
  const data = db.export()
  fs.writeFileSync(dbPath, Buffer.from(data))
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

/** Execute an INSERT / UPDATE / DELETE statement. Persists to disk. */
export function run(sql: string, params?: unknown[]): void {
  db.run(sql, params as Parameters<typeof db.run>[1])
  persistDb()
}
