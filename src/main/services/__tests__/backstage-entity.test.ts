import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../database', () => ({ queryAll: vi.fn() }))

import { queryAll } from '../../database'
import { findEntityCollection, providingComponents } from '../backstage-entity'

// The exact source_meta shapes syncCatalog() writes.
const ROWS = [
  { id: 'col-mockly', source_meta: JSON.stringify({ component: 'mockly', namespace: 'mockly' }) },
  { id: 'col-orphan-api', source_meta: JSON.stringify({ entityName: 'orphan-api', entityNamespace: 'default' }) },
  { id: 'col-broken', source_meta: '{not json' },
]

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(queryAll).mockReturnValue(ROWS)
})

describe('findEntityCollection', () => {
  it('finds a component collection directly', async () => {
    const fetchEntity = vi.fn()
    await expect(findEntityCollection('i1', { kind: 'component', namespace: 'mockly', name: 'mockly' }, fetchEntity)).resolves.toBe('col-mockly')
    expect(fetchEntity).not.toHaveBeenCalled()
    expect(vi.mocked(queryAll).mock.calls[0][1]).toEqual(['i1'])
  })

  it('finds a standalone API collection without asking the catalog (case-insensitive)', async () => {
    const fetchEntity = vi.fn()
    await expect(findEntityCollection('i1', { kind: 'api', namespace: 'Default', name: 'Orphan-API' }, fetchEntity)).resolves.toBe('col-orphan-api')
    expect(fetchEntity).not.toHaveBeenCalled()
  })

  it('finds an API through the component that provides it', async () => {
    const fetchEntity = vi.fn().mockResolvedValue({
      relations: [
        { type: 'ownedBy', targetRef: 'group:default/team' },
        { type: 'apiProvidedBy', targetRef: 'component:mockly/mockly' },
      ],
    })
    const ref = { kind: 'api' as const, namespace: 'mockly', name: 'mockly-management-api' }
    await expect(findEntityCollection('i1', ref, fetchEntity)).resolves.toBe('col-mockly')
    expect(fetchEntity).toHaveBeenCalledWith(ref)
  })

  it('returns null when nothing matches', async () => {
    await expect(findEntityCollection('i1', { kind: 'api', namespace: 'default', name: 'nope' }, vi.fn().mockResolvedValue(null))).resolves.toBeNull()
    await expect(findEntityCollection('i1', { kind: 'component', namespace: 'other', name: 'mockly' }, vi.fn())).resolves.toBeNull()
  })
})

describe('providingComponents', () => {
  it('only reads component apiProvidedBy relations', () => {
    expect(providingComponents({ relations: [
      { type: 'apiProvidedBy', targetRef: 'component:default/a' },
      { type: 'apiProvidedBy', targetRef: 'system:default/b' },
      { type: 'apiConsumedBy', targetRef: 'component:default/c' },
      'junk',
    ] })).toEqual([{ namespace: 'default', name: 'a' }])
    expect(providingComponents(null)).toEqual([])
  })
})
