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

vi.mock('../../services/gitlab', () => ({
  discoverApis: vi.fn(),
  getFileSha: vi.fn(),
  commitFile: vi.fn(),
  listBranches: vi.fn(),
  createBranch: vi.fn(),
  getFileContent: vi.fn(),
}))

vi.mock('../../services/scm-oauth', () => ({
  startGitLabOAuth: vi.fn(),
}))

import { queryOne, run } from '../../database'
import {
  commitFile,
  createBranch,
  discoverApis,
  getFileContent,
  getFileSha,
  listBranches,
} from '../../services/gitlab'
import { startGitLabOAuth } from '../../services/scm-oauth'
import { registerGitLabHandlers } from '../gitlab'

const mockQueryOne = vi.mocked(queryOne)
const mockRun = vi.mocked(run)
const mockDiscoverApis = vi.mocked(discoverApis)
const mockGetFileSha = vi.mocked(getFileSha)
const mockCommitFile = vi.mocked(commitFile)
const mockListBranches = vi.mocked(listBranches)
const mockCreateBranch = vi.mocked(createBranch)
const mockGetFileContent = vi.mocked(getFileContent)
const mockStartGitLabOAuth = vi.mocked(startGitLabOAuth)

const settings = {
  baseUrl: 'https://gitlab.example.com',
  clientId: 'cid',
  token: 'gl-token',
  repo: '',
  groups: ['team-a'],
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(handlers)) delete handlers[key]
  registerGitLabHandlers()
})

describe('registerGitLabHandlers', () => {
  it('returns { data: true } from sync on success', async () => {
    mockQueryOne.mockReturnValue({ value: JSON.stringify(settings) })

    const result = await handlers['postly:gitlab:sync'](null)

    expect(result).toEqual({ data: true })
    expect(mockDiscoverApis).toHaveBeenCalledWith(settings)
  })

  it('returns { error } from sync when settings are missing', async () => {
    mockQueryOne.mockReturnValue(null)

    const result = await handlers['postly:gitlab:sync'](null)

    expect(result).toEqual({ error: 'Error: GitLab settings not configured' })
  })

  it('returns branches from branches:list on success', async () => {
    mockQueryOne.mockReturnValue({ value: JSON.stringify(settings) })
    mockListBranches.mockResolvedValue(['main', 'develop'])

    const result = await handlers['postly:gitlab:branches:list'](null, { projectId: '42' })

    expect(result).toEqual({ data: ['main', 'develop'] })
    expect(mockListBranches).toHaveBeenCalledWith('gl-token', 'https://gitlab.example.com', '42')
  })

  it('returns { error } from branches:list when listing fails', async () => {
    mockQueryOne.mockReturnValue({ value: JSON.stringify(settings) })
    mockListBranches.mockRejectedValue(new Error('boom'))

    const result = await handlers['postly:gitlab:branches:list'](null, { projectId: '42' })

    expect(result).toEqual({ error: 'Error: boom' })
  })

  it('returns { data: true } from branch:create on success', async () => {
    mockQueryOne.mockReturnValue({ value: JSON.stringify(settings) })

    const result = await handlers['postly:gitlab:branch:create'](null, {
      projectId: '42',
      newBranch: 'feature/test',
      fromBranch: 'main',
    })

    expect(result).toEqual({ data: true })
    expect(mockCreateBranch).toHaveBeenCalledWith('gl-token', 'https://gitlab.example.com', '42', 'feature/test', 'main')
  })

  it('returns { error } from branch:create when creation fails', async () => {
    mockQueryOne.mockReturnValue({ value: JSON.stringify(settings) })
    mockCreateBranch.mockRejectedValue(new Error('nope'))

    const result = await handlers['postly:gitlab:branch:create'](null, {
      projectId: '42',
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

    const result = await handlers['postly:gitlab:commit'](null, {
      requestId: 'req-1',
      projectId: '42',
      commitMessage: 'Update spec',
      branch: 'main',
      content: 'body',
    })

    expect(result).toEqual({ data: true })
    expect(mockGetFileSha).toHaveBeenCalledWith('gl-token', 'https://gitlab.example.com', '42', 'openapi.yaml', 'main')
    expect(mockCommitFile).toHaveBeenCalledWith('gl-token', 'https://gitlab.example.com', '42', 'openapi.yaml', 'body', 'sha-123', 'Update spec', 'main')
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

    const result = await handlers['postly:gitlab:commit'](null, {
      requestId: 'missing',
      projectId: '42',
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
      return { source_meta: JSON.stringify({ projectId: '42' }) }
    })
    mockGetFileContent.mockResolvedValue('remote body')

    const result = await handlers['postly:gitlab:diff'](null, { requestId: 'req-1' })

    expect(result).toEqual({
      data: {
        localContent: 'local body',
        remoteContent: 'remote body',
        hasChanges: true,
      },
    })
    expect(mockGetFileContent).toHaveBeenCalledWith('gl-token', 'https://gitlab.example.com', '42', 'openapi.yaml', 'main')
  })

  it('returns { error } from diff when the request is missing', async () => {
    mockQueryOne.mockImplementation((sql: string) => {
      if (sql.includes("FROM settings WHERE key = ?")) return { value: JSON.stringify(settings) }
      return null
    })

    const result = await handlers['postly:gitlab:diff'](null, { requestId: 'missing' })

    expect(result).toEqual({ error: 'Request not found' })
  })

  it('returns oauth user data on success', async () => {
    const user = { username: 'octocat', name: 'Octo Cat', avatarUrl: 'https://example.com/cat.png' }
    mockStartGitLabOAuth.mockResolvedValue({ token: 'new-token', user })
    mockQueryOne.mockReturnValue({ value: JSON.stringify({ groups: ['existing-group'] }) })

    const result = await handlers['postly:gitlab:oauth'](null, {
      baseUrl: 'https://gitlab.example.com',
      clientId: 'cid',
    })

    expect(result).toEqual({ data: { user } })
    expect(mockRun).toHaveBeenCalledWith(
      'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
      [
        'gitlab',
        JSON.stringify({
          groups: ['existing-group'],
          baseUrl: 'https://gitlab.example.com',
          clientId: 'cid',
          token: 'new-token',
          connectedUser: user,
        }),
        expect.any(Number),
      ],
    )
  })

  it('returns { error } from oauth when oauth fails', async () => {
    mockStartGitLabOAuth.mockRejectedValue(new Error('oauth failed'))

    const result = await handlers['postly:gitlab:oauth'](null, {
      baseUrl: 'https://gitlab.example.com',
      clientId: 'cid',
    })

    expect(result).toEqual({ error: 'Error: oauth failed' })
  })

  it('returns { data: true } from disconnect on success', async () => {
    mockQueryOne.mockReturnValue({
      value: JSON.stringify({
        baseUrl: 'https://gitlab.example.com',
        clientId: 'cid',
        token: 'old-token',
        connectedUser: { username: 'octocat' },
      }),
    })

    const result = await handlers['postly:gitlab:disconnect'](null)

    expect(result).toEqual({ data: true })
    expect(mockRun).toHaveBeenCalledWith(
      'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)',
      [
        'gitlab',
        JSON.stringify({
          baseUrl: 'https://gitlab.example.com',
          clientId: 'cid',
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

    const result = await handlers['postly:gitlab:disconnect'](null)

    expect(result).toEqual({ error: 'Error: write failed' })
  })
})
