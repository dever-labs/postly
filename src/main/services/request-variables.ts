import { interpolate, type Resolution, type VariableScopes } from '../../shared/variables'

type Substitute = (text: string) => string

/** Builds a substitution function that remembers where every variable it saw resolved from. */
export function createSubstitution(scopes: VariableScopes, dynamic?: (name: string) => string | undefined): { sub: Substitute; resolutions: () => Resolution[] } {
  const seen = new Map<string, Resolution>()
  return {
    sub: (text) => {
      const out = interpolate(text, scopes, dynamic)
      for (const r of out.resolutions) if (!seen.has(r.name) || seen.get(r.name)?.scope === null) seen.set(r.name, r)
      return out.text
    },
    resolutions: () => [...seen.values()],
  }
}

export const substituteRecord = (record: Record<string, string> | undefined, sub: Substitute): Record<string, string> =>
  Object.fromEntries(Object.entries(record ?? {}).map(([k, v]) => [k, typeof v === 'string' ? sub(v) : v]))

/** Substitutes inside a request body. Form bodies are JSON lists, so each key and value is substituted separately to keep the JSON valid. */
export function substituteBody(bodyType: string, body: string | undefined, sub: Substitute): string | undefined {
  if (!body || bodyType === 'none') return body
  if (bodyType === 'form-data' || bodyType === 'x-www-form-urlencoded') {
    try {
      const rows = JSON.parse(body) as unknown
      if (Array.isArray(rows)) {
        return JSON.stringify(rows.map((r: Record<string, unknown>) => ({
          ...r,
          key: typeof r.key === 'string' ? sub(r.key) : r.key,
          value: typeof r.value === 'string' ? sub(r.value) : r.value,
        })))
      }
    } catch { /* not a JSON list: treat as text */ }
  }
  return sub(body)
}
