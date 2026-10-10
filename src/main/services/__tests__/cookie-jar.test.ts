import { describe, it, expect } from 'vitest'
import {
  applySetCookies, clearCookies, cookieHeaderFor, deleteCookie, listCookies, parseResponseCookies, upsertCookie,
  type CookieRecord, type StoredCookie,
} from '../cookie-jar'

// tough-cookie applies its own expiry check against the real clock, so the tests are anchored to it
const NOW = Date.now()
const store = (url: string, headers: string[], rows: StoredCookie[] = []) => applySetCookies(rows, url, headers, NOW).rows

describe('cookie jar matching', () => {
  it('sends host-only cookies to the exact host only', () => {
    const rows = store('https://api.test/login', ['sid=abc'])
    expect(cookieHeaderFor(rows, 'https://api.test/x', NOW).header).toBe('sid=abc')
    expect(cookieHeaderFor(rows, 'https://other.test/x', NOW).header).toBe('')
    expect(cookieHeaderFor(rows, 'https://sub.api.test/x', NOW).header).toBe('')
  })

  it('shares Domain cookies with subdomains but never with sibling or parent-less hosts', () => {
    const rows = store('https://www.example.com/', ['t=1; Domain=example.com'])
    expect(cookieHeaderFor(rows, 'https://api.example.com/', NOW).header).toBe('t=1')
    expect(cookieHeaderFor(rows, 'https://example.com/', NOW).header).toBe('t=1')
    expect(cookieHeaderFor(rows, 'https://badexample.com/', NOW).header).toBe('')
  })

  it('rejects a Domain the host does not belong to', () => {
    const result = applySetCookies([], 'https://a.test/', ['x=1; Domain=b.test'], NOW)
    expect(result.rows).toEqual([])
    expect(result.stored[0].rejected).toBe(true)
  })

  it('matches on path prefix boundaries', () => {
    const rows = store('https://a.test/app/login', ['p=1; Path=/app'])
    expect(cookieHeaderFor(rows, 'https://a.test/app', NOW).header).toBe('p=1')
    expect(cookieHeaderFor(rows, 'https://a.test/app/x/y', NOW).header).toBe('p=1')
    expect(cookieHeaderFor(rows, 'https://a.test/application', NOW).header).toBe('')
    expect(cookieHeaderFor(rows, 'https://a.test/', NOW).header).toBe('')
  })

  it('defaults the path to the directory of the request URL', () => {
    const rows = store('https://a.test/api/v1/login', ['d=1'])
    expect(listCookies(rows, NOW)[0].path).toBe('/api/v1')
  })

  it('only sends Secure cookies over https', () => {
    const rows = store('https://a.test/', ['s=1; Secure'])
    expect(cookieHeaderFor(rows, 'https://a.test/', NOW).header).toBe('s=1')
    expect(cookieHeaderFor(rows, 'http://a.test/', NOW).header).toBe('')
  })

  it('sends HttpOnly cookies (an API client is not script)', () => {
    const rows = store('https://a.test/', ['h=1; HttpOnly'])
    expect(cookieHeaderFor(rows, 'https://a.test/', NOW).header).toBe('h=1')
  })

  it('works for localhost and IP hosts', () => {
    const rows = store('http://localhost:3000/', ['l=1'], store('http://127.0.0.1:8080/', ['i=2']))
    expect(cookieHeaderFor(rows, 'http://localhost:9999/', NOW).header).toBe('l=1')
    expect(cookieHeaderFor(rows, 'http://127.0.0.1/', NOW).header).toBe('i=2')
  })

  it('orders longer paths first and joins with "; "', () => {
    const rows = store('https://a.test/a/b', ['x=1; Path=/', 'y=2; Path=/a'])
    expect(cookieHeaderFor(rows, 'https://a.test/a/b', NOW).header).toBe('y=2; x=1')
  })
})

describe('cookie expiry', () => {
  it('honours Max-Age and Expires', () => {
    const rows = store('https://a.test/', ['m=1; Max-Age=60', 'e=2; Expires=Fri, 01 Jan 2100 00:00:00 GMT', 's=3'])
    const later = NOW + 120_000
    expect(cookieHeaderFor(rows, 'https://a.test/', NOW).names.sort()).toEqual(['e', 'm', 's'])
    expect(cookieHeaderFor(rows, 'https://a.test/', later).names.sort()).toEqual(['e', 's'])
  })

  it('treats a cookie without Expires/Max-Age as a session cookie', () => {
    const rows = store('https://a.test/', ['s=1'])
    expect(listCookies(rows, NOW)[0].expires).toBeNull()
  })

  it('removes a cookie when the response expires it', () => {
    let rows = store('https://a.test/', ['sid=1'])
    const result = applySetCookies(rows, 'https://a.test/', ['sid=; Max-Age=0'], NOW + 1000)
    rows = result.rows
    expect(rows).toHaveLength(0)
    expect(result.stored[0].deleted).toBe(true)
  })

  it('drops expired cookies from the list and from storage', () => {
    const rows = store('https://a.test/', ['m=1; Max-Age=10'])
    expect(listCookies(rows, NOW + 60_000)).toEqual([])
    expect(applySetCookies(rows, 'https://a.test/', ['n=1'], NOW + 60_000).rows).toHaveLength(1)
  })

  it('replaces a cookie with the same name, domain and path', () => {
    const rows = store('https://a.test/', ['sid=2'], store('https://a.test/', ['sid=1']))
    expect(listCookies(rows, NOW).map((c) => c.value)).toEqual(['2'])
  })
})

describe('cookie attributes', () => {
  it('reports SameSite, Secure and HttpOnly', () => {
    const [c] = parseResponseCookies('https://a.test/', ['s=1; SameSite=Strict; Secure; HttpOnly'], NOW)
    expect(c).toMatchObject({ name: 's', sameSite: 'strict', secure: true, httpOnly: true, domain: 'a.test', hostOnly: true })
  })
})

describe('manual edits', () => {
  const rec: CookieRecord = { name: 'k', value: 'v', domain: '.Example.com', path: '/', expires: null, secure: false, httpOnly: false, sameSite: '', hostOnly: false }

  it('adds, edits, renames and deletes', () => {
    let rows = upsertCookie([], rec)
    expect(cookieHeaderFor(rows, 'https://www.example.com/', NOW).header).toBe('k=v')
    rows = upsertCookie(rows, { ...rec, name: 'k2', value: 'w' }, { name: 'k', domain: 'example.com', path: '/' })
    expect(listCookies(rows, NOW).map((c) => `${c.name}=${c.value}`)).toEqual(['k2=w'])
    rows = deleteCookie(rows, { name: 'k2', domain: 'example.com', path: '/' })
    expect(rows).toEqual([])
  })

  it('validates name and domain, and clears by domain', () => {
    expect(() => upsertCookie([], { ...rec, name: ' ' })).toThrow(/name/)
    expect(() => upsertCookie([], { ...rec, domain: '' })).toThrow(/domain/)
    const rows = upsertCookie(upsertCookie([], rec), { ...rec, domain: 'other.test' })
    expect(listCookies(clearCookies(rows, 'other.test'), NOW)).toHaveLength(1)
    expect(clearCookies(rows)).toEqual([])
  })
})
