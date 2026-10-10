import { describe, it, expect } from 'vitest'
import { createSubstitution, substituteBody, substituteRecord } from '../request-variables'

const make = () => createSubstitution({ environment: { name: 'Ann "Q"', tok: 'T' }, global: { host: 'h' } })

describe('request variable substitution', () => {
  it('tracks the scope each name resolved from', () => {
    const { sub, resolutions } = make()
    expect(sub('{{host}} {{tok}} {{nope}}')).toBe('h T {{nope}}')
    expect(resolutions()).toEqual([
      { name: 'host', scope: 'global' }, { name: 'tok', scope: 'environment' }, { name: 'nope', scope: null },
    ])
  })

  it('substitutes raw bodies as text', () => {
    expect(substituteBody('raw-json', '{"t":"{{tok}}"}', make().sub)).toBe('{"t":"T"}')
  })

  it('substitutes form rows individually so quotes in values cannot break the JSON', () => {
    const body = JSON.stringify([{ key: 'who', value: '{{name}}', enabled: true }, { key: 'f', value: '/tmp/x', enabled: true, fieldType: 'file' }])
    const out = JSON.parse(substituteBody('x-www-form-urlencoded', body, make().sub) as string)
    expect(out[0]).toMatchObject({ key: 'who', value: 'Ann "Q"', enabled: true })
    expect(out[1].fieldType).toBe('file')
  })

  it('leaves empty and "none" bodies alone and handles records', () => {
    expect(substituteBody('none', '{{tok}}', make().sub)).toBe('{{tok}}')
    expect(substituteBody('raw-text', undefined, make().sub)).toBeUndefined()
    expect(substituteRecord({ A: '{{tok}}' }, make().sub)).toEqual({ A: 'T' })
  })
})
