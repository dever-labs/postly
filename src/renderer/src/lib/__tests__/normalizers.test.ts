import { describe, it, expect } from 'vitest'
import { parseJsonField, normalizeRequest, normalizeGroup, normalizeFolder, kvpToRecord, serializeRequest } from '../normalizers'

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

describe('normalizeRequest', () => {
  const base = {
    id: 'req-1',
    folder_id: 'fld-1',
    name: 'Get Users',
    method: 'GET',
    url: '/api/users',
  }

  it('maps camelCase and snake_case fields', () => {
    const request = normalizeRequest(base)
    expect(request.id).toBe('req-1')
    expect(request.folderId).toBe('fld-1')
    expect(request.name).toBe('Get Users')
  })

  it('maps folder_id to folderId', () => {
    const request = normalizeRequest({ ...base, folder_id: 'folder-from-snake' })
    expect(request.folderId).toBe('folder-from-snake')
  })

  it('defaults method to GET', () => {
    expect(normalizeRequest({ ...base, method: undefined }).method).toBe('GET')
  })

  it('defaults url to empty string', () => {
    expect(normalizeRequest({ ...base, url: undefined }).url).toBe('')
  })

  it('defaults bodyType to none', () => {
    expect(normalizeRequest(base).bodyType).toBe('none')
  })

  it('defaults protocol to http', () => {
    expect(normalizeRequest(base).protocol).toBe('http')
  })

  it('defaults authType to none', () => {
    expect(normalizeRequest(base).authType).toBe('none')
  })

  it('parses params JSON string', () => {
    const request = normalizeRequest({ ...base, params: '[{"id":"1","key":"q","value":"test","enabled":true}]' })
    expect(request.params).toHaveLength(1)
    expect(request.params[0].key).toBe('q')
  })

  it('defaults params to empty array on bad JSON', () => {
    expect(normalizeRequest({ ...base, params: 'bad' }).params).toEqual([])
  })

  it('prefers camelCase over snake_case for folderId', () => {
    const request = normalizeRequest({ ...base, folderId: 'camel', folder_id: 'snake' })
    expect(request.folderId).toBe('camel')
  })

  it('maps isDirty correctly', () => {
    expect(normalizeRequest({ ...base, is_dirty: 1 }).isDirty).toBe(true)
    expect(normalizeRequest({ ...base, isDirty: false }).isDirty).toBe(false)
  })

  it('defaults sortOrder to 0', () => {
    expect(normalizeRequest(base).sortOrder).toBe(0)
  })
})

describe('normalizeFolder', () => {
  const base = {
    id: 'fld-1',
    parent_id: 'col-1',
    name: 'Auth',
  }

  it('normalizes all folder fields from snake_case input', () => {
    const folder = normalizeFolder({
      id: 'fld-1',
      parent_id: 'col-1',
      name: 'Auth',
      description: 'Folder description',
      source: 'local',
      hidden: 0,
      collapsed: 0,
      sort_order: 7,
      created_at: 123,
      updated_at: 456,
      auth_type: 'bearer',
      auth_config: '{"token":"abc"}',
      ssl_verification: 'disabled',
    })

    expect(folder).toEqual({
      id: 'fld-1',
      parentId: 'col-1',
      name: 'Auth',
      description: 'Folder description',
      source: 'local',
      sourceMeta: undefined,
      integrationId: undefined,
      authType: 'bearer',
      authConfig: { token: 'abc' },
      sslVerification: 'disabled',
      hidden: false,
      collapsed: false,
      sortOrder: 7,
      createdAt: 123,
      updatedAt: 456,
    })
  })

  it('maps parent_id to parentId', () => {
    expect(normalizeFolder(base).parentId).toBe('col-1')
  })

  it('handles missing optional fields with defaults', () => {
    expect(normalizeFolder({ id: 'fld-2', name: 'Empty' })).toEqual({
      id: 'fld-2',
      parentId: undefined,
      name: 'Empty',
      description: '',
      source: 'local',
      sourceMeta: undefined,
      integrationId: undefined,
      authType: 'none',
      authConfig: {},
      sslVerification: 'inherit',
      hidden: false,
      collapsed: false,
      sortOrder: 0,
      createdAt: 0,
      updatedAt: 0,
    })
  })

  it('handles camelCase parentId as well as snake_case parent_id', () => {
    const folder = normalizeFolder({ ...base, parentId: 'camel-parent', parent_id: 'snake-parent' })
    expect(folder.parentId).toBe('camel-parent')
  })

  it('defaults collapsed to false', () => {
    expect(normalizeFolder(base).collapsed).toBe(false)
  })

  it('defaults hidden to false', () => {
    expect(normalizeFolder(base).hidden).toBe(false)
  })

  it('defaults authType to none', () => {
    expect(normalizeGroup(base).authType).toBe('none')
  })

  it('defaults sslVerification to inherit', () => {
    expect(normalizeGroup(base).sslVerification).toBe('inherit')
  })

  it('parses authConfig JSON', () => {
    const folder = normalizeGroup({ ...base, auth_config: '{"token":"abc"}' })
    expect(folder.authConfig).toEqual({ token: 'abc' })
  })
})

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

describe('serializeRequest', () => {
  const req = {
    id: 'r1', folderId: 'f1', name: 'Test', method: 'POST' as const,
    url: '/api', params: [{ id: '1', key: 'q', value: '1', enabled: true }],
    headers: [{ id: '2', key: 'Accept', value: '*/*', enabled: true }],
    bodyType: 'json' as const, bodyContent: '{}',
    authType: 'none' as const, authConfig: { token: 'abc' },
    sslVerification: 'inherit' as const, protocol: 'http' as const,
    protocolConfig: {}, isDirty: false, sortOrder: 0,
  }

  it('stringifies params', () => {
    const serialized = serializeRequest(req)
    expect(typeof serialized.params).toBe('string')
    expect(JSON.parse(serialized.params as string)).toEqual(req.params)
  })

  it('stringifies headers', () => {
    const serialized = serializeRequest(req)
    expect(typeof serialized.headers).toBe('string')
  })

  it('stringifies authConfig', () => {
    const serialized = serializeRequest(req)
    expect(JSON.parse(serialized.authConfig as string)).toEqual({ token: 'abc' })
  })

  it('preserves non-serialized fields', () => {
    const serialized = serializeRequest(req)
    expect(serialized.id).toBe('r1')
    expect(serialized.url).toBe('/api')
    expect(serialized.method).toBe('POST')
  })

  it('does not mutate the original request', () => {
    serializeRequest(req)
    expect(Array.isArray(req.params)).toBe(true)
  })
})
