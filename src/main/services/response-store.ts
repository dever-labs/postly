import crypto from 'crypto'

/** Raw response bodies are kept in memory so Save can write them byte-exact without unbounded growth. */
export const RESPONSE_STORE_MAX_TOTAL_BYTES = 128 * 1024 * 1024

export interface StoredBody {
  raw: Buffer
  headers: Record<string, string>
  url: string
}
const entries = new Map<string, StoredBody>()
let totalBytes = 0
let maxTotalBytes = RESPONSE_STORE_MAX_TOTAL_BYTES

function deleteEntry(id: string): void {
  const existing = entries.get(id)
  if (!existing) return
  totalBytes -= existing.raw.byteLength
  entries.delete(id)
}

function trimEntries(): void {
  while (totalBytes > maxTotalBytes) {
    const oldestId = entries.keys().next().value as string | undefined
    if (!oldestId) break
    deleteEntry(oldestId)
  }
}

export function storeResponseBody(body: StoredBody): string | undefined {
  if (body.raw.byteLength > maxTotalBytes) return undefined
  const id = crypto.randomUUID()
  entries.set(id, body)
  totalBytes += body.raw.byteLength
  trimEntries()
  return id
}

export function getResponseBody(id: unknown): StoredBody | undefined {
  if (typeof id !== 'string') return undefined
  const body = entries.get(id)
  if (!body) return undefined
  entries.delete(id)
  entries.set(id, body)
  return body
}

export function clearResponseBodies(): void {
  entries.clear()
  totalBytes = 0
}

export function configureResponseStoreForTests(config?: { maxTotalBytes?: number }): void {
  maxTotalBytes = config?.maxTotalBytes ?? RESPONSE_STORE_MAX_TOTAL_BYTES
  trimEntries()
}
