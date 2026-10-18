import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
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

import {
  initDatabase,
  run,
  runDraft,
  queryOne,
  schedulePersist,
  flushPersist,
  quarantineUnreadableDatabase,
  PERSIST_DEBOUNCE_MS,
  runTransaction,
  installPersistFlushHandlers,
} from '../index'

const dirs: string[] = []
beforeEach(() => {
  state.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postly-db-'))
  state.available = false
  dirs.push(state.dir)
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })))

describe('database lifecycle', () => {
  it('flushPersist writes a pending debounced save immediately', async () => {
    await initDatabase()
    const file = path.join(state.dir, 'postly.db')
    const before = fs.statSync(file).mtimeMs
    await new Promise((r) => setTimeout(r, 20))
    runDraft(`INSERT INTO settings (key, value) VALUES ('k', 'v') ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    schedulePersist(60_000)
    flushPersist()
    expect(fs.statSync(file).mtimeMs).toBeGreaterThanOrEqual(before)
    await initDatabase()
    expect(queryOne<{ value: string }>(`SELECT value FROM settings WHERE key = 'k'`)?.value).toBe('v')
  })

  it('persists user-initiated writes immediately', async () => {
    await initDatabase()
    const writeSpy = vi.spyOn(fs, 'writeFileSync')
    const renameSpy = vi.spyOn(fs, 'renameSync')

    run(`INSERT INTO settings (key, value) VALUES ('a', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value`)

    expect(writeSpy).toHaveBeenCalledOnce()
    expect(renameSpy).toHaveBeenCalledOnce()
  })

  it('coalesces bursts of draft writes into one persisted export', async () => {
    vi.useFakeTimers()
    await initDatabase()
    const writeSpy = vi.spyOn(fs, 'writeFileSync')
    const renameSpy = vi.spyOn(fs, 'renameSync')

    runDraft(`INSERT INTO settings (key, value) VALUES ('a', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    runDraft(`INSERT INTO settings (key, value) VALUES ('b', '2') ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    runDraft(`INSERT INTO settings (key, value) VALUES ('c', '3') ON CONFLICT(key) DO UPDATE SET value = excluded.value`)

    expect(writeSpy).not.toHaveBeenCalled()
    expect(renameSpy).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE_MS)

    expect(writeSpy).toHaveBeenCalledOnce()
    expect(renameSpy).toHaveBeenCalledOnce()
  })

  it('persists once after a committed transaction', async () => {
    await initDatabase()
    const writeSpy = vi.spyOn(fs, 'writeFileSync')

    runTransaction([
      { sql: `INSERT INTO settings (key, value) VALUES ('a', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value` },
      { sql: `INSERT INTO settings (key, value) VALUES ('b', '2') ON CONFLICT(key) DO UPDATE SET value = excluded.value` },
    ])

    expect(writeSpy).toHaveBeenCalledOnce()
  })

  it('logs debounced persist errors instead of throwing from the timer', async () => {
    vi.useFakeTimers()
    await initDatabase()
    const error = new Error('disk full')
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw error })
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    runDraft(`INSERT INTO settings (key, value) VALUES ('a', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value`)

    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE_MS)
    expect(logSpy).toHaveBeenCalledWith('Failed to persist database:', error)
  })

  it('flushes pending writes for SIGTERM, SIGINT, and uncaughtException handlers', async () => {
    const signals: Partial<Record<'SIGTERM' | 'SIGINT', () => void>> = {}
    let uncaught: ((error: unknown) => void) | undefined
    const flush = vi.fn()
    const exit = vi.fn()
    const log = vi.fn()

    installPersistFlushHandlers({
      onSignal: (signal, handler) => { signals[signal] = handler },
      onUncaughtException: (handler) => { uncaught = handler },
      flush,
      exit,
      log,
    })

    signals.SIGTERM?.()
    signals.SIGINT?.()
    uncaught?.(new Error('boom'))

    expect(flush).toHaveBeenCalledTimes(3)
    expect(exit).toHaveBeenNthCalledWith(1, 143)
    expect(exit).toHaveBeenNthCalledWith(2, 130)
    expect(exit).toHaveBeenNthCalledWith(3, 1)
    expect(log).toHaveBeenCalledWith('Uncaught exception in main process:', expect.any(Error))
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
