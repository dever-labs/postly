// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RequestTreeItem } from '../RequestTreeItem'
import { useCollectionsStore } from '@/store/collections'
import { useUIStore } from '@/store/ui'
import type { Folder, Request } from '@/types'

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => undefined,
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}))

vi.mock('@dnd-kit/utilities', () => ({
  CSS: { Transform: { toString: () => undefined } },
}))

vi.mock('@/components/ui/Badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}))

vi.mock('@/components/ai/AiActionButton', () => ({
  AiActionButton: ({ label, onClick }: { label: string; onClick: () => void }) => <button onClick={onClick}>{label}</button>,
}))

vi.mock('@/components/ui/RowMenu', () => ({
  RowMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MenuItem: ({ children, onClick }: { children: React.ReactNode; onClick: (event: React.MouseEvent<HTMLButtonElement>) => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}))

const update = vi.fn(async () => ({ data: true }))

beforeEach(() => {
  update.mockClear()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      requests: {
        update,
      },
    },
  })
  useUIStore.setState({
    pendingGitAction: null,
    selectedItem: null,
  })
  const folder = {
    id: 'col-1',
    name: 'Git Collection',
    parentId: undefined,
    sortOrder: 0,
    source: 'git',
    integrationId: undefined,
    collapsed: false,
    hidden: false,
    authType: 'none',
    authConfig: {},
    sslVerification: 'inherit',
  } as Folder
  useCollectionsStore.setState({
    folders: [folder],
    collections: [folder],
    groups: [],
    requests: [],
  })
})

afterEach(cleanup)

describe('RequestTreeItem', () => {
  it('routes git-backed request renames through the git overlay', async () => {
    const request = {
      id: 'req-1',
      folderId: 'col-1',
      name: 'Old Name',
      method: 'GET',
      url: 'https://example.test',
      headers: [],
      params: [],
      bodyType: 'none',
      bodyContent: '',
      protocol: 'http',
      protocolConfig: {},
      authType: 'none',
      authConfig: {},
      sslVerification: 'inherit',
      isDirty: false,
      sortOrder: 0,
    } as Request

    render(
      <RequestTreeItem
        request={request}
        isActive={false}
        onClick={() => undefined}
        onDelete={() => undefined}
        dndId="req:req-1"
        level={2}
      />,
    )

    await userEvent.click(screen.getByLabelText('More actions for Old Name'))
    await userEvent.click(screen.getByText('Rename'))
    const input = screen.getByDisplayValue('Old Name')
    fireEvent.change(input, { target: { value: 'New Name' } })
    fireEvent.blur(input)

    await waitFor(() => expect(update).toHaveBeenCalledWith({ id: 'req-1', name: 'New Name' }))
    expect(useUIStore.getState().pendingGitAction).toMatchObject({
      type: 'push',
      collectionId: 'col-1',
      title: "Renamed endpoint to 'New Name'",
      subtitle: 'Git Collection',
    })
  })
})
