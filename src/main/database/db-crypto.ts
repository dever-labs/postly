import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { app, safeStorage } from 'electron'

const MAGIC = Buffer.from('POSTLYENC1')
const IV_LEN = 12
const TAG_LEN = 16
const KEY_FILE = 'postly.key'

export function isEncrypted(data: Uint8Array): boolean {
  return data.length > MAGIC.length && Buffer.from(data.subarray(0, MAGIC.length)).equals(MAGIC)
}

/**
 * Returns the data key protected by the OS keychain (safeStorage), creating it
 * on first use. Returns null when OS-level encryption is unavailable.
 */
function getDataKey(): Buffer | null {
  if (!safeStorage.isEncryptionAvailable()) return null
  const keyPath = path.join(app.getPath('userData'), KEY_FILE)
  if (fs.existsSync(keyPath)) {
    const b64 = safeStorage.decryptString(fs.readFileSync(keyPath))
    return Buffer.from(b64, 'base64')
  }
  const key = crypto.randomBytes(32)
  fs.writeFileSync(keyPath, safeStorage.encryptString(key.toString('base64')), { mode: 0o600 })
  return key
}

/** Encrypts the serialized database; falls back to plaintext when no OS keychain is available. */
export function encryptDb(plain: Uint8Array): Buffer {
  const key = getDataKey()
  if (!key) return Buffer.from(plain)
  const iv = crypto.randomBytes(IV_LEN)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body])
}

/** Decrypts an encrypted database file; plaintext (legacy) files pass through unchanged. */
export function decryptDb(file: Buffer): Buffer {
  if (!isEncrypted(file)) return file
  const key = getDataKey()
  if (!key) throw new Error('Postly database is encrypted but the OS keychain is unavailable.')
  const iv = file.subarray(MAGIC.length, MAGIC.length + IV_LEN)
  const tag = file.subarray(MAGIC.length + IV_LEN, MAGIC.length + IV_LEN + TAG_LEN)
  const body = file.subarray(MAGIC.length + IV_LEN + TAG_LEN)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()])
}
