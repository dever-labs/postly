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

export interface InheritedNetwork {
  timeout: { value: number; source: string }
  followRedirects: { value: boolean; source: string }
  maxRedirects: { value: number; source: string }
}

export interface NetworkLayer { label: string; settings: NetworkSettings | undefined }

/** What a level would use if it set nothing itself. `layers` are the ancestors, nearest first. */
export function resolveInherited(layers: NetworkLayer[], global: { timeout: number; followRedirects: boolean }): InheritedNetwork {
  const pick = <K extends keyof NetworkSettings>(key: K) => {
    for (const l of layers) {
      const v = l.settings?.[key]
      if (v !== undefined) return { value: v, source: l.label }
    }
    return null
  }
  const t = pick('timeout')
  const f = pick('followRedirects')
  const m = pick('maxRedirects')
  return {
    timeout: { value: t?.value ?? global.timeout, source: t?.source ?? 'the global setting' },
    followRedirects: { value: f?.value ?? global.followRedirects, source: f?.source ?? 'the global setting' },
    maxRedirects: { value: m?.value ?? DEFAULT_MAX_REDIRECTS, source: m?.source ?? 'the default' },
  }
}

export function formatDuration(ms: number): string {
  return ms >= 1000 && ms % 100 === 0 ? `${ms / 1000} s` : `${ms} ms`
}

/** Parses seconds typed by the user (decimals allowed) into whole milliseconds, or null if invalid. */
export function secondsToMs(text: string): number | null {
  if (!/^\d+(\.\d{1,3})?$/.test(text.trim())) return null
  const ms = Math.round(Number(text) * 1000)
  return ms >= 1 && ms <= MAX_TIMEOUT_MS ? ms : null
}

export const msToSeconds = (ms: number): string => String(ms / 1000)

/** The ancestors of a folder (nearest first) as inheritance layers. */
export function ancestorLayers(
  folders: { id: string; parentId?: string; name: string; networkSettings?: NetworkSettings }[],
  startParentId: string | undefined
): NetworkLayer[] {
  const byId = new Map(folders.map((f) => [f.id, f]))
  const layers: NetworkLayer[] = []
  const seen = new Set<string>()
  let id = startParentId
  while (id && !seen.has(id)) {
    seen.add(id)
    const f = byId.get(id)
    if (!f) break
    layers.push({ label: f.parentId ? `folder "${f.name}"` : `collection "${f.name}"`, settings: f.networkSettings })
    id = f.parentId
  }
  return layers
}
