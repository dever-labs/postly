import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Module mocks (hoisted before imports) ─────────────────────────────────────

vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/userData') },
}))

vi.mock('os', () => ({
  default: { homedir: vi.fn().mockReturnValue('/home/testuser') },
  homedir: vi.fn().mockReturnValue('/home/testuser'),
}))

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readdirSync: vi.fn().mockReturnValue([]),
    readFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
}))

// Build a chainable simpleGit mock that captures env() calls
const mockGitInstance = {
  env: vi.fn(),
  raw: vi.fn(),
  listRemote: vi.fn(),
  fetch: vi.fn(),
  checkout: vi.fn(),
  pull: vi.fn(),
  clone: vi.fn(),
  branch: vi.fn(),
  push: vi.fn(),
  add: vi.fn(),
  commit: vi.fn(),
  rm: vi.fn(),
  revparse: vi.fn(),
  checkoutBranch: vi.fn(),
  checkoutLocalBranch: vi.fn(),
}
mockGitInstance.env.mockReturnValue(mockGitInstance)

vi.mock('simple-git', () => ({
  default: vi.fn(() => mockGitInstance),
}))

vi.mock('@apidevtools/swagger-parser', () => ({
  default: { dereference: vi.fn() },
}))

vi.mock('../../database', () => ({
  queryAll: vi.fn(),
  queryOne: vi.fn(),
  run: vi.fn(),
}))

// ── Import SUT after mocks ────────────────────────────────────────────────────

import { buildSshCommand, testConnectivity, cloneOrPull } from '../git-local'
import os from 'os'
import fs from 'fs'
import simpleGit from 'simple-git'

const mockHomedir = vi.mocked(os.homedir)
const mockExistsSync = vi.mocked(fs.existsSync)
const mockSimpleGit = vi.mocked(simpleGit)

beforeEach(() => {
  vi.clearAllMocks()
  mockGitInstance.env.mockReturnValue(mockGitInstance)
  mockHomedir.mockReturnValue('/home/testuser')
  mockExistsSync.mockReturnValue(false)
})

// ── buildSshCommand ───────────────────────────────────────────────────────────

describe('buildSshCommand', () => {
  it('always includes StrictHostKeyChecking=accept-new', () => {
    expect(buildSshCommand()).toContain('-o StrictHostKeyChecking=accept-new')
  })

  it('returns base command only when no key files exist', () => {
    mockExistsSync.mockReturnValue(false)
    expect(buildSshCommand()).toBe('ssh -o StrictHostKeyChecking=accept-new')
  })

  it('adds -i flag for id_ed25519 when it exists', () => {
    mockExistsSync.mockImplementation((p) => String(p).endsWith('id_ed25519'))
    const cmd = buildSshCommand()
    expect(cmd).toContain('-i "/home/testuser/.ssh/id_ed25519"')
  })

  it('adds -i flag for id_rsa when it exists', () => {
    mockExistsSync.mockImplementation((p) => String(p).endsWith('id_rsa'))
    const cmd = buildSshCommand()
    expect(cmd).toContain('-i "/home/testuser/.ssh/id_rsa"')
  })

  it('adds -i flags for all key files that exist', () => {
    mockExistsSync.mockImplementation((p) =>
      String(p).endsWith('id_ed25519') || String(p).endsWith('id_rsa')
    )
    const cmd = buildSshCommand()
    expect(cmd).toContain('-i "/home/testuser/.ssh/id_ed25519"')
    expect(cmd).toContain('-i "/home/testuser/.ssh/id_rsa"')
  })

  it('lists ed25519 before rsa (OpenSSH priority order)', () => {
    mockExistsSync.mockImplementation((p) =>
      String(p).endsWith('id_ed25519') || String(p).endsWith('id_rsa')
    )
    const cmd = buildSshCommand()
    expect(cmd.indexOf('id_ed25519')).toBeLessThan(cmd.indexOf('id_rsa'))
  })

  it('lists ecdsa before rsa', () => {
    mockExistsSync.mockImplementation((p) =>
      String(p).endsWith('id_ecdsa') || String(p).endsWith('id_rsa')
    )
    const cmd = buildSshCommand()
    expect(cmd.indexOf('id_ecdsa')).toBeLessThan(cmd.indexOf('id_rsa'))
  })

  it('converts Windows backslashes to forward slashes in key paths', () => {
    mockHomedir.mockReturnValue('C:\\Users\\testuser')
    mockExistsSync.mockImplementation((p) => String(p).endsWith('id_ed25519') || String(p).endsWith('id_ed25519'.replace(/\//g, '\\')))
    const cmd = buildSshCommand()
    expect(cmd).not.toContain('\\')
    expect(cmd).toContain('C:/Users/testuser/.ssh/id_ed25519')
  })

  it('uses the real home directory from os.homedir()', () => {
    mockHomedir.mockReturnValue('/custom/home')
    mockExistsSync.mockImplementation((p) => String(p).endsWith('id_ed25519'))
    const cmd = buildSshCommand()
    expect(cmd).toContain('/custom/home/.ssh/id_ed25519')
  })

  it('does not include keys whose files do not exist', () => {
    mockExistsSync.mockImplementation((p) => String(p).endsWith('id_ed25519'))
    const cmd = buildSshCommand()
    expect(cmd).not.toContain('id_rsa')
    expect(cmd).not.toContain('id_ecdsa')
    expect(cmd).not.toContain('id_dsa')
  })
})

// ── testConnectivity — SSH env propagation ────────────────────────────────────

describe('testConnectivity — SSH environment', () => {
  beforeEach(() => {
    // Make id_ed25519 exist so GIT_SSH_COMMAND will have -i flags
    mockExistsSync.mockImplementation((p) => {
      const s = String(p)
      return s.endsWith('id_ed25519') || s.endsWith('.git')
    })
    mockGitInstance.raw.mockResolvedValue('ref: refs/heads/main\tHEAD\nmain\tHEAD')
  })

  it('calls simpleGit().env() with GIT_SSH_COMMAND set', async () => {
    await testConnectivity('git@github.com:org/repo.git')
    expect(mockGitInstance.env).toHaveBeenCalledWith(
      expect.objectContaining({ GIT_SSH_COMMAND: expect.stringContaining('StrictHostKeyChecking=accept-new') })
    )
  })

  it('GIT_SSH_COMMAND in env starts with the ssh command', async () => {
    await testConnectivity('git@github.com:org/repo.git')
    const envArg = mockGitInstance.env.mock.calls[0][0] as Record<string, string>
    expect(envArg.GIT_SSH_COMMAND).toMatch(/^ssh /)
  })

  it('sets GIT_TERMINAL_PROMPT=0 to suppress interactive prompts', async () => {
    await testConnectivity('git@github.com:org/repo.git')
    const envArg = mockGitInstance.env.mock.calls[0][0] as Record<string, string>
    expect(envArg.GIT_TERMINAL_PROMPT).toBe('0')
  })

  it('sets GCM_INTERACTIVE=never to suppress GCM GUI dialogs', async () => {
    await testConnectivity('git@github.com:org/repo.git')
    const envArg = mockGitInstance.env.mock.calls[0][0] as Record<string, string>
    expect(envArg.GCM_INTERACTIVE).toBe('never')
  })

  it('extracts default branch from ls-remote --symref output', async () => {
    mockGitInstance.raw.mockResolvedValueOnce(
      'ref: refs/heads/develop\tHEAD\ndevelop\tHEAD'
    )
    const { defaultBranch } = await testConnectivity('git@github.com:org/repo.git')
    expect(defaultBranch).toBe('develop')
  })

  it('falls back to main when symref output has no branch match', async () => {
    mockGitInstance.raw.mockResolvedValueOnce('some output without symref')
    const { defaultBranch } = await testConnectivity('https://github.com/org/repo.git')
    expect(defaultBranch).toBe('main')
  })

  it('falls back to listRemote when ls-remote --symref throws', async () => {
    mockGitInstance.raw
      .mockRejectedValueOnce(new Error('server does not support symref'))
      .mockResolvedValueOnce('') // git config user.name
    mockGitInstance.listRemote.mockResolvedValueOnce('')
    const { defaultBranch } = await testConnectivity('git@github.com:org/repo.git')
    expect(mockGitInstance.listRemote).toHaveBeenCalledWith(['git@github.com:org/repo.git'])
    expect(defaultBranch).toBe('main')
  })

  it('works with both SSH (git@) and HTTPS URLs', async () => {
    mockGitInstance.raw.mockResolvedValue('ref: refs/heads/main\tHEAD\nmain\tHEAD')

    const sshResult = await testConnectivity('git@github.com:org/repo.git')
    const httpsResult = await testConnectivity('https://github.com/org/repo.git')

    expect(sshResult.defaultBranch).toBe('main')
    expect(httpsResult.defaultBranch).toBe('main')
  })
})

// ── cloneOrPull — SSH env propagation ─────────────────────────────────────────

describe('cloneOrPull — SSH environment', () => {
  const integrationId = 'int-1'
  const repoUrl = 'git@github.com:org/repo.git'
  const branch = 'main'

  beforeEach(() => {
    mockGitInstance.fetch.mockResolvedValue(undefined)
    mockGitInstance.checkout.mockResolvedValue(undefined)
    mockGitInstance.pull.mockResolvedValue(undefined)
    mockGitInstance.clone.mockResolvedValue(undefined)
    mockGitInstance.branch.mockResolvedValue({ branches: {} })
  })

  it('clones with SSH env when no local .git directory exists', async () => {
    mockExistsSync.mockReturnValue(false) // no .git dir

    await cloneOrPull(integrationId, repoUrl, branch)

    // simpleGit() (no path) called to clone, then .env() with SSH env
    expect(mockSimpleGit).toHaveBeenCalled()
    expect(mockGitInstance.env).toHaveBeenCalledWith(
      expect.objectContaining({ GIT_SSH_COMMAND: expect.stringContaining('StrictHostKeyChecking=accept-new') })
    )
    expect(mockGitInstance.clone).toHaveBeenCalledWith(repoUrl, expect.any(String))
  })

  it('creates the local directory before cloning', async () => {
    mockExistsSync.mockReturnValue(false)

    await cloneOrPull(integrationId, repoUrl, branch)

    expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true })
  })

  it('fetches with SSH env when .git directory already exists', async () => {
    mockExistsSync.mockImplementation((p) => String(p).endsWith('.git'))

    await cloneOrPull(integrationId, repoUrl, branch)

    expect(mockGitInstance.env).toHaveBeenCalledWith(
      expect.objectContaining({ GIT_SSH_COMMAND: expect.stringContaining('StrictHostKeyChecking=accept-new') })
    )
    expect(mockGitInstance.fetch).toHaveBeenCalled()
    expect(mockGitInstance.clone).not.toHaveBeenCalled()
  })

  it('checks out the requested branch after fetching', async () => {
    mockExistsSync.mockImplementation((p) => String(p).endsWith('.git'))

    await cloneOrPull(integrationId, repoUrl, branch)

    expect(mockGitInstance.checkout).toHaveBeenCalledWith(branch)
    expect(mockGitInstance.pull).toHaveBeenCalledWith('origin', branch)
  })

  it('does not throw when checkout fails on pull path (branch may not exist yet)', async () => {
    mockExistsSync.mockImplementation((p) => String(p).endsWith('.git'))
    mockGitInstance.checkout.mockRejectedValueOnce(new Error('branch not found'))

    await expect(cloneOrPull(integrationId, repoUrl, branch)).resolves.not.toThrow()
  })

  it('uses SSH env for both SSH and HTTPS remote URLs', async () => {
    const httpsUrl = 'https://github.com/org/repo.git'
    mockExistsSync.mockReturnValue(false)

    await cloneOrPull(integrationId, httpsUrl, branch)

    expect(mockGitInstance.env).toHaveBeenCalledWith(
      expect.objectContaining({ GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' })
    )
  })
})

// ── SSH URL format acceptance (integration setup) ─────────────────────────────

describe('SSH URL format — repoNameFromUrl compatibility', () => {
  // buildSshCommand() leaves URLs untouched — the URL format git@... is passed
  // directly to simpleGit. Verify the SSH command is constructed independently
  // of the URL format used.

  it('buildSshCommand does not inspect or transform the repo URL', () => {
    // The command only depends on local key files, not the remote URL
    mockExistsSync.mockReturnValue(false)
    const cmd1 = buildSshCommand()

    const cmd2 = buildSshCommand()
    expect(cmd1).toBe(cmd2)
  })

  it('GIT_SSH_COMMAND works for github.com SSH URL pattern', async () => {
    mockGitInstance.raw.mockResolvedValue('ref: refs/heads/main\tHEAD\nmain\tHEAD')

    // Should not throw — SSH URL accepted as-is
    await expect(testConnectivity('git@github.com:dever-labs/test-api.git')).resolves.toMatchObject({
      defaultBranch: 'main',
    })
  })

  it('GIT_SSH_COMMAND works for gitlab.com SSH URL pattern', async () => {
    mockGitInstance.raw.mockResolvedValue('ref: refs/heads/main\tHEAD\nmain\tHEAD')

    await expect(testConnectivity('git@gitlab.com:group/project.git')).resolves.toMatchObject({
      defaultBranch: 'main',
    })
  })

  it('GIT_SSH_COMMAND works for self-hosted SSH URL pattern', async () => {
    mockGitInstance.raw.mockResolvedValue('ref: refs/heads/develop\tHEAD\ndevelop\tHEAD')

    await expect(testConnectivity('git@git.internal.company.com:team/api.git')).resolves.toMatchObject({
      defaultBranch: 'develop',
    })
  })
})
