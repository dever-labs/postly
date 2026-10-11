import { describe, it, expect } from 'vitest'
import { parseJsonPath, parseRules, runExtraction, serializeRules, validateRule, type ExtractRule } from '../extract'

const rule = (over: Partial<ExtractRule>): ExtractRule => ({
  id: 'r', source: 'json', expression: '', variable: 'V', scope: 'environment', enabled: true, ...over,
})
const res = {
  status: 201,
  headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'abc-1' },
  body: JSON.stringify({ token: 'tok', n: 5, data: { items: [{ id: 'a' }, { id: 'b' }], 'odd key': true, nothing: null } }),
  cookies: [{ name: 'sid', value: 's-1' }],
}
const run = (r: Partial<ExtractRule>, response = res) => runExtraction([rule(r)], response)[0]

describe('JSON paths', () => {
  it('parses dotted, bracket and pointer syntax', () => {
    expect(parseJsonPath('$.data.items[1].id')).toEqual(['data', 'items', 1, 'id'])
    expect(parseJsonPath("data['odd key']")).toEqual(['data', 'odd key'])
    expect(parseJsonPath('/data/items/0/id')).toEqual(['data', 'items', 0, 'id'])
    expect(parseJsonPath('/a~1b/c~0d')).toEqual(['a/b', 'c~d'])
  })
  it('rejects unsupported or broken syntax', () => {
    expect(typeof parseJsonPath('')).toBe('string')
    expect(typeof parseJsonPath('$.items[*].id')).toBe('string')
    expect(typeof parseJsonPath('$..id')).toBe('string')
    expect(typeof parseJsonPath('$.a[')).toBe('string')
  })
})

describe('extraction sources', () => {
  it('json: scalars as text, objects as JSON, null as "null"', () => {
    expect(run({ expression: '$.token' })).toMatchObject({ ok: true, value: 'tok' })
    expect(run({ expression: '$.n' })).toMatchObject({ value: '5' })
    expect(run({ expression: '$.data.items[1].id' })).toMatchObject({ value: 'b' })
    expect(run({ expression: '/data/items/0' })).toMatchObject({ value: '{"id":"a"}' })
    expect(run({ expression: '$.data.nothing' })).toMatchObject({ ok: true, value: 'null' })
  })
  it('json: reports missing paths and non-JSON bodies', () => {
    expect(run({ expression: '$.nope' })).toMatchObject({ ok: false, error: expect.stringContaining('Nothing found') })
    expect(run({ expression: '$.token' }, { ...res, body: '<html>' })).toMatchObject({ ok: false, error: expect.stringContaining('not valid JSON') })
  })
  it('json: does not read prototype properties', () => {
    expect(run({ expression: '$.constructor' }).ok).toBe(false)
    expect(run({ expression: '$.data.items.length' })).toMatchObject({ ok: true, value: '2' })
  })
  it('header: case-insensitive', () => {
    expect(run({ source: 'header', expression: 'x-request-id' })).toMatchObject({ value: 'abc-1' })
    expect(run({ source: 'header', expression: 'X-Missing' }).ok).toBe(false)
  })
  it('status', () => {
    expect(run({ source: 'status' })).toMatchObject({ ok: true, value: '201' })
  })
  it('cookie', () => {
    expect(run({ source: 'cookie', expression: 'sid' })).toMatchObject({ value: 's-1' })
    expect(run({ source: 'cookie', expression: 'other' }).ok).toBe(false)
  })
  it('regex: first group, else whole match', () => {
    expect(run({ source: 'regex', expression: '"token":"(\\w+)"' })).toMatchObject({ value: 'tok' })
    expect(run({ source: 'regex', expression: '\\d+' })).toMatchObject({ value: '5' })
    expect(run({ source: 'regex', expression: 'zzz' }).ok).toBe(false)
  })
  it('skips disabled rules and never throws on invalid ones', () => {
    const out = runExtraction([rule({ enabled: false, expression: '$.token' }), rule({ source: 'regex', expression: '(' })], res)
    expect(out).toHaveLength(1)
    expect(out[0].ok).toBe(false)
  })
})

describe('validation and persistence', () => {
  it('validates variable names and expressions', () => {
    expect(validateRule({ source: 'json', expression: '$.a', variable: 'token' })).toBeNull()
    expect(validateRule({ source: 'json', expression: '$.a', variable: '' })).toMatch(/variable/i)
    expect(validateRule({ source: 'json', expression: '$.a', variable: '1x' })).toMatch(/Variable names/)
    expect(validateRule({ source: 'json', expression: '$..a', variable: 'x' })).toMatch(/not supported/)
    expect(validateRule({ source: 'regex', expression: '(', variable: 'x' })).toBeTruthy()
    expect(validateRule({ source: 'header', expression: ' ', variable: 'x' })).toBeTruthy()
    expect(validateRule({ source: 'status', expression: '', variable: 'x' })).toBeNull()
  })
  it('round-trips and tolerates bad stored data', () => {
    const rules = [rule({ expression: '$.a', scope: 'collection' })]
    expect(parseRules(serializeRules(rules))).toEqual(rules)
    expect(parseRules(undefined)).toEqual([])
    expect(parseRules('not json')).toEqual([])
    expect(parseRules('[{"source":"bogus"},null,5]')).toEqual([])
  })
})
