// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import React from 'react'

const mocks = vi.hoisted(() => ({
  load: vi.fn(async () => undefined),
  openHistoryEntry: vi.fn(),
  clearSelectedItem: vi.fn(),
}))

vi.mock('@/store/history', async () => {
  const { create } = await import('zustand')
  const useHistoryStore = create(() => ({
    entries: [],
    search: '',
    loading: false,
    load: mocks.load,
    setSearch: (search: string) => useHistoryStore.setState({ search }),
    open: async () => null,
    remove: async () => undefined,
    clear: async () => undefined,
  }))
  return { useHistoryStore }
})

vi.mock('@/store/requests', async () => {
  const { create } = await import('zustand')
  const useRequestsStore = create(() => ({
    activeRequestId: null as string | null,
    response: null as Record<string, unknown> | null,
    openHistoryEntry: mocks.openHistoryEntry,
  }))
  return { useRequestsStore }
})

vi.mock('@/store/ui', async () => {
  const { create } = await import('zustand')
  const useUIStore = create(() => ({
    clearSelectedItem: mocks.clearSelectedItem,
  }))
  return { useUIStore }
})

import { HistoryPanel } from '../HistoryPanel'
import { useHistoryStore as historyStore } from '@/store/history'
import { useRequestsStore as requestsStore } from '@/store/requests'

beforeEach(() => {
  vi.useFakeTimers()
  mocks.load.mockClear()
  mocks.openHistoryEntry.mockClear()
  mocks.clearSelectedItem.mockClear()
  historyStore.setState({ entries: [], search: '', loading: false, load: mocks.load })
  requestsStore.setState({ activeRequestId: null, response: null, openHistoryEntry: mocks.openHistoryEntry })
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

describe('HistoryPanel', () => {
  it('does not reload history when only the active response changes', async () => {
    render(<HistoryPanel />)

    await act(async () => {
      await vi.runAllTimersAsync()
    })
    expect(mocks.load).toHaveBeenCalledTimes(1)

    act(() => {
      requestsStore.setState({
        response: { status: 200, statusText: 'OK', headers: {}, body: '', duration: 1, size: 0 },
      })
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.load).toHaveBeenCalledTimes(1)
  })
})
