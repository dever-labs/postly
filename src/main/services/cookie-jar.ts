import { Cookie, CookieJar } from 'tough-cookie'

/** A persisted cookie in tough-cookie's JSON form. */
export type StoredCookie = Record<string, unknown>

export interface CookieRecord {
  name: string
  value: string
  domain: string
  path: string
  /** Epoch ms, or null for a session cookie. */
  expires: number | null
  secure: boolean
  httpOnly: boolean
  sameSite: 'strict' | 'lax' | 'none' | ''
  hostOnly: boolean
}

export interface ResponseCookie extends CookieRecord {
  /** The cookie was refused (for example a Domain that does not match the host) and not stored. */
  rejected?: boolean
  /** The response expired the cookie, which removes it from the jar. */
  deleted?: boolean
}

const JAR_OPTIONS = { rejectPublicSuffixes: false, allowSpecialUseDomain: true } as const

function newJar(rows: StoredCookie[]): CookieJar {
  const jar = new CookieJar(undefined, JAR_OPTIONS)
  for (const row of rows) {
    const cookie = Cookie.fromJSON(row as never)
    if (cookie) jar.store.putCookie(cookie, () => undefined)
  }
  return jar
}

function dump(jar: CookieJar, now: number): StoredCookie[] {
  return (jar.serializeSync()?.cookies ?? []).filter((c) => {
    const cookie = Cookie.fromJSON(c as never)
    return cookie ? (cookie.expiryTime() ?? Infinity) > now : false
  }) as StoredCookie[]
}

export function toRecord(row: StoredCookie): CookieRecord | null {
  const cookie = Cookie.fromJSON(row as never)
  if (!cookie) return null
  const expiry = cookie.expiryTime() ?? Infinity
  const sameSite = (cookie.sameSite ?? '').toLowerCase()
  return {
    name: cookie.key,
    value: cookie.value,
    domain: cookie.domain ?? '',
    path: cookie.path ?? '/',
    expires: Number.isFinite(expiry) ? expiry : null,
    secure: !!cookie.secure,
    httpOnly: !!cookie.httpOnly,
    sameSite: sameSite === 'strict' || sameSite === 'lax' || sameSite === 'none' ? sameSite : '',
    hostOnly: !!cookie.hostOnly,
  }
}

const created = (c: Cookie): number => (c.creation instanceof Date ? c.creation.getTime() : 0)

/** Cookies that apply to the URL, ready for a Cookie header. Expired, wrong-domain, wrong-path and Secure-over-http cookies are excluded. */
export function cookieHeaderFor(rows: StoredCookie[], url: string, now = Date.now()): { header: string; names: string[] } {
  try {
    const cookies = newJar(rows)
      .getCookiesSync(url, { http: true })
      .filter((c) => (c.expiryTime() ?? Infinity) > now)
      // RFC 6265 §5.4: longer paths first, then the oldest cookie first
      .sort((a, b) => (b.path?.length ?? 0) - (a.path?.length ?? 0) || created(a) - created(b))
    return { header: cookies.map((c) => `${c.key}=${c.value}`).join('; '), names: cookies.map((c) => c.key) }
  } catch {
    return { header: '', names: [] }
  }
}

/** Applies Set-Cookie headers from a response to the stored cookies. */
export function applySetCookies(rows: StoredCookie[], url: string, setCookie: string[], now = Date.now()): { rows: StoredCookie[]; stored: ResponseCookie[]; changed: boolean } {
  if (setCookie.length === 0) return { rows, stored: [], changed: false }
  const jar = newJar(rows)
  const stored: ResponseCookie[] = []
  for (const header of setCookie) {
    const parsed = Cookie.parse(header, { loose: true })
    try {
      jar.setCookieSync(header, url, { now: new Date(now), http: true })
      const row = parsed ? toRecord(parsed.toJSON() as StoredCookie) : null
      if (row && parsed) {
        const expired = (parsed.expiryTime(new Date(now)) ?? Infinity) <= now
        stored.push({ ...row, domain: parsed.domain ?? hostOf(url), path: parsed.path ?? defaultPathOf(url), hostOnly: !parsed.domain, deleted: expired || undefined })
      }
    } catch {
      if (parsed) stored.push({ name: parsed.key, value: parsed.value, domain: parsed.domain ?? hostOf(url), path: parsed.path ?? '/', expires: null, secure: !!parsed.secure, httpOnly: !!parsed.httpOnly, sameSite: '', hostOnly: !parsed.domain, rejected: true })
    }
  }
  const next = dump(jar, now)
  return { rows: next, stored, changed: true }
}

function hostOf(url: string): string {
  try { return new URL(url).hostname } catch { return '' }
}

function defaultPathOf(url: string): string {
  try {
    const p = new URL(url).pathname
    const i = p.lastIndexOf('/')
    return i <= 0 ? '/' : p.slice(0, i)
  } catch { return '/' }
}

const sameKey = (r: StoredCookie, id: { name: string; domain: string; path: string }) =>
  r['key'] === id.name && r['domain'] === id.domain && (r['path'] ?? '/') === id.path

export function listCookies(rows: StoredCookie[], now = Date.now()): CookieRecord[] {
  return rows
    .map(toRecord)
    .filter((r): r is CookieRecord => !!r && (r.expires === null || r.expires > now))
    .sort((a, b) => a.domain.localeCompare(b.domain) || a.path.localeCompare(b.path) || a.name.localeCompare(b.name))
}

/** Adds or replaces a cookie. `previous` identifies the cookie being edited when its name, domain or path changed. */
export function upsertCookie(rows: StoredCookie[], record: CookieRecord, previous?: { name: string; domain: string; path: string }): StoredCookie[] {
  const domain = record.domain.trim().replace(/^\./, '').toLowerCase()
  const name = record.name.trim()
  if (!name) throw new Error('Cookie name is required')
  if (!domain) throw new Error('Cookie domain is required')
  const path = record.path.startsWith('/') ? record.path : '/'
  const cookie = new Cookie({
    key: name,
    value: record.value,
    domain,
    path,
    secure: record.secure,
    httpOnly: record.httpOnly,
    hostOnly: record.hostOnly,
    sameSite: record.sameSite || undefined,
    expires: record.expires === null ? 'Infinity' : new Date(record.expires),
  })
  const json = cookie.toJSON() as StoredCookie
  const drop = [previous, { name, domain, path }].filter((p): p is { name: string; domain: string; path: string } => !!p)
  return [...rows.filter((r) => !drop.some((d) => sameKey(r, d))), json]
}

export function deleteCookie(rows: StoredCookie[], id: { name: string; domain: string; path: string }): StoredCookie[] {
  return rows.filter((r) => !sameKey(r, id))
}

export function clearCookies(rows: StoredCookie[], domain?: string): StoredCookie[] {
  return domain ? rows.filter((r) => r['domain'] !== domain) : []
}

/** Cookies a response sets, without storing them. Used for the response Cookies tab. */
export function parseResponseCookies(url: string, setCookie: string[], now = Date.now()): ResponseCookie[] {
  return applySetCookies([], url, setCookie, now).stored
}
