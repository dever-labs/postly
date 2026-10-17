// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { ExportPage } from '../ExportPage'
import type { Collection } from '@/types'

const mockAddToast = vi.fn()
const mockExport = vi.fn()

let collections: Collection[] = []

vi.mock('@/store/collections', () => ({
  useCollectionsStore: (selector?: (state: { collections: Collection[] }) => unknown) => {
    const state = { collections }
    return selector ? selector(state) : state
  },
}))

vi.mock('@/store/ui', () => ({
  useUIStore: (selector?: (state: { addToast: typeof mockAddToast }) => unknown) => {
    const state = { addToast: mockAddToast }
    return selector ? selector(state) : state
  },
}))

function makeCollection(overrides: Partial<Collection>): Collection {
  return {
    id: 'collection-1',
    name: 'Collection',
    description: '',
    source: 'local',
    authType: 'none',
    authConfig: {},
    sslVerification: 'inherit',
    hidden: false,
    collapsed: false,
    sortOrder: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

beforeEach(() => {
  collections = []
  mockAddToast.mockReset()
  mockExport.mockReset()
  mockExport.mockResolvedValue({ data: { count: 1 } })
  ;(window as unknown as {
    api: {
      exportImport: {
        export: typeof mockExport
      }
    }
  }).api = {
    exportImport: {
      export: mockExport,
    },
  }
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ExportPage', () => {
  it('renders an empty state when there are no collections', () => {
    render(<ExportPage />)

    expect(screen.getByText('No collections to export.')).toBeDefined()
    expect(screen.queryByRole('button', { name: /Export/i })).toBeNull()
  })

  it('lists collections by source, supports selection changes, and shows a success toast after export', async () => {
    const user = userEvent.setup()
    collections = [
      makeCollection({ id: 'c1', name: 'Local API', description: 'Primary workspace', source: 'local' }),
      makeCollection({ id: 'c2', name: 'GitHub API', source: 'github', sortOrder: 1 }),
      makeCollection({ id: 'c3', name: 'GitHub Admin', description: 'Privileged', source: 'github', sortOrder: 2 }),
    ]
    mockExport.mockResolvedValue({ data: { count: 1 } })

    render(<ExportPage />)

    expect(screen.getByText('Local API')).toBeDefined()
    expect(screen.getByText('Primary workspace')).toBeDefined()
    expect(screen.getByText('GitHub API')).toBeDefined()
    expect(screen.getByText('GitHub Admin')).toBeDefined()
    expect(screen.getByText('Privileged')).toBeDefined()
    expect(screen.getByText('Local')).toBeDefined()
    expect(screen.getByText('GitHub')).toBeDefined()
    expect(screen.getByRole('button', { name: /Export 3 collections/i })).toBeDefined()

    await user.click(screen.getByRole('button', { name: /Deselect all/i }))
    expect((screen.getByRole('button', { name: /Export 0 collections/i }) as HTMLButtonElement).disabled).toBe(true)

    await user.click(screen.getAllByRole('button', { name: /GitHub/i })[0])
    expect(screen.getByRole('button', { name: /Export 2 collections/i })).toBeDefined()

    await user.click(screen.getByRole('button', { name: /GitHub Admin/i }))
    await user.click(screen.getByRole('button', { name: /Export 1 collection/i }))

    await waitFor(() => expect(mockExport).toHaveBeenCalledWith({ collectionIds: ['c2'] }))
    expect(mockAddToast).toHaveBeenCalledWith('Exported 1 collection', 'success')
  })

  it('shows an error toast when export fails', async () => {
    const user = userEvent.setup()
    collections = [makeCollection({ id: 'c9', name: 'Broken API' })]
    mockExport.mockResolvedValue({ error: 'Disk full' })

    render(<ExportPage />)

    await user.click(screen.getByRole('button', { name: /Export 1 collection/i }))

    await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith('Export failed: Disk full', 'error'))
  })
})
