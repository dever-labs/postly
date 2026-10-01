import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const state = { dir: fs.mkdtempSync(path.join(os.tmpdir(), 'postly-crypto-')), available: true }

vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  safeStorage: {
    isEncryptionAvailable: () => state.available,
    encryptString: (s: string) => Buffer.from('enc:' + s),
    decryptString: (b: Buffer) => b.toString().replace(/^enc:/, '')
  }
}))

import { encryptDb, decryptDb, isEncrypted } from '../db-crypto'

const plain = Buffer.from('SQLite format 3\0 secret-token-123')

beforeEach(() => {
  state.available = true
  fs.rmSync(path.join(state.dir, 'postly.key'), { force: true })
})
afterAll(() => fs.rmSync(state.dir, { recursive: true, force: true }))

describe('db-crypto', () => {
  it('round-trips and does not leak plaintext', () => {
    const enc = encryptDb(plain)
    expect(isEncrypted(enc)).toBe(true)
    expect(enc.includes('secret-token-123')).toBe(false)
    expect(decryptDb(enc).equals(plain)).toBe(true)
  })

  it('uses a fresh IV per write', () => {
    expect(encryptDb(plain).equals(encryptDb(plain))).toBe(false)
  })

  it('passes legacy plaintext through unchanged', () => {
    expect(decryptDb(plain).equals(plain)).toBe(true)
  })

  it('falls back to plaintext when the keychain is unavailable', () => {
    state.available = false
    expect(encryptDb(plain).equals(plain)).toBe(true)
  })

  it('refuses to open an encrypted file without a keychain', () => {
    const enc = encryptDb(plain)
    state.available = false
    expect(() => decryptDb(enc)).toThrow(/keychain/)
  })

  it('detects tampering', () => {
    const enc = encryptDb(plain)
    enc[enc.length - 1] ^= 1
    expect(() => decryptDb(enc)).toThrow()
  })
})
