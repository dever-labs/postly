import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() })
vi.stubGlobal('window', { api: {} })
vi.mock('../requests', () => ({
  isScratchId: (id: string) => id.startsWith('scratch:'),
  useRequestsStore: { subscribe: vi.fn() },
}))

import { buildWorkingSet, useWorkingSetStore, MAX_RECENT } from '../workingSet'

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
