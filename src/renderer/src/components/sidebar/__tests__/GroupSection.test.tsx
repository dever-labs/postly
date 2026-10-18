// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GroupSection } from '../GroupSection'
import { useCollectionsStore } from '@/store/collections'
import { useUIStore } from '@/store/ui'
import type { Folder } from '@/types'

vi.mock('@/components/sidebar/FolderTreeRow', () => ({
  FolderTreeRow: ({ folder, onAddRequest }: { folder: Folder; onAddRequest: (folder: Folder) => void }) => (
    <button onClick={() => onAddRequest(folder)}>Add request to {folder.name}</button>
  ),
}))

describe('GroupSection', () => {
  beforeEach(() => {
    useUIStore.setState({
      settingsOpen: false,
      settingsTab: 'general',
      pendingGitAction: null,
      deletingCollectionId: null,
      selectedItem: null,
      collapsedSources: new Set(),
    })
    useCollectionsStore.setState({
      folders: [],
      collections: [],
      groups: [],
      requests: [],
      hiddenSources: new Set(),
      addRequestToFolder: vi.fn(async () => 'req-1'),
      deleteRequest: vi.fn(async () => undefined),
    })
  })

  afterEach(cleanup)

  it('routes new git-backed requests through the git overlay', async () => {
    const folder = {
      id: 'col-1',
      name: 'Git Collection',
      parentId: undefined,
      sortOrder: 0,
      source: 'github',
      integrationId: undefined,
      collapsed: false,
      hidden: false,
      authType: 'none',
      authConfig: {},
      sslVerification: 'inherit',
    } as Folder

    render(
      <GroupSection
        source="github"
        integration={null}
        folders={[folder]}
        requests={[]}
        searchQuery=""
      />,
    )

    await userEvent.click(screen.getByText('Add request to Git Collection'))

    await waitFor(() => expect(useUIStore.getState().pendingGitAction).toMatchObject({
      type: 'push',
      collectionId: 'col-1',
      title: 'Created endpoint',
      subtitle: 'Git Collection',
    }))
  })

  it('keeps all created git-backed requests attached to one cancel action', async () => {
    const deleteRequest = vi.fn(async () => undefined)
    const addRequestToFolder = vi.fn()
      .mockResolvedValueOnce('req-1')
      .mockResolvedValueOnce('req-2')
    useCollectionsStore.setState({ addRequestToFolder, deleteRequest })

    const folder = {
      id: 'col-1',
      name: 'Git Collection',
      parentId: undefined,
      sortOrder: 0,
      source: 'github',
      integrationId: undefined,
      collapsed: false,
      hidden: false,
      authType: 'none',
      authConfig: {},
      sslVerification: 'inherit',
    } as Folder

    render(
      <GroupSection
        source="github"
        integration={null}
        folders={[folder]}
        requests={[]}
        searchQuery=""
      />,
    )

    await userEvent.click(screen.getByText('Add request to Git Collection'))
    await userEvent.click(screen.getByText('Add request to Git Collection'))

    await waitFor(() => expect(useUIStore.getState().pendingGitAction).not.toBeNull())
    await useUIStore.getState().pendingGitAction?.onCancel?.()

    expect(deleteRequest).toHaveBeenCalledTimes(2)
    expect(deleteRequest).toHaveBeenNthCalledWith(1, 'req-1')
    expect(deleteRequest).toHaveBeenNthCalledWith(2, 'req-2')
  })
})
