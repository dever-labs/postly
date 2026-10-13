/** Per-entity overrides for request timing and redirect behaviour. A missing key means "inherit". */
export interface NetworkSettings {
  timeout?: number
  followRedirects?: boolean
  maxRedirects?: number
}

export interface GlobalNetwork {
  timeout: number
  followRedirects: boolean
}

export interface ResolvedNetwork {
  timeout: number
  followRedirects: boolean
  maxRedirects: number
  sources: { timeout: string; followRedirects: string; maxRedirects: string }
}

export const DEFAULT_MAX_REDIRECTS = 5
export const MAX_TIMEOUT_MS = 3_600_000
export const MAX_REDIRECT_LIMIT = 50

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v)
}

/** Parses a stored value (JSON string or object) and drops anything invalid, so bad data never reaches the executor. */
export function parseNetworkSettings(raw: unknown): NetworkSettings | undefined {
  let value: unknown = raw
  if (typeof raw === 'string') {
    if (!raw) return undefined
    try { value = JSON.parse(raw) } catch { return undefined }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const v = value as Record<string, unknown>
  const out: NetworkSettings = {}
  if (isInt(v.timeout) && v.timeout > 0 && v.timeout <= MAX_TIMEOUT_MS) out.timeout = v.timeout
  if (typeof v.followRedirects === 'boolean') out.followRedirects = v.followRedirects
  if (isInt(v.maxRedirects) && v.maxRedirects >= 0 && v.maxRedirects <= MAX_REDIRECT_LIMIT) out.maxRedirects = v.maxRedirects
  return Object.keys(out).length > 0 ? out : undefined
}

/** Serialises for storage; null when nothing is overridden. */
export function serializeNetworkSettings(raw: unknown): string | null {
  const parsed = parseNetworkSettings(raw)
  return parsed ? JSON.stringify(parsed) : null
}

export interface NetworkLayer {
  label: string
  settings: NetworkSettings | undefined
}

/**
 * Resolves the effective settings. `layers` are ordered most specific first
 * (request, nearest group, …, collection); the global setting is the fallback.
 */
export function resolveNetwork(global: GlobalNetwork, layers: NetworkLayer[]): ResolvedNetwork {
  const pick = <K extends keyof NetworkSettings>(key: K): { value: NetworkSettings[K]; source: string } | null => {
    for (const layer of layers) {
      const v = layer.settings?.[key]
      if (v !== undefined) return { value: v, source: layer.label }
    }
    return null
  }
  const timeout = pick('timeout')
  const follow = pick('followRedirects')
  const max = pick('maxRedirects')
  return {
    timeout: timeout?.value ?? global.timeout,
    followRedirects: follow?.value ?? global.followRedirects,
    maxRedirects: max?.value ?? DEFAULT_MAX_REDIRECTS,
    sources: {
      timeout: timeout?.source ?? 'global setting',
      followRedirects: follow?.source ?? 'global setting',
      maxRedirects: max?.source ?? 'default',
    },
  }
}
