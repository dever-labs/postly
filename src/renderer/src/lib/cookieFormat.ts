import type { CookieRecord } from '@/types'

export function formatExpiry(expires: number | null): string {
  return expires === null ? 'Session' : new Date(expires).toLocaleString()
}

export function cookieFlags(c: CookieRecord): string[] {
  const flags: string[] = []
  if (c.secure) flags.push('Secure')
  if (c.httpOnly) flags.push('HttpOnly')
  if (c.sameSite) flags.push(`SameSite=${c.sameSite[0].toUpperCase()}${c.sameSite.slice(1)}`)
  if (c.hostOnly) flags.push('HostOnly')
  return flags
}

export const maskValue = (v: string): string => '•'.repeat(Math.min(Math.max(v.length, 4), 12))
