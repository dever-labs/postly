import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockHttpExecute = vi.fn()
const mockHttpCancel = vi.fn()
let streamListener: ((m: unknown) => void) | null = null
const mockOnStream = vi.fn((cb: (m: unknown) => void) => { streamListener = cb; return () => { streamListener = null } })
const mockDraftsGet = vi.fn()
const mockDraftsUpsert = vi.fn()
const mockDraftsDelete = vi.fn()
const mockRequestsUpdate = vi.fn()

vi.stubGlobal('window', {
  api: {
    http: { execute: mockHttpExecute, cancel: mockHttpCancel, onStream: mockOnStream },
    drafts: { request: { get: mockDraftsGet, upsert: mockDraftsUpsert, delete: mockDraftsDelete } },
    requests: { update: mockRequestsUpdate },
  },
})

vi.mock('../collections', () => ({
  useCollectionsStore: {
    getState: () => ({ syncRequest: vi.fn(), folders: [], collections: [], markDirty: vi.fn(), requests: [] }),
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
    folderId: 'folder-1',
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
    mockHttpExecute.mockReturnValue(new Promise((resolve) => { resolveExecute = resolve }))

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
    mockHttpExecute.mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve }))

    useRequestsStore.setState({ editingRequest: makeRequest() })

    const firstSend = useRequestsStore.getState().sendRequest()
    await useRequestsStore.getState().sendRequest()
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

    let resolveExecute!: (v: unknown) => void
    mockHttpExecute.mockReturnValue(new Promise((resolve) => { resolveExecute = resolve }))

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

describe('useRequestsStore — history (scratch) requests', () => {
  const entry = {
    id: 'h1', createdAt: 1, protocol: 'http', method: 'POST', url: 'https://api.test/x', status: 201,
    statusText: 'Created', duration: 12, size: 4,
    request: { method: 'POST', url: 'https://api.test/x', headers: { 'X-A': '1' }, params: { q: 'z' }, body: '{}', bodyType: 'json' },
    responseHeaders: { 'content-type': 'application/json' }, responseBody: '{"ok":1}', bodyTruncated: false,
  } as unknown as Parameters<ReturnType<typeof useRequestsStore.getState>['openHistoryEntry']>[0]

  beforeEach(() => {
    mockDraftsUpsert.mockClear()
    mockRequestsUpdate.mockClear()
  })

  it('opens an entry with its request and stored response', () => {
    useRequestsStore.getState().openHistoryEntry(entry)
    const s = useRequestsStore.getState()
    expect(s.activeRequestId).toBe('scratch:h1')
    expect(s.editingRequest?.url).toBe('https://api.test/x')
    expect(s.editingRequest?.headers).toMatchObject([{ key: 'X-A', value: '1', enabled: true }])
    expect(s.response?.status).toBe(201)
  })

  it('never persists drafts or saves, and does not become dirty', async () => {
    useRequestsStore.getState().openHistoryEntry(entry)
    useRequestsStore.getState().updateField('url', 'https://api.test/y')
    await useRequestsStore.getState().saveRequest()
    await new Promise((r) => setTimeout(r, 2100))
    const s = useRequestsStore.getState()
    expect(s.editingRequest?.url).toBe('https://api.test/y')
    expect(s.editingRequest?.isDirty).toBe(false)
    expect(mockDraftsUpsert).not.toHaveBeenCalled()
    expect(mockRequestsUpdate).not.toHaveBeenCalled()
  })
})

describe('useRequestsStore — streaming responses', () => {
  beforeEach(() => {
    useRequestsStore.setState({ editingRequest: makeRequest(), isLoading: false, response: null, stream: null })
  })

  it('shows events live, then keeps them when the response completes', async () => {
    let finish: (v: unknown) => void = () => {}
    mockHttpExecute.mockReturnValue(new Promise((r) => { finish = r }))
    const sending = useRequestsStore.getState().sendRequest()

    streamListener?.({ type: 'start', kind: 'sse', status: 200, statusText: 'OK', headers: {} })
    streamListener?.({ type: 'events', events: [{ index: 1, id: '1', data: 'a', at: 0 }, { index: 2, id: '2', data: 'b', at: 5 }] })
    let state = useRequestsStore.getState()
    expect(state.isLoading).toBe(true)
    expect(state.response?.status).toBe(200)
    expect(state.stream).toMatchObject({ kind: 'sse', active: true })
    expect(state.stream?.events.map((e) => e.data)).toEqual(['a', 'b'])

    finish({ data: { ...makeResponse(), body: 'id: 1\n' } })
    await sending
    state = useRequestsStore.getState()
    expect(state.isLoading).toBe(false)
    expect(state.stream?.active).toBe(false)
    expect(state.stream?.events).toHaveLength(2)
  })

  it('keeps only the latest 5000 events and counts the dropped ones', async () => {
    let finish: (v: unknown) => void = () => {}
    mockHttpExecute.mockReturnValue(new Promise((r) => { finish = r }))
    const sending = useRequestsStore.getState().sendRequest()
    streamListener?.({ type: 'start', kind: 'ndjson', status: 200, statusText: 'OK', headers: {} })
    const batch = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ index: from + i, data: String(from + i), at: 0 }))
    streamListener?.({ type: 'events', events: batch(1, 4000) })
    streamListener?.({ type: 'events', events: batch(4001, 2000) })
    const { stream } = useRequestsStore.getState()
    expect(stream?.events).toHaveLength(5000)
    expect(stream?.dropped).toBe(1000)
    expect(stream?.events[0].index).toBe(1001)
    finish({ data: makeResponse() })
    await sending
  })

  it('resumes with Last-Event-ID and appends to the earlier events', async () => {
    useRequestsStore.setState({
      stream: { kind: 'sse', dropped: 0, active: false, events: [{ index: 1, id: '7', data: 'x', at: 0 }] },
    })
    let finish: (v: unknown) => void = () => {}
    mockHttpExecute.mockReturnValue(new Promise((r) => { finish = r }))
    useRequestsStore.getState().resumeStream()
    expect((mockHttpExecute.mock.calls[0][0] as { headers: Record<string, string> }).headers['Last-Event-ID']).toBe('7')
    streamListener?.({ type: 'start', kind: 'sse', status: 200, statusText: 'OK', headers: {} })
    streamListener?.({ type: 'events', events: [{ index: 1, id: '8', data: 'y', at: 0 }] })
    expect(useRequestsStore.getState().stream?.events.map((e) => [e.index, e.data])).toEqual([[1, 'x'], [2, 'y']])
    finish({ data: makeResponse() })
    await vi.waitFor(() => expect(useRequestsStore.getState().isLoading).toBe(false))
  })

  it('does nothing when no event carries an id', () => {
    useRequestsStore.setState({ stream: { kind: 'sse', dropped: 0, active: false, events: [{ index: 1, data: 'x', at: 0 }] } })
    useRequestsStore.getState().resumeStream()
    expect(mockHttpExecute).not.toHaveBeenCalled()
  })
})
