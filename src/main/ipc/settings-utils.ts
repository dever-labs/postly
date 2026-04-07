import { queryOne } from '../database'

export type GeneralSettings = {
  sslVerification: boolean
  followRedirects: boolean
  defaultTimeout: number
}

const GENERAL_DEFAULTS: GeneralSettings = {
  sslVerification: true,
  followRedirects: true,
  defaultTimeout: 30000,
}

export function parseGeneralSettings(value: string | undefined): GeneralSettings {
  const result = { ...GENERAL_DEFAULTS }
  if (!value) return result
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    if (typeof parsed['sslVerification'] === 'boolean') result.sslVerification = parsed['sslVerification']
    if (typeof parsed['followRedirects'] === 'boolean') result.followRedirects = parsed['followRedirects']
    if (typeof parsed['defaultTimeout'] === 'number') result.defaultTimeout = parsed['defaultTimeout']
  } catch { /* use defaults */ }
  return result
}

export function getGeneralSettings(): GeneralSettings {
  const row = queryOne<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['general'])
  return parseGeneralSettings(row?.value)
}
