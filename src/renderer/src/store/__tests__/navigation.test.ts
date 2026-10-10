import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubGlobal('window', {
  api: { drafts: { request: { get: vi.fn().mockResolvedValue({ data: null }), upsert: vi.fn(), delete: vi.fn() } }, requests: { update: vi.fn() } },
})

const reqs = ['a', 'b', 'c'].map((id) => ({
  id, name: id, method: 'GET', url: `https://x/${id}`, headers: [], params: [], bodyType: 'none', bodyContent: '',
  authType: 'none', authConfig: {}, protocol: 'http', protocolConfig: {}, folderId: 'f', isDirty: false, sortOrder: 0,
}))

vi.mock('../collections', () => ({
  useCollectionsStore: { getState: () => ({ requests: reqs, syncRequest: vi.fn() }) },
}))

vi.mock('../ui', () => ({ useUIStore: { getState: () => ({ clearSelectedItem: vi.fn() }) } }))

import { useRequestsStore } from '../requests'
import { useNavigationStore } from '../navigation'

const open = (id: string) => useRequestsStore.getState().setActiveRequest(reqs.find((r) => r.id === id) as never)
const active = () => useRequestsStore.getState().activeRequestId

beforeEach(() => {
  useNavigationStore.setState({ stack: [], index: -1 })
  useRequestsStore.setState({ activeRequestId: null, editingRequest: null })
})

describe('useNavigationStore', () => {
  it('goes back and forward through opened requests', () => {
    open('a'); open('b'); open('c')
    useNavigationStore.getState().go(-1)
    expect(active()).toBe('b')
    useNavigationStore.getState().go(-1)
    expect(active()).toBe('a')
    useNavigationStore.getState().go(1)
    expect(active()).toBe('b')
  })

  it('drops forward entries when opening something new', () => {
    open('a'); open('b')
    useNavigationStore.getState().go(-1)
    open('c')
    expect(useNavigationStore.getState().stack).toEqual(['a', 'c'])
  })

  it('does not record the same request twice in a row or history scratch requests', () => {
    open('a'); open('a')
    useRequestsStore.setState({ activeRequestId: 'scratch:1' })
    expect(useNavigationStore.getState().stack).toEqual(['a'])
  })
})
