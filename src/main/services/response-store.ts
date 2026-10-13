import crypto from 'crypto'

/** Raw response bodies are kept in memory so Save can write them byte-exact; only the latest few are retained. */
const MAX_ENTRIES = 4

export interface StoredBody {
  raw: Buffer
  headers: Record<string, string>
  url: string
}

const entries = new Map<string, StoredBody>()

export function storeResponseBody(body: StoredBody): string {
  const id = crypto.randomUUID()
  entries.set(id, body)
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value as string)
  return id
}

export function getResponseBody(id: unknown): StoredBody | undefined {
  return typeof id === 'string' ? entries.get(id) : undefined
}

export function clearResponseBodies(): void {
  entries.clear()
}
