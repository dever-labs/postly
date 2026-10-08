import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const state = { dir: '' , available: false }

vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  safeStorage: {
    isEncryptionAvailable: () => state.available,
    encryptString: (s: string) => Buffer.from('enc:' + s),
    decryptString: (b: Buffer) => b.toString().replace(/^enc:/, '')
  }
}))

import { initDatabase, run, queryOne, schedulePersist, flushPersist, quarantineUnreadableDatabase } from '../index'

const dirs: string[] = []
beforeEach(() => {
  state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postly-db-'))
  state.available = false
  dirs.push(state.dir)
})
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })))

describe('database lifecycle', () => {
  it('flushPersist writes a pending debounced save immediately', async () => {
    await initDatabase()
    const file = path.join(state.dir, 'postly.db')
    const before = fs.statSync(file).mtimeMs
    await new Promise((r) => setTimeout(r, 20))
    run(`INSERT INTO settings (key, value) VALUES ('k', 'v') ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    schedulePersist(60_000)
    flushPersist()
    expect(fs.statSync(file).mtimeMs).toBeGreaterThanOrEqual(before)
    await initDatabase()
    expect(queryOne<{ value: string }>(`SELECT value FROM settings WHERE key = 'k'`)?.value).toBe('v')
  })

  it('flushPersist is a no-op when nothing is pending', async () => {
    await initDatabase()
    expect(() => flushPersist()).not.toThrow()
  })

  it('refuses to open an encrypted database when the keychain is unavailable, and can quarantine it', async () => {
    state.available = true
    await initDatabase()
    run(`INSERT INTO settings (key, value) VALUES ('k', 'secret')`)
    state.available = false
    fs.writeFileSync(path.join(state.dir, 'postly.key'), 'x')
    await expect(initDatabase()).rejects.toThrow(/keychain/)

    const moved = quarantineUnreadableDatabase()
    expect(moved).toMatch(/postly\.db\.unreadable-/)
    expect(fs.existsSync(moved as string)).toBe(true)
    expect(fs.existsSync(path.join(state.dir, 'postly.db'))).toBe(false)
    expect(fs.readdirSync(state.dir).some((f) => f.startsWith('postly.key.unreadable-'))).toBe(true)

    await initDatabase()
    expect(queryOne(`SELECT value FROM settings WHERE key = 'k'`)).toBeNull()
  })

  it('migrates legacy columns without error on a fresh database', async () => {
    await expect(initDatabase()).resolves.toBeUndefined()
  })

  it('skips the startup rewrite for an up-to-date encrypted database', async () => {
    state.available = true
    await initDatabase()
    const file = path.join(state.dir, 'postly.db')
    const old = new Date(Date.now() - 60_000)
    fs.utimesSync(file, old, old)
    await initDatabase()
    expect(fs.statSync(file).mtimeMs).toBeLessThan(Date.now() - 30_000)
  })

  it('rewrites a legacy plaintext database on startup so it gets encrypted', async () => {
    await initDatabase()
    state.available = true
    await initDatabase()
    expect(fs.readFileSync(path.join(state.dir, 'postly.db')).subarray(0, 6).toString()).not.toBe('SQLite')
  })
})
