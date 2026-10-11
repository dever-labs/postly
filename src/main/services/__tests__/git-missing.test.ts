import { describe, it, expect, vi, afterAll } from 'vitest'

// git-local captures process.env at import time, so hide git (and any inherited GIT_*/editor variables) before importing it
const savedEnv = vi.hoisted(() => {
  const saved = { ...process.env }
  for (const k of Object.keys(process.env)) delete process.env[k]
  process.env.PATH = '/nonexistent'
  return saved
})

vi.mock('electron', () => ({ app: { getPath: vi.fn().mockReturnValue('/tmp/postly-git-missing') } }))
vi.mock('../../database', () => ({ queryAll: vi.fn(), queryOne: vi.fn(), run: vi.fn() }))

import { GIT_MISSING_MESSAGE, GitNotInstalledError, testConnectivity, cloneOrPull } from '../git-local'

// Real simple-git with no git on PATH — the failure users without git installed would see
describe('git is not installed', () => {
  afterAll(() => { Object.assign(process.env, savedEnv) })

  it('testConnectivity explains that git is missing', async () => {
    await expect(testConnectivity('https://github.com/org/repo.git')).rejects.toBeInstanceOf(GitNotInstalledError)
    await expect(testConnectivity('https://github.com/org/repo.git')).rejects.toThrow(GIT_MISSING_MESSAGE)
  })

  it('cloneOrPull explains that git is missing', async () => {
    await expect(cloneOrPull('missing-git-test', 'https://github.com/org/repo.git', 'main')).rejects.toBeInstanceOf(GitNotInstalledError)
  })

  it('reads cleanly when an IPC handler stringifies it', () => {
    expect(String(new GitNotInstalledError())).toBe(GIT_MISSING_MESSAGE)
    expect(GIT_MISSING_MESSAGE).toContain('git-scm.com')
  })
})
