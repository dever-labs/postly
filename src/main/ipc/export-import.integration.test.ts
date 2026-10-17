import crypto from 'node:crypto'
import http from 'node:http'
import path from 'node:path'
import initSqlJs, { type Database } from 'sql.js'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostlyExportFile } from './export-import'

const handlers: Record<string, (event: unknown, args: unknown) => Promise<unknown> | unknown> = {}

let SQL: Awaited<ReturnType<typeof initSqlJs>>
let db: Database

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, args: unknown) => Promise<unknown> | unknown) => {
      handlers[channel] = handler
    }),
  },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  dialog: {},
}))

vi.mock('../database', () => ({
  queryAll: (sql: string, params: unknown[] = []) => {
    const stmt = db.prepare(sql)
    stmt.bind(params as never)
    const rows: Array<Record<string, unknown>> = []
    while (stmt.step()) rows.push(stmt.getAsObject())
    stmt.free()
    return rows
  },
  runTransaction: (statements: Array<{ sql: string; params?: unknown[] }>) => {
    db.run('BEGIN TRANSACTION')
    try {
      for (const statement of statements) db.run(statement.sql, statement.params as never)
      db.run('COMMIT')
    } catch (error) {
      db.run('ROLLBACK')
      throw error
    }
  },
}))

import { importData, registerExportImportHandlers } from './export-import'

function invoke(channel: string, args: unknown) {
  return Promise.resolve(handlers[channel]({ sender: {} }, args)) as Promise<Record<string, unknown>>
}

function createSchema(database: Database): void {
  database.run('PRAGMA foreign_keys = ON')
  database.run(`CREATE TABLE folders (
    id TEXT PRIMARY KEY,
    parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    source TEXT NOT NULL DEFAULT 'local',
    source_meta TEXT,
    integration_id TEXT,
    auth_type TEXT NOT NULL DEFAULT 'none',
    auth_config TEXT NOT NULL DEFAULT '{}',
    ssl_verification TEXT NOT NULL DEFAULT 'inherit',
    network_settings TEXT,
    hidden INTEGER NOT NULL DEFAULT 0,
    collapsed INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`)
  database.run(`CREATE TABLE requests (
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
    ssl_verification TEXT NOT NULL DEFAULT 'inherit',
    protocol TEXT NOT NULL DEFAULT 'http',
    protocol_config TEXT NOT NULL DEFAULT '{}',
    description TEXT,
    network_settings TEXT,
    is_dirty INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`)
  database.run(`CREATE TABLE variables (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    owner_id TEXT NOT NULL DEFAULT '',
    key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    is_secret INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE (scope, owner_id, key)
  )`)
  database.run(`CREATE TABLE environments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`)
  database.run(`CREATE TABLE env_vars (
    id TEXT PRIMARY KEY,
    env_id TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    is_secret INTEGER NOT NULL DEFAULT 0
  )`)
}

async function withServer(
  handler: http.RequestListener,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not read listening address')
  const baseUrl = `http://127.0.0.1:${address.port}`

  try {
    await run(baseUrl)
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  }
}

function rows<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): T[] {
  const stmt = db.prepare(sql)
  stmt.bind(params as never)
  const out: T[] = []
  while (stmt.step()) out.push(stmt.getAsObject() as T)
  stmt.free()
  return out
}

function count(table: 'folders' | 'requests' | 'variables' | 'environments' | 'env_vars'): number {
  return Number(rows<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}`)[0]?.c ?? 0)
}

const baseRequest = {
  name: 'Get Users',
  method: 'GET',
  url: '/users',
  protocol: 'http',
  params: [],
  headers: [],
  bodyType: 'none',
  bodyContent: '',
  auth: { type: 'none', config: {} },
  ssl: 'inherit',
  description: '',
  protocolConfig: {},
}

function makeFile(overrides: Partial<PostlyExportFile> = {}): PostlyExportFile {
  return {
    $schema: 'postly/v1',
    exportedAt: new Date().toISOString(),
    collections: [
      {
        name: 'Imported API',
        description: 'desc',
        source: 'local',
        auth: { type: 'none', config: {} },
        ssl: 'inherit',
        variables: [{ key: 'base_url', value: 'https://api.example.test', isSecret: false }],
        requests: [{ ...baseRequest }],
        folders: [],
      },
    ],
    ...overrides,
  }
}

beforeAll(async () => {
  SQL = await initSqlJs({ locateFile: (file) => path.join(path.dirname(require.resolve('sql.js')), file) })
})

beforeEach(() => {
  db = new SQL.Database()
  createSchema(db)
  for (const key of Object.keys(handlers)) delete handlers[key]
  vi.clearAllMocks()
  registerExportImportHandlers()
})

describe('export/import IPC parsing handlers', () => {
  it('parses import text through postly:import:parse', async () => {
    const postman = JSON.stringify({
      info: {
        name: 'Parsed through IPC',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [
        {
          name: 'Ping',
          request: {
            method: 'GET',
            url: 'https://api.example.com/ping',
          },
        },
      ],
    })

    const result = await invoke('postly:import:parse', { text: postman })

    expect(result).toEqual({
      data: expect.objectContaining({
        format: 'postman',
        collections: [expect.objectContaining({ requests: 1, collection: expect.objectContaining({ name: 'Parsed through IPC' }) })],
      }),
    })
  })

  it('parses Bruno folders through postly:import:parse-folder', async () => {
    const result = await invoke('postly:import:parse-folder', {
      files: [
        {
          path: 'picked/bruno.json',
          text: JSON.stringify({ name: 'Picked by IPC' }),
        },
        {
          path: 'picked/request.bru',
          text: `meta {
  name: IPC request
  type: http
}

get {
  url: https://example.com/items
}
`,
        },
      ],
    })

    expect(result).toEqual({
      data: expect.objectContaining({
        format: 'bruno',
        collections: [expect.objectContaining({ requests: 1, collection: expect.objectContaining({ name: 'Picked by IPC' }) })],
      }),
    })
  })

  it('validates malformed parse arguments', async () => {
    await expect(invoke('postly:import:parse', { text: 123 })).resolves.toEqual({ error: 'No file content provided.' })
    await expect(invoke('postly:import:parse-folder', { files: 'nope' })).resolves.toEqual({ error: 'No files provided.' })
    await expect(invoke('postly:import:parse-folder', { files: [{ text: 'x' }] })).resolves.toEqual({ error: 'Each file must include string path and text.' })
    await expect(invoke('postly:import:parse-folder', { files: [{ path: 'picked/request.bru', text: 42 }] })).resolves.toEqual({ error: 'Each file must include string path and text.' })
  })
})

describe('importData integration', () => {
  it('imports collections and environments together, cleaning variables and keeping imported environments inactive', () => {
    db.run("INSERT INTO environments (id, name, is_active, created_at, updated_at) VALUES ('existing-prod', 'Prod', 1, 1, 1)")

    const countImported = importData(makeFile({
      collections: [
        {
          name: 'Imported API',
          description: 'desc',
          source: 'local',
          auth: { type: 'none', config: {} },
          ssl: 'inherit',
          variables: [{ key: 'base_url', value: 'https://api.example.test', isSecret: false }],
          requests: [{ ...baseRequest }],
          folders: [],
          environments: [
            {
              name: '  Prod  ',
              variables: [
                { key: '', value: 'skip', isSecret: false },
                { key: '{{bad}}', value: 'skip', isSecret: false },
                { key: 'host', value: 'https://one.example.test', isSecret: false },
                { key: ' host ', value: 'https://two.example.test', isSecret: false },
                { key: 'token', value: 'secret-token', isSecret: true },
              ],
            },
            {
              name: 'Prod',
              variables: [{ key: 'region', value: 'eu-west-1', isSecret: false }],
            },
          ],
        },
        {
          name: 'Without Environments',
          description: '',
          source: 'local',
          auth: { type: 'none', config: {} },
          ssl: 'inherit',
          requests: [],
          folders: [],
        },
      ],
    }))

    expect(countImported).toBe(2)
    expect(count('folders')).toBe(2)
    expect(count('requests')).toBe(1)
    expect(count('variables')).toBe(1)
    expect(count('environments')).toBe(3)
    expect(count('env_vars')).toBe(3)

    expect(rows<{ name: string }>('SELECT name FROM environments ORDER BY name ASC').map((row) => row.name)).toEqual([
      'Prod',
      'Prod (2)',
      'Prod (3)',
    ])

    expect(rows<{ name: string }>('SELECT name FROM environments WHERE is_active = 1')).toEqual([{ name: 'Prod' }])
    expect(rows<{ name: string; is_active: number }>(
      "SELECT name, is_active FROM environments WHERE name != 'Prod' ORDER BY name ASC",
    )).toEqual([
      { name: 'Prod (2)', is_active: 0 },
      { name: 'Prod (3)', is_active: 0 },
    ])

    expect(rows<{ key: string; value: string; is_secret: number }>(
      `SELECT env_vars.key, env_vars.value, env_vars.is_secret
       FROM env_vars
       JOIN environments ON environments.id = env_vars.env_id
       WHERE environments.name = 'Prod (2)'
       ORDER BY env_vars.key ASC`,
    )).toEqual([
      { key: 'host', value: 'https://two.example.test', is_secret: 0 },
      { key: 'token', value: 'secret-token', is_secret: 1 },
    ])

    expect(rows<{ key: string; value: string; is_secret: number }>(
      `SELECT env_vars.key, env_vars.value, env_vars.is_secret
       FROM env_vars
       JOIN environments ON environments.id = env_vars.env_id
       WHERE environments.name = 'Prod (3)'`,
    )).toEqual([
      { key: 'region', value: 'eu-west-1', is_secret: 0 },
    ])
  })

  it('rolls back collections, collection variables, environments, and environment variables when a later statement fails', () => {
    const ids = ['collection-1', 'collection-var-1', 'request-1', 'environment-1', 'env-var-1', 'env-var-1']
    const uuidSpy = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      const next = ids.shift()
      if (!next) throw new Error('Ran out of deterministic UUIDs')
      return next as `${string}-${string}-${string}-${string}-${string}`
    })

    const file = makeFile({
      collections: [
        {
          name: 'Atomic Import',
          description: '',
          source: 'local',
          auth: { type: 'none', config: {} },
          ssl: 'inherit',
          variables: [{ key: 'base_url', value: 'https://api.example.test', isSecret: false }],
          requests: [{ ...baseRequest }],
          folders: [],
          environments: [
            {
              name: 'Rollback Env',
              variables: [
                { key: 'token', value: 'a', isSecret: true },
                { key: 'host', value: 'https://rollback.example.test', isSecret: false },
              ],
            },
          ],
        },
      ],
    })

    try {
      expect(() => importData(file)).toThrow(/UNIQUE|constraint/i)
    } finally {
      uuidSpy.mockRestore()
    }

    expect(count('folders')).toBe(0)
    expect(count('requests')).toBe(0)
    expect(count('variables')).toBe(0)
    expect(count('environments')).toBe(0)
    expect(count('env_vars')).toBe(0)
  })

  it('ignores missing environments arrays entirely', () => {
    importData(makeFile({
      collections: [
        {
          name: 'No Environments',
          description: '',
          source: 'local',
          auth: { type: 'none', config: {} },
          ssl: 'inherit',
          requests: [{ ...baseRequest }],
          folders: [],
        },
      ],
    }))

    expect(count('folders')).toBe(1)
    expect(count('requests')).toBe(1)
    expect(count('environments')).toBe(0)
    expect(count('env_vars')).toBe(0)
  })
})

describe('export/import IPC network and validation handlers', () => {
  it('follows redirects and returns the fetched text', async () => {
    await withServer((req, res) => {
      if (req.url === '/redirect') {
        res.statusCode = 302
        res.setHeader('Location', '/openapi.yaml')
        res.end()
        return
      }
      res.setHeader('Content-Type', 'application/yaml')
      res.end('openapi: 3.0.0')
    }, async (baseUrl) => {
      const result = await invoke('postly:import:fetch-url', { url: `${baseUrl}/redirect` })
      expect(result).toEqual({ data: { text: 'openapi: 3.0.0' } })
    })
  })

  it('returns upstream HTTP failures while fetching URLs', async () => {
    await withServer((_req, res) => {
      res.statusCode = 503
      res.statusMessage = 'Service Unavailable'
      res.end('try later')
    }, async (baseUrl) => {
      const result = await invoke('postly:import:fetch-url', { url: `${baseUrl}/broken` })
      expect(result).toEqual({ error: 'The server answered 503 Service Unavailable.' })
    })
  })

  it('rejects malformed environments without importing anything', async () => {
    const result = await invoke('postly:import:collections', {
      collections: [
        {
          name: 'Broken import',
          description: '',
          source: 'local',
          auth: { type: 'none', config: {} },
          ssl: 'inherit',
          requests: [],
          folders: [],
          environments: { name: 'Prod', variables: [] },
        },
      ],
    })

    expect(result).toEqual({ error: 'Error: Collection environments must be arrays.' })
    expect(count('folders')).toBe(0)
    expect(count('requests')).toBe(0)
    expect(count('variables')).toBe(0)
    expect(count('environments')).toBe(0)
    expect(count('env_vars')).toBe(0)
  })

  it('rejects malformed environment variables without partial imports', async () => {
    const result = await invoke('postly:import:collections', {
      collections: [
        {
          name: 'Broken variables',
          description: '',
          source: 'local',
          auth: { type: 'none', config: {} },
          ssl: 'inherit',
          requests: [{ ...baseRequest }],
          folders: [],
          environments: [{ name: 'Prod', variables: { token: 'x' } }],
        },
      ],
    })

    expect(result).toEqual({ error: 'Error: Environment variables must be arrays.' })
    expect(count('folders')).toBe(0)
    expect(count('requests')).toBe(0)
    expect(count('variables')).toBe(0)
    expect(count('environments')).toBe(0)
    expect(count('env_vars')).toBe(0)
  })
})
