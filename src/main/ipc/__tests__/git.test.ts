import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers: Record<string, (event: unknown, args: unknown) => Promise<unknown>> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, args: unknown) => Promise<unknown>) => {
      handlers[channel] = handler
    }),
  },
}))

vi.mock('../../database', () => ({
  queryAll: vi.fn(),
  queryOne: vi.fn(),
  run: vi.fn(),
}))

vi.mock('../../services/github', () => ({
  listBranches: vi.fn(),
  createBranch: vi.fn(),
  discoverApis: vi.fn(),
  getFileContent: vi.fn(),
  getFileSha: vi.fn(),
  commitFile: vi.fn(),
}))

vi.mock('../../services/gitlab', () => ({
  listBranches: vi.fn(),
  createBranch: vi.fn(),
  discoverApis: vi.fn(),
  getFileContent: vi.fn(),
  getFileSha: vi.fn(),
  commitFile: vi.fn(),
}))

vi.mock('../../services/git-local', () => ({
  getCurrentBranch: vi.fn(),
  listBranches: vi.fn(),
  createAndPushBranch: vi.fn(),
  switchBranch: vi.fn(),
  discoverAndImport: vi.fn(),
  getDiff: vi.fn(),
  commitAndPush: vi.fn(),
}))

vi.mock('../export-import', () => ({
  buildExport: vi.fn(),
}))

import { registerGitHandlers } from '../git'
import { queryAll, queryOne, run } from '../../database'
import * as github from '../../services/github'
import * as gitlab from '../../services/gitlab'
import * as gitLocal from '../../services/git-local'
import { buildExport } from '../export-import'

const mockQueryAll = vi.mocked(queryAll)
const mockQueryOne = vi.mocked(queryOne)
const mockRun = vi.mocked(run)
const mockGitHub = vi.mocked(github)
const mockGitLab = vi.mocked(gitlab)
const mockGitLocal = vi.mocked(gitLocal)
const mockBuildExport = vi.mocked(buildExport)

function invoke(channel: string, args: unknown) {
  return handlers[channel](null, args) as Promise<Record<string, unknown>>
}

beforeEach(() => {
  vi.clearAllMocks()
  registerGitHandlers()
})

describe('Git IPC handlers', () => {
  it('returns the current local branch', async () => {
    mockGitLocal.getCurrentBranch.mockResolvedValueOnce('feature/test')

    const result = await invoke('postly:git:current-branch', { integrationId: 'git-1' })

    expect(result).toEqual({ data: 'feature/test' })
    expect(mockGitLocal.getCurrentBranch).toHaveBeenCalledWith('git-1')
  })

  it('wraps current branch errors', async () => {
    mockGitLocal.getCurrentBranch.mockRejectedValueOnce(new Error('not a git repo'))

    const result = await invoke('postly:git:current-branch', { integrationId: 'git-1' })

    expect(result).toEqual({ error: 'Error: not a git repo' })
  })

  it('lists GitHub branches using owner/repo parsing', async () => {
    mockQueryOne.mockReturnValueOnce({
      id: 'gh-1',
      type: 'github',
      base_url: 'https://github.com',
      token: 'gh-token',
      repo: 'octo/widgets',
      branch: 'main',
    })
    mockGitHub.listBranches.mockResolvedValueOnce(['main', 'develop'])

    const result = await invoke('postly:git:branches:list', { integrationId: 'gh-1' })

    expect(result).toEqual({ data: ['main', 'develop'] })
    expect(mockGitHub.listBranches).toHaveBeenCalledWith('gh-token', 'octo', 'widgets')
  })

  it('lists GitLab branches using an encoded project id', async () => {
    mockQueryOne.mockReturnValueOnce({
      id: 'gl-1',
      type: 'gitlab',
      base_url: 'https://gitlab.example.com',
      token: 'gl-token',
      repo: 'group/api repo',
      branch: 'main',
    })
    mockGitLab.listBranches.mockResolvedValueOnce(['main'])

    const result = await invoke('postly:git:branches:list', { integrationId: 'gl-1' })

    expect(result).toEqual({ data: ['main'] })
    expect(mockGitLab.listBranches).toHaveBeenCalledWith(
      'gl-token',
      'https://gitlab.example.com',
      'group%2Fapi%20repo',
    )
  })

  it('creates a GitLab branch and returns data:true', async () => {
    mockQueryOne.mockReturnValueOnce({
      id: 'gl-1',
      type: 'gitlab',
      base_url: 'https://gitlab.example.com',
      token: 'gl-token',
      repo: 'group/project',
      branch: 'main',
    })

    const result = await invoke('postly:git:branch:create', {
      integrationId: 'gl-1',
      newBranch: 'feature/tests',
      fromBranch: 'main',
    })

    expect(result).toEqual({ data: true })
    expect(mockGitLab.createBranch).toHaveBeenCalledWith(
      'gl-token',
      'https://gitlab.example.com',
      'group%2Fproject',
      'feature/tests',
      'main',
    )
  })

  it('switches a local branch and persists the selected branch', async () => {
    mockQueryOne.mockReturnValueOnce({
      id: 'git-1',
      type: 'git',
      base_url: '',
      token: '',
      repo: '/repos/local',
      branch: 'main',
    })

    const result = await invoke('postly:git:branch:switch', {
      integrationId: 'git-1',
      branch: 'feature/tests',
    })

    expect(result).toEqual({ data: true })
    expect(mockGitLocal.switchBranch).toHaveBeenCalledWith('git-1', 'feature/tests')
    expect(mockRun).toHaveBeenCalledWith(
      'UPDATE integrations SET branch = ?, updated_at = ? WHERE id = ?',
      ['feature/tests', expect.any(Number), 'git-1'],
    )
  })

  it('returns a not-found error when syncing a missing integration', async () => {
    mockQueryOne.mockReturnValueOnce(null)

    const result = await invoke('postly:git:sync', {
      integrationId: 'missing',
      collectionId: 'col-1',
      collectionName: 'Example',
    })

    expect(result).toEqual({ error: 'Integration not found' })
  })

  it('syncs a local git integration with collection options', async () => {
    mockQueryOne.mockReturnValueOnce({
      id: 'git-1',
      type: 'git',
      base_url: '',
      token: '',
      repo: '/repos/local',
      branch: 'trunk',
    })

    const result = await invoke('postly:git:sync', {
      integrationId: 'git-1',
      collectionId: 'col-1',
      collectionName: 'Imported API',
    })

    expect(result).toEqual({ data: true })
    expect(mockGitLocal.discoverAndImport).toHaveBeenCalledWith('git-1', '/repos/local', 'trunk', {
      collectionId: 'col-1',
      collectionName: 'Imported API',
    })
  })

  it('builds a GitHub diff from local and remote content', async () => {
    mockQueryOne
      .mockReturnValueOnce({
        id: 'req-1',
        folder_id: 'folder-1',
        name: 'Create item',
        method: 'POST',
        url: 'https://api.example.com/items',
        params: '{}',
        headers: '{}',
        body_type: 'json',
        body_content: '{"name":"local"}',
        auth_type: 'none',
        auth_config: '{}',
        description: '',
        scm_path: 'requests/create-item.json',
        scm_sha: '',
        is_dirty: 1,
      })
      .mockReturnValueOnce({
        id: 'req-1',
        folder_id: 'folder-1',
        name: 'Create item',
        method: 'POST',
        url: 'https://api.example.com/items',
        params: '{}',
        headers: '{}',
        body_type: 'json',
        body_content: '{"name":"local"}',
        auth_type: 'none',
        auth_config: '{}',
        description: '',
        scm_path: 'requests/create-item.json',
        scm_sha: '',
        is_dirty: 1,
      })
      .mockReturnValueOnce({
        id: 'root-1',
        parent_id: null,
        name: 'Catalog API',
        source: 'github',
        source_meta: JSON.stringify({ repo: 'octo/alt-repo' }),
        integration_id: 'gh-1',
      })
      .mockReturnValueOnce({
        id: 'gh-1',
        type: 'github',
        base_url: 'https://github.com',
        token: 'gh-token',
        repo: 'octo/default-repo',
        branch: 'main',
      })
    mockGitHub.getFileContent.mockResolvedValueOnce('{"name":"remote"}')

    const result = await invoke('postly:git:diff', { requestId: 'req-1' })

    expect(result).toEqual({
      data: {
        localContent: '{"name":"local"}',
        remoteContent: '{"name":"remote"}',
        hasChanges: true,
      },
    })
    expect(mockGitHub.getFileContent).toHaveBeenCalledWith(
      'gh-token',
      'octo',
      'alt-repo',
      'requests/create-item.json',
      'main',
    )
  })

  it('returns an error when diffing without a linked integration', async () => {
    mockQueryOne
      .mockReturnValueOnce({
        id: 'req-1',
        folder_id: 'folder-1',
        name: 'Request',
        method: 'GET',
        url: 'https://example.com',
        params: '{}',
        headers: '{}',
        body_type: 'none',
        body_content: '',
        auth_type: 'none',
        auth_config: '{}',
        description: '',
        scm_path: 'request.json',
        scm_sha: '',
        is_dirty: 0,
      })
      .mockReturnValueOnce({
        id: 'req-1',
        folder_id: 'folder-1',
        name: 'Request',
        method: 'GET',
        url: 'https://example.com',
        params: '{}',
        headers: '{}',
        body_type: 'none',
        body_content: '',
        auth_type: 'none',
        auth_config: '{}',
        description: '',
        scm_path: 'request.json',
        scm_sha: '',
        is_dirty: 0,
      })
      .mockReturnValueOnce({
        id: 'root-1',
        parent_id: null,
        name: 'Local',
        source: 'git',
        source_meta: null,
        integration_id: null,
      })

    const result = await invoke('postly:git:diff', { requestId: 'req-1' })

    expect(result).toEqual({ error: 'No integration found for this collection' })
  })

  it('commits a local collection export and clears dirty requests', async () => {
    mockQueryOne
      .mockReturnValueOnce({
        id: 'req-1',
        folder_id: 'folder-1',
        name: 'Request',
        method: 'POST',
        url: 'https://example.com',
        params: '{}',
        headers: '{}',
        body_type: 'json',
        body_content: '{}',
        auth_type: 'none',
        auth_config: '{}',
        description: '',
        scm_path: 'old.json',
        scm_sha: '',
        is_dirty: 1,
      })
      .mockReturnValueOnce({
        id: 'req-1',
        folder_id: 'folder-1',
        name: 'Request',
        method: 'POST',
        url: 'https://example.com',
        params: '{}',
        headers: '{}',
        body_type: 'json',
        body_content: '{}',
        auth_type: 'none',
        auth_config: '{}',
        description: '',
        scm_path: 'old.json',
        scm_sha: '',
        is_dirty: 1,
      })
      .mockReturnValueOnce({
        id: 'col-1',
        parent_id: null,
        name: 'My API',
        source: 'git',
        source_meta: null,
        integration_id: 'git-1',
      })
      .mockReturnValueOnce({
        id: 'git-1',
        type: 'git',
        base_url: '',
        token: '',
        repo: '/repos/local',
        branch: 'main',
      })
    mockBuildExport.mockReturnValueOnce({
      $schema: 'postly/v1',
      exportedAt: '2026-10-08T00:00:00.000Z',
      collections: [{
        name: 'My API',
        description: '',
        source: 'git',
        auth: { type: 'none', config: {} },
        ssl: 'inherit',
        requests: [],
        folders: [],
      }],
    })

    const result = await invoke('postly:git:commit', {
      requestId: 'req-1',
      commitMessage: 'Save request changes',
      branch: 'feature/tests',
      fromBranch: 'main',
    })

    expect(result).toEqual({ data: true })
    expect(mockGitLocal.createAndPushBranch).toHaveBeenCalledWith('git-1', 'feature/tests', 'main')
    expect(mockGitLocal.commitAndPush).toHaveBeenCalledWith(
      'git-1',
      'my-api.postly.json',
      expect.stringContaining('"$schema": "postly/v1"'),
      'Save request changes',
      'feature/tests',
    )
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE requests'),
      ['col-1', expect.any(Number)],
    )
  })

  it('commits to GitHub, creates a branch, updates scm_sha, and clears dirty requests', async () => {
    mockQueryOne
      .mockReturnValueOnce({
        id: 'req-1',
        folder_id: 'folder-1',
        name: 'Request',
        method: 'POST',
        url: 'https://example.com',
        params: '{}',
        headers: '{}',
        body_type: 'json',
        body_content: '{}',
        auth_type: 'none',
        auth_config: '{}',
        description: '',
        scm_path: 'old.json',
        scm_sha: 'prev-sha',
        is_dirty: 1,
      })
      .mockReturnValueOnce({
        id: 'req-1',
        folder_id: 'folder-1',
        name: 'Request',
        method: 'POST',
        url: 'https://example.com',
        params: '{}',
        headers: '{}',
        body_type: 'json',
        body_content: '{}',
        auth_type: 'none',
        auth_config: '{}',
        description: '',
        scm_path: 'old.json',
        scm_sha: 'prev-sha',
        is_dirty: 1,
      })
      .mockReturnValueOnce({
        id: 'col-1',
        parent_id: null,
        name: 'Remote API',
        source: 'github',
        source_meta: JSON.stringify({ repo: 'octo/remote-api' }),
        integration_id: 'gh-1',
      })
      .mockReturnValueOnce({
        id: 'gh-1',
        type: 'github',
        base_url: 'https://github.com',
        token: 'gh-token',
        repo: 'octo/fallback',
        branch: 'main',
      })
    mockBuildExport.mockReturnValueOnce({
      $schema: 'postly/v1',
      exportedAt: '2026-10-08T00:00:00.000Z',
      collections: [{
        name: 'Remote API',
        description: '',
        source: 'github',
        auth: { type: 'none', config: {} },
        ssl: 'inherit',
        requests: [],
        folders: [],
      }],
    })
    mockGitHub.getFileSha.mockResolvedValueOnce('sha-123')

    const result = await invoke('postly:git:commit', {
      requestId: 'req-1',
      commitMessage: 'Publish API collection',
      branch: 'feature/remote',
      fromBranch: 'main',
    })

    expect(result).toEqual({ data: true })
    expect(mockGitHub.createBranch).toHaveBeenCalledWith(
      'gh-token',
      'octo',
      'remote-api',
      'feature/remote',
      'main',
    )
    expect(mockGitHub.getFileSha).toHaveBeenCalledWith(
      'gh-token',
      'octo',
      'remote-api',
      'remote-api.postly.json',
      'feature/remote',
    )
    expect(mockGitHub.commitFile).toHaveBeenCalledWith(
      'gh-token',
      'octo',
      'remote-api',
      'remote-api.postly.json',
      expect.stringContaining('"collections": ['),
      'sha-123',
      'Publish API collection',
      'feature/remote',
    )
    expect(mockRun.mock.calls[0]).toEqual([
      'UPDATE requests SET scm_sha = ?, is_dirty = 0, updated_at = ? WHERE id = ?',
      ['sha-123', expect.any(Number), 'req-1'],
    ])
    expect(mockRun.mock.calls[1]).toEqual([
      expect.stringContaining('UPDATE requests'),
      ['col-1', expect.any(Number)],
    ])
  })

  it('returns an error when commit export data has no collection', async () => {
    mockQueryOne
      .mockReturnValueOnce({
        id: 'req-1',
        folder_id: 'folder-1',
        name: 'Request',
        method: 'GET',
        url: 'https://example.com',
        params: '{}',
        headers: '{}',
        body_type: 'none',
        body_content: '',
        auth_type: 'none',
        auth_config: '{}',
        description: '',
        scm_path: 'request.json',
        scm_sha: '',
        is_dirty: 0,
      })
      .mockReturnValueOnce({
        id: 'req-1',
        folder_id: 'folder-1',
        name: 'Request',
        method: 'GET',
        url: 'https://example.com',
        params: '{}',
        headers: '{}',
        body_type: 'none',
        body_content: '',
        auth_type: 'none',
        auth_config: '{}',
        description: '',
        scm_path: 'request.json',
        scm_sha: '',
        is_dirty: 0,
      })
      .mockReturnValueOnce({
        id: 'col-1',
        parent_id: null,
        name: 'Broken',
        source: 'git',
        source_meta: null,
        integration_id: 'git-1',
      })
      .mockReturnValueOnce({
        id: 'git-1',
        type: 'git',
        base_url: '',
        token: '',
        repo: '/repos/local',
        branch: 'main',
      })
    mockBuildExport.mockReturnValueOnce({
      $schema: 'postly/v1',
      exportedAt: '2026-10-08T00:00:00.000Z',
      collections: [],
    })

    const result = await invoke('postly:git:commit', {
      requestId: 'req-1',
      commitMessage: 'Broken export',
      branch: 'main',
    })

    expect(result).toEqual({ error: 'Collection not found' })
  })

  it('imports a local git integration and returns the created collection', async () => {
    mockQueryOne
      .mockReturnValueOnce({
        id: 'git-1',
        type: 'git',
        base_url: '',
        token: '',
        repo: '/repos/local',
        branch: 'main',
      })
      .mockReturnValueOnce({ id: 'col-1', name: 'Imported API' })
    mockGitLocal.discoverAndImport.mockResolvedValueOnce('col-1')

    const result = await invoke('postly:git:import', {
      integrationId: 'git-1',
      collectionName: 'Imported API',
    })

    expect(result).toEqual({ data: { id: 'col-1', name: 'Imported API' } })
    expect(mockGitLocal.discoverAndImport).toHaveBeenCalledWith('git-1', '/repos/local', 'main', {
      collectionId: undefined,
      collectionName: 'Imported API',
    })
  })

  it('falls back to an existing imported collection when import throws', async () => {
    mockQueryOne
      .mockReturnValueOnce({
        id: 'git-1',
        type: 'git',
        base_url: '',
        token: '',
        repo: '/repos/local',
        branch: 'main',
      })
      .mockReturnValueOnce({ id: 'col-1', name: 'Existing API' })
    mockGitLocal.discoverAndImport.mockRejectedValueOnce(new Error('clone failed'))

    const result = await invoke('postly:git:import', {
      integrationId: 'git-1',
      collectionName: 'Existing API',
    })

    expect(result).toEqual({ data: { id: 'col-1', name: 'Existing API' } })
  })

  it('returns no dirty requests when the collection tree is empty', async () => {
    mockQueryAll.mockReturnValueOnce([])

    const result = await invoke('postly:git:dirty-requests', { collectionId: 'col-1' })

    expect(result).toEqual({ data: [] })
    expect(mockQueryAll).toHaveBeenCalledOnce()
  })

  it('pushes a collection, records the generated fileName, and clears dirty requests', async () => {
    mockQueryOne
      .mockReturnValueOnce({
        id: 'col-1',
        name: 'Push Me',
        source: 'git',
        source_meta: JSON.stringify({ integrationId: 'git-1' }),
        integration_id: null,
      })
      .mockReturnValueOnce({
        id: 'git-1',
        type: 'git',
        base_url: '',
        token: '',
        repo: '/repos/local',
        branch: 'main',
      })
    mockBuildExport.mockReturnValueOnce({
      $schema: 'postly/v1',
      exportedAt: '2026-10-08T00:00:00.000Z',
      collections: [{
        name: 'Push Me',
        description: '',
        source: 'git',
        auth: { type: 'none', config: {} },
        ssl: 'inherit',
        requests: [],
        folders: [],
      }],
    })

    const result = await invoke('postly:git:push-collection', {
      collectionId: 'col-1',
      commitMessage: 'Push collection',
      branch: 'release',
    })

    expect(result).toEqual({ data: true })
    expect(mockGitLocal.commitAndPush).toHaveBeenCalledWith(
      'git-1',
      'push-me.postly.json',
      expect.stringContaining('"Push Me"'),
      'Push collection',
      'release',
    )
    const firstRun = mockRun.mock.calls[0] as [string, unknown[]]
    expect(firstRun[0]).toContain('UPDATE folders SET source_meta = ?, updated_at = ? WHERE id = ?')
    expect(firstRun[1][2]).toBe('col-1')
    expect(JSON.parse(String(firstRun[1][0]))).toEqual({
      integrationId: 'git-1',
      fileName: 'push-me.postly.json',
    })
    expect(mockRun.mock.calls[1]).toEqual([
      expect.stringContaining('UPDATE requests'),
      ['col-1', expect.any(Number)],
    ])
  })

  it('returns an error when pushing a collection without an integration link', async () => {
    mockQueryOne.mockReturnValueOnce({
      id: 'col-1',
      name: 'Unlinked',
      source: 'local',
      source_meta: '{}',
      integration_id: null,
    })

    const result = await invoke('postly:git:push-collection', {
      collectionId: 'col-1',
      commitMessage: 'Push collection',
      branch: 'main',
    })

    expect(result).toEqual({ error: 'No integration linked to this collection' })
  })
})
