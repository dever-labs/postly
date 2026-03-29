import { describe, it, expect } from 'vitest'
import { parseJsonField, normalizeRequest, normalizeGroup, kvpToRecord, serializeRequest } from '../normalizers'

// ---------------------------------------------------------------------------
// parseJsonField
// ---------------------------------------------------------------------------
describe('parseJsonField', () => {
  it('parses valid JSON string', () => {
    expect(parseJsonField('{"a":1}', {})).toEqual({ a: 1 })
  })

  it('returns fallback on invalid JSON', () => {
    expect(parseJsonField('not json', [])).toEqual([])
  })

  it('returns fallback on null', () => {
    expect(parseJsonField(null, 'default')).toBe('default')
  })

  it('returns fallback on undefined', () => {
    expect(parseJsonField(undefined, 42)).toBe(42)
  })

  it('passes through non-string non-null values as-is', () => {
    const arr = [1, 2, 3]
    expect(parseJsonField(arr, [])).toBe(arr)
  })

  it('parses JSON array string', () => {
    expect(parseJsonField('[1,2,3]', [])).toEqual([1, 2, 3])
  })
})

// ---------------------------------------------------------------------------
// normalizeRequest
// ---------------------------------------------------------------------------
describe('normalizeRequest', () => {
  const base = {
    id: 'req-1',
    group_id: 'grp-1',
    name: 'Get Users',
    method: 'GET',
    url: '/api/users',
  }

  it('maps camelCase and snake_case fields', () => {
    const r = normalizeRequest(base)
    expect(r.id).toBe('req-1')
    expect(r.groupId).toBe('grp-1')
    expect(r.name).toBe('Get Users')
  })

  it('defaults method to GET', () => {
    const r = normalizeRequest({ ...base, method: undefined })
    expect(r.method).toBe('GET')
  })

  it('defaults url to empty string', () => {
    const r = normalizeRequest({ ...base, url: undefined })
    expect(r.url).toBe('')
  })

  it('defaults bodyType to none', () => {
    const r = normalizeRequest(base)
    expect(r.bodyType).toBe('none')
  })

  it('defaults protocol to http', () => {
    const r = normalizeRequest(base)
    expect(r.protocol).toBe('http')
  })

  it('defaults authType to none', () => {
    const r = normalizeRequest(base)
    expect(r.authType).toBe('none')
  })

  it('parses params JSON string', () => {
    const r = normalizeRequest({ ...base, params: '[{"id":"1","key":"q","value":"test","enabled":true}]' })
    expect(r.params).toHaveLength(1)
    expect(r.params[0].key).toBe('q')
  })

  it('defaults params to empty array on bad JSON', () => {
    const r = normalizeRequest({ ...base, params: 'bad' })
    expect(r.params).toEqual([])
  })

  it('prefers camelCase over snake_case for groupId', () => {
    const r = normalizeRequest({ ...base, groupId: 'camel', group_id: 'snake' })
    expect(r.groupId).toBe('camel')
  })

  it('maps isDirty correctly', () => {
    expect(normalizeRequest({ ...base, is_dirty: 1 }).isDirty).toBe(true)
    expect(normalizeRequest({ ...base, isDirty: false }).isDirty).toBe(false)
  })

  it('defaults sortOrder to 0', () => {
    expect(normalizeRequest(base).sortOrder).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// normalizeGroup
// ---------------------------------------------------------------------------
describe('normalizeGroup', () => {
  const base = {
    id: 'grp-1',
    collection_id: 'col-1',
    name: 'Auth',
  }

  it('maps collection_id to collectionId', () => {
    expect(normalizeGroup(base).collectionId).toBe('col-1')
  })

  it('defaults collapsed to false', () => {
    expect(normalizeGroup(base).collapsed).toBe(false)
  })

  it('defaults hidden to false', () => {
    expect(normalizeGroup(base).hidden).toBe(false)
  })

  it('defaults authType to none', () => {
    expect(normalizeGroup(base).authType).toBe('none')
  })

  it('defaults sslVerification to inherit', () => {
    expect(normalizeGroup(base).sslVerification).toBe('inherit')
  })

  it('parses authConfig JSON', () => {
    const r = normalizeGroup({ ...base, auth_config: '{"token":"abc"}' })
    expect(r.authConfig).toEqual({ token: 'abc' })
  })
})

// ---------------------------------------------------------------------------
// kvpToRecord
// ---------------------------------------------------------------------------
describe('kvpToRecord', () => {
  it('converts enabled pairs to a record', () => {
    const result = kvpToRecord([
      { id: '1', key: 'Content-Type', value: 'application/json', enabled: true },
      { id: '2', key: 'Authorization', value: 'Bearer x', enabled: true },
    ])
    expect(result).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer x' })
  })

  it('excludes disabled pairs', () => {
    const result = kvpToRecord([
      { id: '1', key: 'X-Disabled', value: 'yes', enabled: false },
      { id: '2', key: 'X-Active', value: 'yes', enabled: true },
    ])
    expect(result).not.toHaveProperty('X-Disabled')
    expect(result).toHaveProperty('X-Active')
  })

  it('excludes pairs with empty or whitespace-only keys', () => {
    const result = kvpToRecord([
      { id: '1', key: '   ', value: 'x', enabled: true },
      { id: '2', key: '', value: 'y', enabled: true },
    ])
    expect(Object.keys(result)).toHaveLength(0)
  })

  it('returns empty object for empty input', () => {
    expect(kvpToRecord([])).toEqual({})
  })

  it('last value wins for duplicate keys', () => {
    const result = kvpToRecord([
      { id: '1', key: 'X-Foo', value: 'first', enabled: true },
      { id: '2', key: 'X-Foo', value: 'second', enabled: true },
    ])
    expect(result['X-Foo']).toBe('second')
  })
})

// ---------------------------------------------------------------------------
// serializeRequest
// ---------------------------------------------------------------------------
describe('serializeRequest', () => {
  const req = {
    id: 'r1', groupId: 'g1', name: 'Test', method: 'POST' as const,
    url: '/api', params: [{ id: '1', key: 'q', value: '1', enabled: true }],
    headers: [{ id: '2', key: 'Accept', value: '*/*', enabled: true }],
    bodyType: 'json' as const, bodyContent: '{}',
    authType: 'none' as const, authConfig: { token: 'abc' },
    sslVerification: 'inherit' as const, protocol: 'http' as const,
    protocolConfig: {}, isDirty: false, sortOrder: 0,
  }

  it('stringifies params', () => {
    const s = serializeRequest(req)
    expect(typeof s.params).toBe('string')
    expect(JSON.parse(s.params as string)).toEqual(req.params)
  })

  it('stringifies headers', () => {
    const s = serializeRequest(req)
    expect(typeof s.headers).toBe('string')
  })

  it('stringifies authConfig', () => {
    const s = serializeRequest(req)
    expect(JSON.parse(s.authConfig as string)).toEqual({ token: 'abc' })
  })

  it('preserves non-serialized fields', () => {
    const s = serializeRequest(req)
    expect(s.id).toBe('r1')
    expect(s.url).toBe('/api')
    expect(s.method).toBe('POST')
  })

  it('does not mutate the original request', () => {
    serializeRequest(req)
    expect(Array.isArray(req.params)).toBe(true)
  })
})
