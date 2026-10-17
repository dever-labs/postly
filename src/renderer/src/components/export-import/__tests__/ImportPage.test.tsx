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

function folderInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector('input[data-testid="import-folder-input"]')
  if (!input) throw new Error('folder input not found')
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
    mockImportCollections.mockResolvedValue({ data: { count: 1 } })
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
    await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith('Imported 1 collection', 'success'))
  })

  it('shows a parse error when a selected file cannot be converted', async () => {
    const user = userEvent.setup()
    mockParse.mockResolvedValue({ error: 'Unsupported format' })

    const { container } = render(<ImportPage />)

    await user.upload(fileInput(container), new File(['{"bad":true}'], 'broken.json', { type: 'application/json' }))

    await waitFor(() => expect(mockParse).toHaveBeenCalledTimes(1))
    expect((await screen.findByTestId('import-error')).textContent).toContain('Unsupported format')
    expect(screen.queryByTestId('import-format')).toBeNull()
  })

  it('renders singular preview counts and defaults missing sources to local', async () => {
    const user = userEvent.setup()
    mockParse.mockResolvedValue({
      data: {
        format: 'openapi',
        warnings: [],
        collections: [
          {
            collection: { name: 'One Request API', description: 'Generated from spec' },
            folders: 1,
            requests: 1,
            environments: 1,
          },
        ],
      },
    })

    const { container } = render(<ImportPage />)

    await user.upload(fileInput(container), new File(['openapi: 3.0.0'], 'one.yaml', { type: 'application/yaml' }))

    expect((await screen.findByTestId('import-format')).textContent).toContain('OpenAPI / Swagger · 1 collection found')
    expect(screen.getByText('Generated from spec')).toBeDefined()
    expect(screen.getByText('1 folder · 1 request · 1 environment')).toBeDefined()
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('local')
  })

  it('shows a file read error when the browser cannot read the selected file', async () => {
    const OriginalFileReader = window.FileReader

    class BrokenFileReader {
      onload: ((event: ProgressEvent<FileReader>) => void) | null = null
      onerror: ((event: ProgressEvent<FileReader>) => void) | null = null

      readAsText() {
        this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>)
      }
    }

    window.FileReader = BrokenFileReader as unknown as typeof FileReader

    try {
      const { container } = render(<ImportPage />)

      fireEvent.change(fileInput(container), {
        target: {
          files: [new File(['oops'], 'broken.json', { type: 'application/json' })],
        },
      })

      expect((await screen.findByTestId('import-error')).textContent).toContain('Could not read the file.')
      expect(mockParse).not.toHaveBeenCalled()
    } finally {
      window.FileReader = OriginalFileReader
    }
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

  it('opens the file and folder pickers from the browse actions', async () => {
    const user = userEvent.setup()
    mockParse.mockResolvedValue({
      data: {
        format: 'postly',
        warnings: [],
        collections: [{ collection: { name: 'Picked', source: 'local' }, folders: 0, requests: 0 }],
      },
    })

    const { container } = render(<ImportPage />)
    const plainFileInput = fileInput(container)
    const plainFolderInput = folderInput(container)
    const fileClickSpy = vi.spyOn(plainFileInput, 'click')
    const folderClickSpy = vi.spyOn(plainFolderInput, 'click')

    await user.click(screen.getByRole('button', { name: /Browse for a file/i }))
    await user.click(screen.getByTestId('import-folder'))

    expect(fileClickSpy).toHaveBeenCalledTimes(1)
    expect(folderClickSpy).toHaveBeenCalledTimes(1)

    await user.upload(plainFileInput, new File(['{"collections":[]}'], 'picked.postly.json', { type: 'application/json' }))
    await screen.findByText('Change file')

    const changeFileClickSpy = vi.spyOn(fileInput(container), 'click')
    const clicksBefore = changeFileClickSpy.mock.calls.length
    await user.click(screen.getByRole('button', { name: /Change file/i }))
    expect(changeFileClickSpy.mock.calls.length).toBe(clicksBefore + 1)
  })

  it('fetches a URL, parses it with sourceUrl context, and renders preview warnings for empty results', async () => {
    const user = userEvent.setup()
    mockFetchUrl.mockResolvedValue({ data: { text: 'openapi: 3.0.0' } })
    mockParse.mockResolvedValue({
      data: {
        format: 'openapi',
        warnings: ['Missing auth scheme', 'Skipped unsupported callback'],
        collections: [],
      },
    })

    render(<ImportPage />)

    await user.type(screen.getByTestId('import-url'), '  https://example.com/openapi.yaml  ')
    await user.click(screen.getByTestId('import-url-fetch'))

    await waitFor(() => expect(mockFetchUrl).toHaveBeenCalledWith({ url: 'https://example.com/openapi.yaml' }))
    await waitFor(() =>
      expect(mockParse).toHaveBeenCalledWith({
        text: 'openapi: 3.0.0',
        sourceUrl: 'https://example.com/openapi.yaml',
      }),
    )

    expect((await screen.findByTestId('import-format')).textContent).toContain('OpenAPI / Swagger · 0 collections found')
    expect(screen.getByTestId('import-warnings').textContent).toContain('2 things could not be fully mapped')
    expect(screen.getByText('Missing auth scheme')).toBeDefined()
    expect(screen.getByText('Skipped unsupported callback')).toBeDefined()
    expect(screen.getByText('Change file')).toBeDefined()
    expect(screen.queryByTestId('import-url')).toBeNull()
    expect(screen.queryByTestId('import-folder')).toBeNull()
  })

  it('shows an import failure toast without reloading stores', async () => {
    const user = userEvent.setup()
    mockParse.mockResolvedValue({
      data: {
        format: 'postly',
        warnings: [],
        collections: [{ collection: { name: 'Broken Import', source: 'local' }, folders: 0, requests: 0 }],
      },
    })
    mockImportCollections.mockResolvedValue({ error: 'Renderer rejected import' })

    const { container } = render(<ImportPage />)

    await user.upload(fileInput(container), new File(['{"collections":[]}'], 'broken.postly.json', { type: 'application/json' }))
    await screen.findByRole('button', { name: /Import 1 collection/i })
    await user.click(screen.getByRole('button', { name: /Import 1 collection/i }))

    await waitFor(() => expect(mockAddToast).toHaveBeenCalledWith('Import failed: Renderer rejected import', 'error'))
    expect(mockLoadCollections).not.toHaveBeenCalled()
    expect(mockLoadVariables).not.toHaveBeenCalled()
    expect(mockLoadEnvironments).not.toHaveBeenCalled()
    expect(mockClearSelectedItem).not.toHaveBeenCalled()
  })
})
