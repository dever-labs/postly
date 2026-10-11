import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() })
vi.stubGlobal('window', { api: {} })
vi.mock('../requests', () => ({
  isScratchId: (id: string) => id.startsWith('scratch:'),
  useRequestsStore: { subscribe: vi.fn() },
}))

import { buildWorkingSet, stepWorkingSet, useWorkingSetStore, MAX_RECENT } from '../workingSet'

const all = () => true

beforeEach(() => useWorkingSetStore.setState({ recent: [], pinned: [] }))

describe('buildWorkingSet', () => {
  it('orders pinned, then unsaved, then recent, showing each request once', () => {
    expect(buildWorkingSet(['p', 'd'], ['d', 'u'], ['r', 'u', 'p'], all)).toEqual(['p', 'd', 'u', 'r'])
  })

  it('drops requests that no longer exist', () => {
    expect(buildWorkingSet(['gone'], ['u'], ['r'], (id) => id !== 'gone')).toEqual(['u', 'r'])
  })
})

describe('useWorkingSetStore', () => {
  it('keeps the most recent first, de-duplicated and capped', () => {
    const { touch } = useWorkingSetStore.getState()
    for (let i = 0; i < MAX_RECENT + 3; i++) touch(`r${i}`)
    touch('r5')
    const { recent } = useWorkingSetStore.getState()
    expect(recent).toHaveLength(MAX_RECENT)
    expect(recent[0]).toBe('r5')
    expect(new Set(recent).size).toBe(MAX_RECENT)
  })

  it('toggles pins and persists them', () => {
    useWorkingSetStore.getState().togglePin('a')
    expect(useWorkingSetStore.getState().pinned).toEqual(['a'])
    expect(localStorage.setItem).toHaveBeenCalledWith('postly-pinned-requests', '["a"]')
    useWorkingSetStore.getState().togglePin('a')
    expect(useWorkingSetStore.getState().pinned).toEqual([])
  })
})

describe('stepWorkingSet', () => {
  const ids = ['a', 'b', 'c']
  it('moves and wraps in both directions', () => {
    expect(stepWorkingSet(ids, 'a', 1)).toBe('b')
    expect(stepWorkingSet(ids, 'c', 1)).toBe('a')
    expect(stepWorkingSet(ids, 'a', -1)).toBe('c')
  })
  it('starts at the first/last item when nothing in the set is active', () => {
    expect(stepWorkingSet(ids, null, 1)).toBe('a')
    expect(stepWorkingSet(ids, 'zzz', -1)).toBe('c')
  })
  it('returns null for an empty set', () => {
    expect(stepWorkingSet([], 'a', 1)).toBeNull()
  })
})
