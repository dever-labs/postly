// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { ImportPage } from '../ImportPage'

const mockLoadCollections = vi.fn()
const mockAddToast = vi.fn()
const mockClearSelectedItem = vi.fn()
const mockLoadVariables = vi.fn()
const mockLoadEnvironments = vi.fn()
const integrations = [{ id: 'gh-1', type: 'github', name: 'GitHub' }]

vi.mock('@/components/ui/Select', () => ({
  Select: ({ value, onValueChange, children }: { value?: string; onValueChange?: (v: string) => void; children?: React.ReactNode }) => (
    <select aria-label="Collection source" value={value} onChange={(e) => onValueChange?.(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}))

vi.mock('@/store/collections', () => ({
  useCollectionsStore: (selector?: (state: { load: typeof mockLoadCollections }) => unknown) => {
    const state = { load: mockLoadCollections }
    return selector ? selector(state) : state
  },
}))

vi.mock('@/store/integrations', () => ({
  useIntegrationsStore: (selector: (state: { integrations: typeof integrations }) => unknown) =>
    selector({ integrations }),
}))

vi.mock('@/store/ui', () => ({
  useUIStore: (selector?: (state: { addToast: typeof mockAddToast; clearSelectedItem: typeof mockClearSelectedItem }) => unknown) => {
    const state = { addToast: mockAddToast, clearSelectedItem: mockClearSelectedItem }
    return selector ? selector(state) : state
  },
}))

vi.mock('@/store/variables', () => ({
  useVariablesStore: {
    getState: () => ({ load: mockLoadVariables }),
  },
}))

vi.mock('@/store/environments', () => ({
  useEnvironmentsStore: {
    getState: () => ({ load: mockLoadEnvironments }),
  },
}))

const mockParse = vi.fn()
const mockParseFolder = vi.fn()
const mockImportCollections = vi.fn()
const mockFetchUrl = vi.fn()

interface FolderTestFile extends File {
  webkitRelativePath: string
}

function setWindowApi() {
  ;(window as unknown as {
    api: {
      exportImport: {
        parse: typeof mockParse
        parseFolder: typeof mockParseFolder
        importCollections: typeof mockImportCollections
        fetchUrl: typeof mockFetchUrl
      }
    }
  }).api = {
    exportImport: {
      parse: mockParse,
      parseFolder: mockParseFolder,
      importCollections: mockImportCollections,
      fetchUrl: mockFetchUrl,
    },
  }
}

function makeFolderFile(path: string, text: string, size = text.length): FolderTestFile {
  const file = new File([text], path.split('/').pop() ?? 'file.txt', { type: 'text/plain' }) as FolderTestFile
  Object.defineProperty(file, 'webkitRelativePath', { configurable: true, value: path })
  Object.defineProperty(file, 'size', { configurable: true, value: size })
  Object.defineProperty(file, 'text', { configurable: true, value: vi.fn().mockResolvedValue(text) })
  return file
}

function makePseudoFolderFile(path: string, size = 1): File {
  return {
    name: path.split('/').pop() ?? 'file.txt',
    size,
    webkitRelativePath: path,
    text: vi.fn().mockResolvedValue('x'),
  } as unknown as File
}

function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[type="file"]:not([data-testid="import-folder-input"])')
  if (!input) throw new Error('file input not found')
  return input as HTMLInputElement
}

beforeEach(() => {
  setWindowApi()
  mockLoadCollections.mockResolvedValue(undefined)
  mockLoadVariables.mockResolvedValue(undefined)
  mockLoadEnvironments.mockResolvedValue(undefined)
  mockAddToast.mockReset()
  mockClearSelectedItem.mockReset()
  mockLoadEnvironments.mockReset()
  mockParse.mockReset()
  mockParseFolder.mockReset()
  mockImportCollections.mockReset()
  mockFetchUrl.mockReset()
  mockImportCollections.mockResolvedValue({ data: { count: 2 } })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ImportPage', () => {
  it('reads only collection files from a folder, shows preview details, and imports with source overrides', async () => {
    const user = userEvent.setup()
    mockParseFolder.mockResolvedValue({
      data: {
        format: 'bruno',
        warnings: ['Skipped auth helper'],
        collections: [
          { collection: { name: 'Bruno Alpha', source: 'git' }, folders: 2, requests: 5, environments: 2 },
          { collection: { name: 'Bruno Beta', source: 'github', integrationName: 'GitHub' }, folders: 1, requests: 3 },
        ],
      },
    })

    render(<ImportPage />)

    fireEvent.change(screen.getByTestId('import-folder-input'), {
      target: {
        files: [
          makeFolderFile('workspace/bruno.json', '{"version":1}'),
          makeFolderFile('workspace/orders.bru', 'meta {}'),
          makeFolderFile('workspace/bruno/opencollection.yml', 'name: demo'),
          makeFolderFile('workspace/bruno/requests/get.yml', 'name: get-users'),
          makeFolderFile('workspace/docker-compose.yml', 'services: {}'),
          makeFolderFile('workspace/.github/workflows/ci.yml', 'name: CI'),
          makeFolderFile('workspace/.git/hooks/pre-commit.bru', 'ignored'),
          makeFolderFile('workspace/node_modules/pkg/dep.bru', 'ignored'),
        ],
      },
    })

    await waitFor(() => expect(mockParseFolder).toHaveBeenCalledTimes(1))
    expect(mockParseFolder).toHaveBeenCalledWith({
      files: [
        { path: 'workspace/bruno.json', text: '{"version":1}' },
        { path: 'workspace/orders.bru', text: 'meta {}' },
        { path: 'workspace/bruno/opencollection.yml', text: 'name: demo' },
        { path: 'workspace/bruno/requests/get.yml', text: 'name: get-users' },
      ],
    })

    expect((await screen.findByTestId('import-format')).textContent).toContain('Bruno collection · 2 collections found')
    expect(screen.getByTestId('import-warnings').textContent).toContain('1 thing could not be fully mapped')
    expect(screen.getByText('Skipped auth helper')).toBeDefined()
    expect(screen.getByText('2 folders · 5 requests · 2 environments')).toBeDefined()
    expect(screen.getByText('1 folder · 3 requests')).toBeDefined()

    const sourceSelects = screen.getAllByRole('combobox')
    expect((sourceSelects[0] as HTMLSelectElement).value).toBe('local')
    expect((sourceSelects[1] as HTMLSelectElement).value).toBe('github')

    await user.selectOptions(sourceSelects[0], 'github')
    await user.click(screen.getByRole('button', { name: /Import 2 collections/i }))

    expect(mockImportCollections).toHaveBeenCalledWith({
      collections: [
        { name: 'Bruno Alpha', source: 'github' },
        { name: 'Bruno Beta', source: 'github', integrationName: 'GitHub' },
      ],
    })
    await waitFor(() => expect(mockLoadCollections).toHaveBeenCalledTimes(1))
    expect(mockLoadVariables).toHaveBeenCalledTimes(1)
    expect(mockLoadEnvironments).toHaveBeenCalledTimes(1)
    expect(mockClearSelectedItem).toHaveBeenCalledTimes(1)
  })

  it('shows a size error for collection files larger than 2 MB and does not call the folder parser', async () => {
    render(<ImportPage />)

    fireEvent.change(screen.getByTestId('import-folder-input'), {
      target: {
        files: [makeFolderFile('workspace/too-large.bru', 'x', 2 * 1024 * 1024 + 1)],
      },
    })

    expect((await screen.findByTestId('import-error')).textContent).toContain('A collection file in the folder is larger than 2 MB.')
    expect(mockParseFolder).not.toHaveBeenCalled()
  })

  it('shows a count error for folders with more than 5000 collection files', async () => {
    render(<ImportPage />)

    fireEvent.change(screen.getByTestId('import-folder-input'), {
      target: {
        files: Array.from({ length: 5001 }, (_, i) => makePseudoFolderFile(`workspace/${i}.bru`)),
      },
    })

    expect((await screen.findByTestId('import-error')).textContent).toContain('The folder has more than 5000 collection files. Pick the collection\'s own folder.')
    expect(mockParseFolder).not.toHaveBeenCalled()
  })

  it('shows API folder errors without rendering a preview', async () => {
    mockParseFolder.mockResolvedValue({ error: 'Folder parse failed' })

    render(<ImportPage />)

    fireEvent.change(screen.getByTestId('import-folder-input'), {
      target: {
        files: [makeFolderFile('workspace/bruno.json', '{"version":1}')],
      },
    })

    expect((await screen.findByTestId('import-error')).textContent).toContain('Folder parse failed')
    expect(screen.queryByTestId('import-format')).toBeNull()
  })

  it('shows a read error when a folder file cannot be read', async () => {
    const unreadable = makeFolderFile('workspace/bruno.json', '{"version":1}')
    Object.defineProperty(unreadable, 'text', { configurable: true, value: vi.fn().mockRejectedValue(new Error('boom')) })

    render(<ImportPage />)

    fireEvent.change(screen.getByTestId('import-folder-input'), {
      target: {
        files: [unreadable],
      },
    })

    expect((await screen.findByTestId('import-error')).textContent).toContain('Could not read the folder.')
    expect(mockParseFolder).not.toHaveBeenCalled()
  })

  it('still parses a regular single file and can import it', async () => {
    const user = userEvent.setup()
    mockParse.mockResolvedValue({
      data: {
        format: 'postman',
        warnings: [],
        collections: [
          { collection: { name: 'Postman Pets', source: 'local' }, folders: 4, requests: 9 },
        ],
      },
    })

    const { container } = render(<ImportPage />)

    await user.upload(fileInput(container), new File(['{"info":{"name":"Pets"}}'], 'pets.postman_collection.json', { type: 'application/json' }))

    await waitFor(() => expect(mockParse).toHaveBeenCalledTimes(1))
    expect(mockParse).toHaveBeenCalledWith({ text: '{"info":{"name":"Pets"}}', sourceUrl: undefined })
    expect((await screen.findByTestId('import-format')).textContent).toContain('Postman collection · 1 collection found')

    await user.click(screen.getByRole('button', { name: /Import 1 collection/i }))
    expect(mockImportCollections).toHaveBeenCalledWith({
      collections: [{ name: 'Postman Pets', source: 'local' }],
    })
  })

  it('shows URL fetch errors for single-document imports', async () => {
    const user = userEvent.setup()
    mockFetchUrl.mockResolvedValue({ error: 'Could not fetch upstream document' })

    render(<ImportPage />)

    await user.type(screen.getByTestId('import-url'), 'https://example.com/openapi.yaml')
    await user.click(screen.getByTestId('import-url-fetch'))

    expect((await screen.findByTestId('import-error')).textContent).toContain('Could not fetch upstream document')
    expect(mockParse).not.toHaveBeenCalled()
  })
})
