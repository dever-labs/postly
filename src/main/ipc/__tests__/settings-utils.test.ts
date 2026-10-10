import { describe, it, expect, vi, beforeEach } from 'vitest'

const queryOne = vi.fn()
vi.mock('../../database', () => ({ queryOne: (...a: unknown[]) => queryOne(...a) }))

import { parseGeneralSettings, getGeneralSettings } from '../settings-utils'

const DEFAULTS = {
  sslVerification: true,
  followRedirects: true,
  defaultTimeout: 30000,
  autoUpdate: true,
  updateFeedUrl: undefined,
  historyEnabled: true,
  historyLimit: 500,
}

describe('parseGeneralSettings', () => {
  it('returns defaults for missing or empty input', () => {
    expect(parseGeneralSettings(undefined)).toEqual(DEFAULTS)
    expect(parseGeneralSettings('')).toEqual(DEFAULTS)
  })

  it('returns defaults for malformed JSON', () => {
    expect(parseGeneralSettings('{not json')).toEqual(DEFAULTS)
  })

  it('applies valid overrides', () => {
    const out = parseGeneralSettings(JSON.stringify({
      sslVerification: false, followRedirects: false, defaultTimeout: 5000, autoUpdate: false, updateFeedUrl: 'https://feed.example',
    }))
    expect(out).toEqual({
      ...DEFAULTS, sslVerification: false, followRedirects: false, defaultTimeout: 5000, autoUpdate: false, updateFeedUrl: 'https://feed.example',
    })
  })

  it('ignores values of the wrong type', () => {
    const out = parseGeneralSettings(JSON.stringify({
      sslVerification: 'no', followRedirects: 0, defaultTimeout: '10', autoUpdate: null, updateFeedUrl: 42,
    }))
    expect(out).toEqual(DEFAULTS)
  })

  it('treats an empty updateFeedUrl as unset', () => {
    expect(parseGeneralSettings(JSON.stringify({ updateFeedUrl: '' })).updateFeedUrl).toBeUndefined()
  })

  it('does not mutate shared defaults between calls', () => {
    parseGeneralSettings(JSON.stringify({ sslVerification: false }))
    expect(parseGeneralSettings(undefined).sslVerification).toBe(true)
  })
})

describe('getGeneralSettings', () => {
  beforeEach(() => queryOne.mockReset())

  it('reads the "general" settings row', () => {
    queryOne.mockReturnValue({ value: JSON.stringify({ defaultTimeout: 1234 }) })
    expect(getGeneralSettings().defaultTimeout).toBe(1234)
    expect(queryOne).toHaveBeenCalledWith('SELECT value FROM settings WHERE key = ?', ['general'])
  })

  it('falls back to defaults when no row exists', () => {
    queryOne.mockReturnValue(undefined)
    expect(getGeneralSettings()).toEqual(DEFAULTS)
  })
})
