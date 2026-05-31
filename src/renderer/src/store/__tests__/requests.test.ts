import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock window.api before importing the store
const mockHttpExecute = vi.fn()
const mockHttpCancel = vi.fn()
const mockDraftsGet = vi.fn()
const mockDraftsUpsert = vi.fn()
const mockDraftsDelete = vi.fn()
const mockRequestsUpdate = vi.fn()

vi.stubGlobal('window', {
  api: {
    http: { execute: mockHttpExecute, cancel: mockHttpCancel },
    drafts: { request: { get: mockDraftsGet, upsert: mockDraftsUpsert, delete: mockDraftsDelete } },
    requests: { update: mockRequestsUpdate },
  },
})

// Mock the collections store
vi.mock('../collections', () => ({
  useCollectionsStore: {
    getState: () => ({ syncRequest: vi.fn(), groups: [], collections: [], markDirty: vi.fn() }),
  },
}))

import { useRequestsStore } from '../requests'
import type { Request } from '@/types'

function makeRequest(overrides: Partial<Request> = {}): Request {
  return {
    id: 'req-1',
    name: 'Test Request',
    method: 'GET',
    url: 'https://example.com',
    headers: [],
    params: [],
    bodyType: 'none',
    bodyContent: '',
    authType: 'none',
    authConfig: {},
    protocol: 'http',
    protocolConfig: {},
    sslVerification: 'inherit',
    isDirty: false,
    groupId: 'group-1',
    sortOrder: 0,
    ...overrides,
  }
}

function makeResponse() {
  return { status: 200, statusText: 'OK', headers: {}, body: '{}', duration: 50, size: 2 }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDraftsGet.mockResolvedValue({ data: null })
  mockDraftsUpsert.mockResolvedValue({})
  mockDraftsDelete.mockResolvedValue({})
  mockRequestsUpdate.mockResolvedValue({ error: null })
  // Reset store state between tests
  useRequestsStore.setState({
    activeRequestId: null,
    editingRequest: null,
    savedRequest: null,
    response: null,
    isLoading: false,
  })
})

describe('useRequestsStore — sendRequest', () => {
  it('sets isLoading=true while the request is in flight', async () => {
    let resolveExecute!: (v: unknown) => void
    mockHttpExecute.mockReturnValue(new Promise((r) => { resolveExecute = r }))

    useRequestsStore.setState({ editingRequest: makeRequest() })

    const sendPromise = useRequestsStore.getState().sendRequest()
    expect(useRequestsStore.getState().isLoading).toBe(true)

    resolveExecute({ data: makeResponse() })
    await sendPromise
    expect(useRequestsStore.getState().isLoading).toBe(false)
  })

  it('clears isLoading and sets response on success', async () => {
    mockHttpExecute.mockResolvedValue({ data: makeResponse() })
    useRequestsStore.setState({ editingRequest: makeRequest() })

    await useRequestsStore.getState().sendRequest()

    const { isLoading, response } = useRequestsStore.getState()
    expect(isLoading).toBe(false)
    expect(response?.status).toBe(200)
  })

  it('clears isLoading and sets error response when execute returns an error', async () => {
    mockHttpExecute.mockResolvedValue({ error: 'Connection refused' })
    useRequestsStore.setState({ editingRequest: makeRequest() })

    await useRequestsStore.getState().sendRequest()

    const { isLoading, response } = useRequestsStore.getState()
    expect(isLoading).toBe(false)
    expect(response?.statusText).toBe('Connection refused')
  })

  it('blocks a second sendRequest call while one is already in flight', async () => {
    let resolveFirst!: (v: unknown) => void
    mockHttpExecute.mockReturnValueOnce(new Promise((r) => { resolveFirst = r }))

    useRequestsStore.setState({ editingRequest: makeRequest() })

    const firstSend = useRequestsStore.getState().sendRequest()
    // Attempt second send while first is in flight
    await useRequestsStore.getState().sendRequest()

    // Only one http.execute call should have been made
    expect(mockHttpExecute).toHaveBeenCalledTimes(1)

    resolveFirst({ data: makeResponse() })
    await firstSend
  })

  it('does nothing when no editingRequest is set', async () => {
    await useRequestsStore.getState().sendRequest()
    expect(mockHttpExecute).not.toHaveBeenCalled()
  })

  it('clears response on start', async () => {
    mockHttpExecute.mockResolvedValue({ data: makeResponse() })
    useRequestsStore.setState({ editingRequest: makeRequest(), response: makeResponse() })

    // Start but don't await — check that response was cleared immediately
    let resolveExecute!: (v: unknown) => void
    mockHttpExecute.mockReturnValue(new Promise((r) => { resolveExecute = r }))

    const sendPromise = useRequestsStore.getState().sendRequest()
    expect(useRequestsStore.getState().response).toBeNull()

    resolveExecute({ data: makeResponse() })
    await sendPromise
  })
})

describe('useRequestsStore — cancelRequest', () => {
  it('calls window.api.http.cancel', () => {
    useRequestsStore.getState().cancelRequest()
    expect(mockHttpCancel).toHaveBeenCalledOnce()
  })
})
