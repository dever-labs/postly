// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, act, waitFor } from '@testing-library/react'
import React from 'react'

const mocks = vi.hoisted(() => ({
  groupSectionRenders: vi.fn(),
  loadCollections: vi.fn(async () => undefined),
  loadIntegrations: vi.fn(async () => undefined),
  loadEnvironments: vi.fn(async () => undefined),
}))

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DragOverlay: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  closestCenter: {},
  PointerSensor: class PointerSensor {},
  useSensor: () => ({}),
  useSensors: () => [],
}))
vi.mock('@/components/sidebar/WorkingSet', () => ({ WorkingSet: () => <div /> }))
vi.mock('@/components/sidebar/HistoryPanel', () => ({ HistoryPanel: () => <div /> }))
vi.mock('@/components/sidebar/EnvironmentsPanel', () => ({ EnvironmentsPanel: () => <div /> }))
vi.mock('@/components/sidebar/GroupSection', () => ({
  GroupSection: () => {
    mocks.groupSectionRenders()
    return <div />
  },
}))
vi.mock('@/components/sidebar/SidebarSearch', () => ({ SidebarSearch: () => <div /> }))
vi.mock('@/components/ui/Badge', () => ({ Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }))
vi.mock('@/components/ui/Tree', () => ({ Tree: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/store/collections', async () => {
  const { create } = await import('zustand')
  const useCollectionsStore = create(() => ({
    folders: [],
    requests: [],
    searchQuery: '',
    load: mocks.loadCollections,
    unrelatedCounter: 0,
  }))
  return { useCollectionsStore }
})
vi.mock('@/store/integrations', async () => {
  const { create } = await import('zustand')
  const useIntegrationsStore = create(() => ({
    integrations: [],
    load: mocks.loadIntegrations,
  }))
  return { useIntegrationsStore }
})
vi.mock('@/store/environments', async () => {
  const { create } = await import('zustand')
  const useEnvironmentsStore = create(() => ({
    load: mocks.loadEnvironments,
  }))
  return { useEnvironmentsStore }
})
vi.mock('@/store/ui', async () => {
  const { create } = await import('zustand')
  const useUIStore = create(() => ({
    selectItem: vi.fn(),
    openSettings: vi.fn(),
    sidebarTab: 'apis',
    setSidebarTab: vi.fn(),
    selectedItem: null as { type: string; id: string } | null,
  }))
  return { useUIStore }
})

import { CollectionsSidebar } from '../CollectionsSidebar'
import { useUIStore as uiStore } from '@/store/ui'

beforeEach(() => {
  mocks.groupSectionRenders.mockClear()
  mocks.loadCollections.mockClear()
  mocks.loadIntegrations.mockClear()
  mocks.loadEnvironments.mockClear()
  uiStore.setState({
    sidebarTab: 'apis',
    selectedItem: null,
  })
})

afterEach(cleanup)

describe('CollectionsSidebar selectors', () => {
  it('does not rerender for unrelated UI-store updates', async () => {
    render(<CollectionsSidebar />)
    await waitFor(() => expect(mocks.groupSectionRenders).toHaveBeenCalled())
    const initialCalls = mocks.groupSectionRenders.mock.calls.length

    act(() => {
      uiStore.setState({ selectedItem: { type: 'collection', id: 'col-1' } })
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(mocks.groupSectionRenders.mock.calls).toHaveLength(initialCalls)
  })
})
