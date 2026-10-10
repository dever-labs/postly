import { queryOne, run } from '../database'
import type { StoredCookie } from './cookie-jar'

/** Cookies are scoped to the active environment; requests with no environment share one jar. */
export const NO_ENV_KEY = ''

export function activeEnvKey(): string {
  return queryOne<{ id: string }>('SELECT id FROM environments WHERE is_active = 1 LIMIT 1')?.id ?? NO_ENV_KEY
}

export function loadCookies(envKey: string): StoredCookie[] {
  const row = queryOne<{ cookies_json: string }>('SELECT cookies_json FROM cookie_jars WHERE env_key = ?', [envKey])
  if (!row) return []
  try {
    const parsed = JSON.parse(row.cookies_json) as unknown
    return Array.isArray(parsed) ? (parsed as StoredCookie[]) : []
  } catch { return [] }
}

export function saveCookies(envKey: string, rows: StoredCookie[]): void {
  if (rows.length === 0) run('DELETE FROM cookie_jars WHERE env_key = ?', [envKey])
  else run('INSERT OR REPLACE INTO cookie_jars (env_key, cookies_json, updated_at) VALUES (?, ?, ?)', [envKey, JSON.stringify(rows), Date.now()])
}

export function deleteCookiesForEnv(envKey: string): void {
  run('DELETE FROM cookie_jars WHERE env_key = ?', [envKey])
}
