import crypto from 'crypto'

export type Obj = Record<string, unknown>
export type Auth = { type: string; config: Record<string, unknown> }

export const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
export const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '')
export const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : [])

export const kv = (key: string, value: unknown, enabled: boolean) => ({ id: crypto.randomUUID(), key, value: str(value), enabled })

export function parseQuery(query: string) {
  return query.split('&').filter(Boolean).map((pair) => {
    const eq = pair.indexOf('=')
    return kv(eq < 0 ? pair : pair.slice(0, eq), eq < 0 ? '' : pair.slice(eq + 1), true)
  })
}

/**
 * Splits the query string and fragment off a URL. Postly keeps query parameters in their own table,
 * and has no per-request path variables, so `/:id` segments become `{{id}}` (the caller records them
 * as collection variables).
 */
export function splitUrl(raw: string, pathVariables: Map<string, string>, declared: Obj[] = []): { url: string; query: string | null } {
  const hash = raw.indexOf('#')
  if (hash >= 0) raw = raw.slice(0, hash)
  const q = raw.indexOf('?')
  const base = q >= 0 ? raw.slice(0, q) : raw
  const m = /^((?:[a-z][a-z0-9+.-]*:\/\/)?[^/]*)(.*)$/i.exec(base)
  const path = (m?.[2] ?? '').replace(/\/:([A-Za-z_]\w*)(?=\/|$)/g, (_all, name: string) => {
    const declaredValue = declared.find((d) => (d.key ?? d.name) === name)?.value
    if (!pathVariables.has(name)) pathVariables.set(name, str(declaredValue))
    return `/{{${name}}}`
  })
  return { url: `${m?.[1] ?? base}${path}`, query: q >= 0 ? raw.slice(q + 1) : null }
}

export const MAX_IMPORT_NODES = 20_000
export const MAX_IMPORT_DEPTH = 64

/** Bounds how much a converter may build, so shared YAML aliases cannot expand into a huge tree. */
export class ImportBudget {
  private nodes = 0
  take(depth = 0): void {
    if (depth > MAX_IMPORT_DEPTH) throw new Error(`The collection is nested deeper than ${MAX_IMPORT_DEPTH} levels.`)
    if (++this.nodes > MAX_IMPORT_NODES) throw new Error(`The collection has more than ${MAX_IMPORT_NODES} requests and folders.`)
  }
}
