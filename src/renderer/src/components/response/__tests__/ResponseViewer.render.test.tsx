// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, waitFor } from '@testing-library/react'
import React from 'react'
import type { HttpResponse } from '@/types'

const mocks = vi.hoisted(() => ({
  resumeStream: vi.fn(),
  statusRenders: vi.fn(),
}))

vi.mock('@/store/requests', async () => {
  const { create } = await import('zustand')
  const useRequestsStore = create(() => ({
    response: null as HttpResponse | null,
    isLoading: false,
    stream: null,
    resumeStream: mocks.resumeStream,
    activeRequestId: null as string | null,
  }))
  return { useRequestsStore }
})

vi.mock('@/components/response/tabs/PrettyTab', () => ({
  PrettyTab: ({ body }: { body: string }) => <div>{body}</div>,
}))
vi.mock('@/components/response/tabs/RawTab', () => ({
  RawTab: ({ body }: { body: string }) => <div>{body}</div>,
}))
vi.mock('@/components/response/tabs/PreviewTab', () => ({
  PreviewTab: () => <div />,
}))
vi.mock('@/components/response/tabs/ConsoleTab', () => ({
  ConsoleTab: () => <div />,
}))
vi.mock('@/components/response/ResponseStatus', () => ({
  ResponseStatus: ({ response }: { response: HttpResponse }) => {
    mocks.statusRenders(response.status)
    return <div>{response.status}</div>
  },
}))

import { ResponseViewer } from '../ResponseViewer'
import { useRequestsStore as requestsStore } from '@/store/requests'

function makeResponse(): HttpResponse {
  return {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    body: '{"message":"ok"}',
    size: 16,
    duration: 42,
    logs: [],
  }
}

beforeEach(() => {
  mocks.resumeStream.mockClear()
  mocks.statusRenders.mockClear()
  requestsStore.setState({
    response: makeResponse(),
    isLoading: false,
    stream: null,
    resumeStream: mocks.resumeStream,
    activeRequestId: null,
  })
})

afterEach(cleanup)

describe('ResponseViewer selectors', () => {
  it('does not rerender for unrelated request-store updates', async () => {
    render(<ResponseViewer />)
    await waitFor(() => expect(mocks.statusRenders).toHaveBeenCalled())
    const initialCalls = mocks.statusRenders.mock.calls.length

    act(() => {
      requestsStore.setState({ activeRequestId: 'req-2' })
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.statusRenders.mock.calls).toHaveLength(initialCalls)
  })
})
