// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import React from 'react'
import type { HistoryEntrySummary, Request } from '@/types'

const mocks = vi.hoisted(() => ({
  clearSelectedItem: vi.fn(),
}))

const mockHttpExecute = vi.fn()
const mockOnStream = vi.fn(() => () => undefined)
const mockHistoryGet = vi.fn(async () => null)
const mockHistoryDelete = vi.fn(async () => undefined)
const mockHistoryClear = vi.fn(async () => undefined)

let historyEntries: HistoryEntrySummary[] = []

vi.stubGlobal('window', {
  api: {
    http: { execute: mockHttpExecute, cancel: vi.fn(), onStream: mockOnStream },
    history: {
      list: vi.fn(async () => ({ data: historyEntries })),
      get: mockHistoryGet,
      delete: mockHistoryDelete,
      clear: mockHistoryClear,
    },
    drafts: { request: { get: vi.fn(async () => ({ data: null })), upsert: vi.fn(async () => ({})), delete: vi.fn(async () => ({})) } },
    requests: { update: vi.fn(async () => ({ error: null })) },
  },
})

vi.mock('@/store/collections', () => ({
  useCollectionsStore: {
    getState: () => ({ syncRequest: vi.fn(), folders: [], collections: [], markDirty: vi.fn(), requests: [] }),
  },
}))

vi.mock('@/store/ui', async () => {
  const { create } = await import('zustand')
  const useUIStore = create(() => ({
    clearSelectedItem: mocks.clearSelectedItem,
  }))
  return { useUIStore }
})

import { HistoryPanel } from '../HistoryPanel'
import { useHistoryStore } from '@/store/history'
import { useRequestsStore } from '@/store/requests'

function makeRequest(): Request {
  return {
    id: 'req-1',
    folderId: 'folder-1',
    name: 'History test',
    protocol: 'http',
    method: 'GET',
    url: 'https://example.test/users',
    params: [],
    headers: [],
    bodyType: 'none',
    bodyContent: '',
    authType: 'none',
    authConfig: {},
    protocolConfig: {},
    sslVerification: 'inherit',
    isDirty: false,
    sortOrder: 0,
  }
}

beforeEach(() => {
  historyEntries = []
  mocks.clearSelectedItem.mockReset()
  mockHttpExecute.mockReset()
  mockOnStream.mockClear()
  useHistoryStore.setState({ entries: [], search: '', loading: false })
  useRequestsStore.setState({
    activeRequestId: null,
    editingRequest: makeRequest(),
    savedRequest: makeRequest(),
    response: null,
    isLoading: false,
    stream: null,
  })
})

afterEach(() => {
  cleanup()
})

describe('HistoryPanel', () => {
  it('shows a newly recorded history entry after a mounted request completes', async () => {
    mockHttpExecute.mockImplementation(async () => {
      historyEntries = [{
        id: 'hist-1',
        createdAt: Date.now(),
        protocol: 'http',
        method: 'GET',
        url: 'https://example.test/users',
        status: 200,
        statusText: 'OK',
        duration: 12,
        size: 128,
      }]
      return {
        data: {
          status: 200,
          statusText: 'OK',
          headers: {},
          body: '{"ok":true}',
          duration: 12,
          size: 128,
        },
      }
    })

    const view = render(<HistoryPanel />)

    expect(await view.findByTestId('history-empty')).toBeDefined()

    await act(async () => {
      await useRequestsStore.getState().sendRequest()
    })

    expect(await view.findByText('https://example.test/users')).toBeDefined()
  })
})
