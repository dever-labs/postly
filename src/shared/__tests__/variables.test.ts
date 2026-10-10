import { describe, it, expect } from 'vitest'
import { createDynamicVariables, interpolate, lookupVariable, summarizeResolutions, DYNAMIC_VARIABLES } from '../variables'

describe('scope precedence', () => {
  const scopes = {
    global: { a: 'g', b: 'g', c: 'g', d: 'g' },
    collection: { a: 'c', b: 'c', c: 'c' },
    environment: { a: 'e', b: 'e' },
  }
  it('environment beats collection beats global', () => {
    expect(lookupVariable('a', scopes)).toMatchObject({ scope: 'environment', value: 'e' })
    expect(lookupVariable('c', scopes)).toMatchObject({ scope: 'collection', value: 'c' })
    expect(lookupVariable('d', scopes)).toMatchObject({ scope: 'global', value: 'g' })
  })
  it('an empty value still wins over a lower scope', () => {
    expect(lookupVariable('a', { global: { a: 'g' }, environment: { a: '' } })).toMatchObject({ scope: 'environment', value: '' })
  })
  it('reports unknown names as unresolved', () => {
    expect(lookupVariable('nope', scopes)).toEqual({ name: 'nope', scope: null })
  })
  it('does not read inherited object properties', () => {
    expect(lookupVariable('constructor', {}).scope).toBeNull()
    expect(lookupVariable('toString', { global: {} }).scope).toBeNull()
  })
})

describe('interpolate', () => {
  it('replaces known names, trims whitespace and leaves unknown ones as written', () => {
    const out = interpolate('{{ host }}/{{missing}}/{{host}}', { environment: { host: 'h' } })
    expect(out.text).toBe('h/{{missing}}/h')
    expect(out.resolutions).toEqual([{ name: 'host', scope: 'environment' }, { name: 'missing', scope: null }])
  })
  it('does not re-expand values that contain placeholders', () => {
    expect(interpolate('{{a}}', { environment: { a: '{{b}}', b: 'x' } }).text).toBe('{{b}}')
  })
  it('summarises without values', () => {
    const { resolutions } = interpolate('{{a}} {{b}} {{$guid}} {{z}}', { global: { a: 'secret' }, collection: { b: 'v' } })
    expect(summarizeResolutions(resolutions)).toEqual({ resolved: 'a ← global, b ← collection, $guid ← built-in', unresolved: ['{{z}}'] })
  })
})

describe('dynamic variables', () => {
  const fixed = createDynamicVariables({ now: () => Date.parse('2026-03-04T05:06:07.890Z'), uuid: () => 'uuid-1', random: () => 0.5 })

  it('generates each built-in', () => {
    expect(fixed('$guid')).toBe('uuid-1')
    expect(fixed('$timestamp')).toBe('1772600767')
    expect(fixed('$isoTimestamp')).toBe('2026-03-04T05:06:07.890Z')
    expect(fixed('$randomInt')).toBe('500')
    expect(fixed('$unknown')).toBeUndefined()
  })
  it('covers the documented list', () => {
    for (const v of DYNAMIC_VARIABLES) expect(fixed(v.name)).toBeDefined()
  })
  it('random ints stay within 0..1000', () => {
    expect(createDynamicVariables({ random: () => 0 })('$randomInt')).toBe('0')
    expect(createDynamicVariables({ random: () => 0.999999 })('$randomInt')).toBe('1000')
  })
  it('real generators produce a fresh UUID each use but one timestamp per send', () => {
    const gen = createDynamicVariables()
    expect(gen('$guid')).toMatch(/^[0-9a-f-]{36}$/)
    expect(gen('$guid')).not.toBe(gen('$guid'))
    expect(gen('$isoTimestamp')).toBe(gen('$isoTimestamp'))
  })
  it('user-defined variables with the same name win', () => {
    expect(interpolate('{{$guid}}', { environment: { $guid: 'mine' } }).text).toBe('mine')
    expect(interpolate('{{$guid}}', {}, fixed).text).toBe('uuid-1')
  })
  it('only names starting with $ are dynamic', () => {
    expect(interpolate('{{guid}}', {}).text).toBe('{{guid}}')
  })
})
