import type { NetworkSettings } from '@/types'

export const MAX_TIMEOUT_MS = 3_600_000
export const MAX_REDIRECT_LIMIT = 50
export const DEFAULT_MAX_REDIRECTS = 5

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/** Accepts a stored JSON string or object and keeps only valid keys; undefined means everything is inherited. */
export function normalizeNetworkSettings(raw: unknown): NetworkSettings | undefined {
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

export function networkSettingsEqual(a: NetworkSettings | undefined, b: NetworkSettings | undefined): boolean {
  const x = a ?? {}
  const y = b ?? {}
  return x.timeout === y.timeout && x.followRedirects === y.followRedirects && x.maxRedirects === y.maxRedirects
}
