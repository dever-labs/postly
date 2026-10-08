import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers: Record<string, (event: unknown, args?: unknown) => Promise<unknown>> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, args?: unknown) => Promise<unknown>) => {
      handlers[channel] = handler
    }),
  },
}))

vi.mock('../../database', () => ({
  queryOne: vi.fn(),
  run: vi.fn(),
}))

vi.mock('../../services/github', () => ({
  discoverApis: vi.fn(),
  getFileSha: vi.fn(),
  commitFile: vi.fn(),
  listBranches: vi.fn(),
  createBranch: vi.fn(),
  getFileContent: vi.fn(),
}))

vi.mock('../../services/scm-oauth', () => ({
  startGitHubOAuth: vi.fn(),
}))

import { queryOne, run } from '../../database'
import {
  commitFile,
  createBranch,
  discoverApis,
  getFileContent,
  getFileSha,
  listBranches,
} from '../../services/github'
import { startGitHubOAuth } from '../../services/scm-oauth'
import { registerGitHubHandlers } from '../github'

const mockQueryOne = vi.mocked(queryOne)
const mockRun = vi.mocked(run)
const mockDiscoverApis = vi.mocked(discoverApis)
const mockGetFileSha = vi.mocked(getFileSha)
const mockCommitFile = vi.mocked(commitFile)
const mockListBranches = vi.mocked(listBranches)
const mockCreateBranch = vi.mocked(createBranch)
const mockGetFileContent = vi.mocked(getFileContent)
const mockStartGitHubOAuth = vi.mocked(startGitHubOAuth)

const settings = {
  baseUrl: 'https://github.com',
  clientId: 'cid',
  clientSecret: 'secret',
  token: 'gh-token',
  repo: '',
  orgs: ['acme'],
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(handlers)) delete handlers[key]
  registerGitHubHandlers()
})

describe('registerGitHubHandlers', () => {
  it('returns { data: true } from sync on success', async () => {
    mockQueryOne.mockReturnValue({ value: JSON.stringify(settings) })

    const result = await handlers['postly:github:sync'](null)

    expect(result).toEqual({ data: true })
    expect(mockDiscoverApis).toHaveBeenCalledWith(settings)
  })

  it('returns { error } from sync when settings are missing', async () => {
    mockQueryOne.mockReturnValue(null)

    const result = await handlers['postly:github:sync'](null)

    expect(result).toEqual({ error: 'Error: GitHub settings not configured' })
  })

  it('returns branches from branches:list on success', async () => {
    mockQueryOne.mockReturnValue({ value: JSON.stringify(settings) })
    mockListBranches.mockResolvedValue(['main', 'develop'])

    const result = await handlers['postly:github:branches:list'](null, { owner: 'acme', repo: 'orders' })

    expect(result).toEqual({ data: ['main', 'develop'] })
    expect(mockListBranches).toHaveBeenCalledWith('gh-token', 'acme', 'orders')
  })

  it('returns { error } from branches:list when listing fails', async () => {
    mockQueryOne.mockReturnValue({ value: JSON.stringify(settings) })
    mockListBranches.mockRejectedValue(new Error('boom'))

    const result = await handlers['postly:github:branches:list'](null, { owner: 'acme', repo: 'orders' })

    expect(result).toEqual({ error: 'Error: boom' })
  })

  it('returns { data: true } from branch:create on success', async () => {
    mockQueryOne.mockReturnValue({ value: JSON.stringify(settings) })

    const result = await handlers['postly:github:branch:create'](null, {
      owner: 'acme',
      repo: 'orders',
      newBranch: 'feature/test',
      fromBranch: 'main',
    })

    expect(result).toEqual({ data: true })
    expect(mockCreateBranch).toHaveBeenCalledWith('gh-token', 'acme', 'orders', 'feature/test', 'main')
  })

  it('returns { error } from branch:create when creation fails', async () => {
    mockQueryOne.mockReturnValue({ value: JSON.stringify(settings) })
    mockCreateBranch.mockRejectedValue(new Error('nope'))

    const result = await handlers['postly:github:branch:create'](null, {
      owner: 'acme',
      repo: 'orders',
      newBranch: 'feature/test',
      fromBranch: 'main',
    })

    expect(result).toEqual({ error: 'Error: nope' })
  })

  it('returns { data: true } from commit on success', async () => {
    mockQueryOne.mockImplementation((sql: string) => {
      if (sql.includes("FROM settings WHERE key = ?")) return { value: JSON.stringify(settings) }
      return { id: 'req-1', scm_path: 'openapi.yaml' }
    })
    mockGetFileSha.mockResolvedValue('sha-123')

    const result = await handlers['postly:github:commit'](null, {
      requestId: 'req-1',
      source: 'acme/orders',
      commitMessage: 'Update spec',
      branch: 'main',
      content: 'body',
    })

    expect(result).toEqual({ data: true })
    expect(mockGetFileSha).toHaveBeenCalledWith('gh-token', 'acme', 'orders', 'openapi.yaml', 'main')
    expect(mockCommitFile).toHaveBeenCalledWith('gh-token', 'acme', 'orders', 'openapi.yaml', 'body', 'sha-123', 'Update spec', 'main')
    expect(mockRun).toHaveBeenCalledWith(
      'UPDATE requests SET scm_sha = ?, is_dirty = 0, updated_at = ? WHERE id = ?',
      ['sha-123', expect.any(Number), 'req-1'],
    )
  })

  it('returns { error } from commit when the request is missing', async () => {
    mockQueryOne.mockImplementation((sql: string) => {
      if (sql.includes("FROM settings WHERE key = ?")) return { value: JSON.stringify(settings) }
      return null
    })

    const result = await handlers['postly:github:commit'](null, {
      requestId: 'missing',
      source: 'acme/orders',
      commitMessage: 'Update spec',
      branch: 'main',
      content: 'body',
    })

    expect(result).toEqual({ error: 'Request not found' })
  })

  it('returns diff data from diff on success', async () => {
    mockQueryOne.mockImplementation((sql: string) => {
      if (sql.includes("FROM settings WHERE key = ?")) return { value: JSON.stringify(settings) }
      if (sql.includes('SELECT * FROM requests WHERE id = ?')) {
        return { id: 'req-1', scm_path: 'openapi.yaml', body_content: 'local body', folder_id: 'folder-1' }
      }
      return { source_meta: JSON.stringify({ repo: 'acme/orders' }) }
    })
    mockGetFileContent.mockResolvedValue('remote body')

    const result = await handlers['postly:github:diff'](null, { requestId: 'req-1' })

    expect(result).toEqual({
      data: {
        localContent: 'local body',
        remoteContent: 'remote body',
        hasChanges: true,
      },
    })
    expect(mockGetFileContent).toHaveBeenCalledWith('gh-token', 'acme', 'orders', 'openapi.yaml', 'main')
  })

  it('returns { error } from diff when the request is missing', async () => {
    mockQueryOne.mockImplementation((sql: string) => {
      if (sql.includes("FROM settings WHERE key = ?")) return { value: JSON.stringify(settings) }
      return null
    })

    const result = await handlers['postly:github:diff'](null, { requestId: 'missing' })

    expect(result).toEqual({ error: 'Request not found' })
  })

  it('returns oauth user data on success', async () => {
    const user = { login: 'octocat', name: 'Octo Cat', avatarUrl: 'https://example.com/cat.png' }
    mockStartGitHubOAuth.mockResolvedValue({ token: 'new-token', user })
    mockQueryOne.mockReturnValue({ value: JSON.stringify({ orgs: ['existing-org'] }) })

    const result = await handlers['postly:github:oauth'](null, {
      baseUrl: 'https://github.com',
      clientId: 'cid',
      clientSecret: 'secret',
    })

    expect(result).toEqual({ data: { user } })
    expect(mockRun).toHaveBeenCalledWith(
      'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
      [
        'github',
        JSON.stringify({
          orgs: ['existing-org'],
          baseUrl: 'https://github.com',
          clientId: 'cid',
          clientSecret: 'secret',
          token: 'new-token',
          connectedUser: user,
        }),
        expect.any(Number),
      ],
    )
  })

  it('returns { error } from oauth when oauth fails', async () => {
    mockStartGitHubOAuth.mockRejectedValue(new Error('oauth failed'))

    const result = await handlers['postly:github:oauth'](null, {
      baseUrl: 'https://github.com',
      clientId: 'cid',
      clientSecret: 'secret',
    })

    expect(result).toEqual({ error: 'Error: oauth failed' })
  })

  it('returns { data: true } from disconnect on success', async () => {
    mockQueryOne.mockReturnValue({
      value: JSON.stringify({
        baseUrl: 'https://github.com',
        clientId: 'cid',
        clientSecret: 'secret',
        token: 'old-token',
        connectedUser: { login: 'octocat' },
      }),
    })

    const result = await handlers['postly:github:disconnect'](null)

    expect(result).toEqual({ data: true })
    expect(mockRun).toHaveBeenCalledWith(
      'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
      [
        'github',
        JSON.stringify({
          baseUrl: 'https://github.com',
          clientId: 'cid',
          clientSecret: 'secret',
          token: '',
        }),
        expect.any(Number),
      ],
    )
  })

  it('returns { error } from disconnect when persistence fails', async () => {
    mockQueryOne.mockReturnValue({ value: JSON.stringify(settings) })
    mockRun.mockImplementation(() => {
      throw new Error('write failed')
    })

    const result = await handlers['postly:github:disconnect'](null)

    expect(result).toEqual({ error: 'Error: write failed' })
  })
})
