import { describe, it, expect } from 'vitest'
import { ancestorLayers, formatDuration, resolveInherited, secondsToMs } from '../networkSettings'

describe('secondsToMs', () => {
  it('converts seconds with up to three decimals', () => {
    expect(secondsToMs('30')).toBe(30_000)
    expect(secondsToMs('0.15')).toBe(150)
    expect(secondsToMs('0.001')).toBe(1)
    expect(secondsToMs('3600')).toBe(3_600_000)
  })
  it('rejects anything else', () => {
    for (const bad of ['', 'abc', '-1', '0', '0.0004', '1.2345', '3600.001', '1e3', ' ']) expect(secondsToMs(bad)).toBeNull()
  })
})

describe('formatDuration', () => {
  it('uses seconds for round values and milliseconds otherwise', () => {
    expect(formatDuration(30_000)).toBe('30 s')
    expect(formatDuration(1500)).toBe('1.5 s')
    expect(formatDuration(1234)).toBe('1234 ms')
    expect(formatDuration(250)).toBe('250 ms')
  })
})

describe('resolveInherited', () => {
  const folders = [
    { id: 'c', name: 'Pay', networkSettings: { timeout: 9000, maxRedirects: 2 } },
    { id: 'g', parentId: 'c', name: 'Slow', networkSettings: { timeout: 20000 } },
    { id: 'h', parentId: 'g', name: 'Inner' },
  ]

  it('walks up the folder chain, nearest first, per setting', () => {
    const r = resolveInherited(ancestorLayers(folders, 'g'), { timeout: 1000, followRedirects: false })
    expect(r.timeout).toEqual({ value: 20000, source: 'folder "Slow"' })
    expect(r.maxRedirects).toEqual({ value: 2, source: 'collection "Pay"' })
    expect(r.followRedirects).toEqual({ value: false, source: 'the global setting' })
  })

  it('falls back to global for a collection and survives a cyclic or missing parent', () => {
    expect(resolveInherited(ancestorLayers(folders, undefined), { timeout: 1000, followRedirects: true }).timeout).toEqual({ value: 1000, source: 'the global setting' })
    const cyclic = [{ id: 'a', parentId: 'b', name: 'A' }, { id: 'b', parentId: 'a', name: 'B' }]
    expect(ancestorLayers(cyclic, 'a')).toHaveLength(2)
    expect(ancestorLayers(folders, 'missing')).toEqual([])
  })
})
