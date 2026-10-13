import { describe, it, expect } from 'vitest'
import { parseNetworkSettings, resolveNetwork, serializeNetworkSettings } from '../network-settings'

const global = { timeout: 30_000, followRedirects: true }

describe('parseNetworkSettings', () => {
  it('accepts JSON strings and objects', () => {
    expect(parseNetworkSettings('{"timeout":5000,"followRedirects":false,"maxRedirects":2}')).toEqual({ timeout: 5000, followRedirects: false, maxRedirects: 2 })
    expect(parseNetworkSettings({ timeout: 100 })).toEqual({ timeout: 100 })
  })

  it('treats empty, malformed and non-object input as inherit', () => {
    for (const v of [null, undefined, '', '{', '[]', '"x"', 5, '{}']) expect(parseNetworkSettings(v)).toBeUndefined()
  })

  it('drops invalid values but keeps valid siblings', () => {
    expect(parseNetworkSettings({ timeout: -1, followRedirects: 'yes', maxRedirects: 1.5 })).toBeUndefined()
    expect(parseNetworkSettings({ timeout: 0, maxRedirects: 0 })).toEqual({ maxRedirects: 0 })
    expect(parseNetworkSettings({ timeout: 3_600_001, followRedirects: true })).toEqual({ followRedirects: true })
    expect(parseNetworkSettings({ maxRedirects: 51 })).toBeUndefined()
  })

  it('serialises only meaningful settings', () => {
    expect(serializeNetworkSettings({ timeout: 10 })).toBe('{"timeout":10}')
    expect(serializeNetworkSettings({})).toBeNull()
    expect(serializeNetworkSettings(undefined)).toBeNull()
  })
})

describe('resolveNetwork', () => {
  it('falls back to the global settings', () => {
    expect(resolveNetwork(global, [])).toEqual({
      timeout: 30_000, followRedirects: true, maxRedirects: 5,
      sources: { timeout: 'global setting', followRedirects: 'global setting', maxRedirects: 'default' },
    })
  })

  it('prefers request over group over collection over global', () => {
    const layers = [
      { label: 'request', settings: { timeout: 1000 } },
      { label: 'folder "G"', settings: { timeout: 2000, followRedirects: false } },
      { label: 'collection "C"', settings: { timeout: 3000, followRedirects: true, maxRedirects: 9 } },
    ]
    const r = resolveNetwork(global, layers)
    expect(r.timeout).toBe(1000)
    expect(r.followRedirects).toBe(false)
    expect(r.maxRedirects).toBe(9)
    expect(r.sources).toEqual({ timeout: 'request', followRedirects: 'folder "G"', maxRedirects: 'collection "C"' })
  })

  it('resolves each setting independently', () => {
    const r = resolveNetwork(global, [
      { label: 'request', settings: undefined },
      { label: 'collection "C"', settings: { followRedirects: false } },
    ])
    expect(r.timeout).toBe(30_000)
    expect(r.followRedirects).toBe(false)
    expect(r.sources.timeout).toBe('global setting')
  })

  it('lets a request turn redirects on when a collection turned them off', () => {
    const r = resolveNetwork({ ...global, followRedirects: false }, [
      { label: 'request', settings: { followRedirects: true } },
      { label: 'collection "C"', settings: { followRedirects: false } },
    ])
    expect(r.followRedirects).toBe(true)
  })

  it('treats an explicit maxRedirects of 0 as an override', () => {
    expect(resolveNetwork(global, [{ label: 'request', settings: { maxRedirects: 0 } }]).maxRedirects).toBe(0)
  })
})
