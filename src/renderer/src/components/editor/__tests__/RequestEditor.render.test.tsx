// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, waitFor } from '@testing-library/react'
import React from 'react'
import type { Request } from '@/types'

const mocks = vi.hoisted(() => ({
  urlBarRenders: vi.fn(),
  saveRequest: vi.fn(async () => undefined),
}))

vi.mock('@/components/editor/MethodSelector', () => ({ MethodSelector: () => <div /> }))
vi.mock('@/components/editor/UrlBar', () => ({
  UrlBar: ({ value }: { value: string }) => {
    mocks.urlBarRenders(value)
    return <div>{value}</div>
  },
}))
vi.mock('@/components/editor/CurlCopyMenu', () => ({ CurlCopyMenu: () => <div /> }))
vi.mock('@/components/editor/SendButton', () => ({ SendButton: () => <button type="button">send</button> }))
vi.mock('@/components/editor/ProtocolSelector', () => ({ ProtocolSelector: () => <div /> }))
vi.mock('@/components/editor/WebSocketView', () => ({ WebSocketView: () => <div /> }))
vi.mock('@/components/editor/GrpcView', () => ({ GrpcView: () => <div /> }))
vi.mock('@/components/editor/MqttView', () => ({ MqttView: () => <div /> }))
vi.mock('@/components/editor/tabs/ParamsTab', () => ({ ParamsTab: () => <div /> }))
vi.mock('@/components/editor/tabs/HeadersTab', () => ({ HeadersTab: () => <div /> }))
vi.mock('@/components/editor/tabs/AuthTab', () => ({ AuthTab: () => <div /> }))
vi.mock('@/components/editor/tabs/ExtractTab', () => ({ ExtractTab: () => <div /> }))
vi.mock('@/components/editor/SslEditor', () => ({ SslEditor: () => <div /> }))
vi.mock('@/components/editor/NetworkEditor', () => ({ GRID: '', NetworkEditor: () => <div /> }))
vi.mock('@/components/ui/Tabs', () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: React.ReactNode }) => <button type="button">{children}</button>,
  TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/editor/useInheritedNetwork', () => ({ useInheritedNetwork: () => undefined }))
vi.mock('@/hooks/useShortcuts', () => ({ useShortcut: vi.fn() }))
vi.mock('@/lib/shortcutHint', () => ({ withShortcut: (label: string) => label }))
vi.mock('@/lib/curlActions', () => ({ importCurlIntoActive: vi.fn() }))
vi.mock('@/lib/curl', () => ({ looksLikeCurl: () => false }))
vi.mock('@/store/requests', async () => {
  const { create } = await import('zustand')
  const useRequestsStore = create(() => ({
    activeRequestId: 'req-1' as string | null,
    editingRequest: null as Request | null,
    isLoading: false,
    response: null as Record<string, unknown> | null,
    updateField: vi.fn(),
    sendRequest: vi.fn(async () => undefined),
    cancelRequest: vi.fn(),
    saveRequest: mocks.saveRequest,
    discardDraft: vi.fn(async () => undefined),
  }))
  return {
    useRequestsStore,
    isScratchId: (id: string | null | undefined) => !!id && id.startsWith('scratch:'),
  }
})
vi.mock('@/store/collections', async () => {
  const { create } = await import('zustand')
  const useCollectionsStore = create(() => ({
    folders: [{ id: 'folder-1', parentId: undefined, name: 'Collection', source: 'local', integrationId: null }],
    requests: [{ id: 'req-1', folderId: 'folder-1' }],
  }))
  return { useCollectionsStore }
})
vi.mock('@/store/integrations', async () => {
  const { create } = await import('zustand')
  const useIntegrationsStore = create(() => ({ integrations: [] }))
  return { useIntegrationsStore }
})
vi.mock('@/store/ui', async () => {
  const { create } = await import('zustand')
  const useUIStore = create(() => ({
    selectItem: vi.fn(),
    openGitAction: vi.fn(),
  }))
  return { useUIStore }
})
vi.mock('@/store/navigation', async () => {
  const { create } = await import('zustand')
  const useNavigationStore = create(() => ({
    stack: ['req-1'],
    index: 0,
    go: vi.fn(),
  }))
  return { useNavigationStore }
})

import { RequestEditor } from '../RequestEditor'
import { useRequestsStore as requestsStore } from '@/store/requests'

const request: Request = {
  id: 'req-1',
  folderId: 'folder-1',
  name: 'Demo request',
  protocol: 'http',
  method: 'GET',
  url: 'https://example.test',
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

beforeEach(() => {
  mocks.urlBarRenders.mockClear()
  mocks.saveRequest.mockClear()
  requestsStore.setState({
    activeRequestId: 'req-1',
    editingRequest: request,
    isLoading: false,
    response: null,
    saveRequest: mocks.saveRequest,
  })
})

afterEach(cleanup)

describe('RequestEditor selectors', () => {
  it('does not rerender for unrelated request-store updates', async () => {
    render(<RequestEditor />)
    await waitFor(() => expect(mocks.urlBarRenders).toHaveBeenCalled())
    const initialCalls = mocks.urlBarRenders.mock.calls.length

    act(() => {
      requestsStore.setState({
        response: { status: 200, statusText: 'OK', headers: {}, body: '', duration: 1, size: 0 },
      })
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.urlBarRenders.mock.calls).toHaveLength(initialCalls)
  })
})
