import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const scratchRoot = path.join(__dirname, '.scratch-git-local-real')
const userDataRoot = path.join(scratchRoot, 'user-data')
const remoteRoot = path.join(scratchRoot, 'remote.git')
const seedRoot = path.join(scratchRoot, 'seed')

vi.mock('electron', () => ({ app: { getPath: () => userDataRoot } }))
vi.mock('../../database', () => ({ queryAll: vi.fn(), queryOne: vi.fn(), run: vi.fn() }))

import {
  cloneOrPull,
  commitAndPush,
  deleteCollectionFile,
  getCurrentBranch,
  getDiff,
  listBranches,
  testConnectivity,
} from '../git-local'

const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    'git',
    ['-c', 'user.name=Postly Tests', '-c', 'user.email=tests@example.com', '-c', 'init.defaultBranch=main', ...args],
    { cwd, stdio: 'pipe' },
  ).toString('utf8')

const configureRepoUser = (repoName: string) => {
  const repoPath = path.join(userDataRoot, 'repos', repoName)
  git(repoPath, 'config', 'user.name', 'Postly Tests')
  git(repoPath, 'config', 'user.email', 'tests@example.com')
}

beforeAll(() => {
  fs.rmSync(scratchRoot, { recursive: true, force: true })
  fs.mkdirSync(scratchRoot, { recursive: true })
  fs.mkdirSync(userDataRoot, { recursive: true })
  git(scratchRoot, 'init', '--bare', remoteRoot)

  fs.mkdirSync(seedRoot, { recursive: true })
  git(seedRoot, 'init')
  fs.writeFileSync(path.join(seedRoot, 'README.md'), 'hello\n')
  fs.writeFileSync(path.join(seedRoot, 'sample.postly.json'), '{"name":"seed"}\n')
  git(seedRoot, 'add', '.')
  git(seedRoot, 'commit', '-m', 'init')
  git(seedRoot, 'push', remoteRoot, 'HEAD:main')
  git(seedRoot, 'push', remoteRoot, 'HEAD:develop')
}, 30_000)

afterAll(() => {
  fs.rmSync(scratchRoot, { recursive: true, force: true })
})

describe('git-local over a real repository', () => {
  it('detects the default branch of a reachable repository', async () => {
    const info = await testConnectivity(remoteRoot)
    expect(info.defaultBranch).toBe('main')
  })

  it('clones, lists branches, and reports the current branch', async () => {
    await cloneOrPull('it-repo', remoteRoot, 'main')
    expect(fs.existsSync(path.join(userDataRoot, 'repos', 'it-repo', 'README.md'))).toBe(true)
    expect((await listBranches('it-repo')).sort()).toEqual(['develop', 'main'])
    expect(await getCurrentBranch('it-repo')).toBe('main')
  })

  it('commits and pushes exported collections', async () => {
    await cloneOrPull('push-repo', remoteRoot, 'main')
    configureRepoUser('push-repo')

    await commitAndPush(
      'push-repo',
      'collections/api.postly.json',
      '{"hello":"world"}\n',
      'Save exported collection',
      'main',
    )

    const verifyRoot = path.join(scratchRoot, 'verify-push')
    fs.rmSync(verifyRoot, { recursive: true, force: true })
    git(scratchRoot, 'clone', remoteRoot, verifyRoot)
    expect(fs.readFileSync(path.join(verifyRoot, 'collections', 'api.postly.json'), 'utf8')).toContain('"hello":"world"')
    expect(git(verifyRoot, 'log', '-1', '--pretty=%s').trim()).toBe('Save exported collection')
  })

  it('reports diffs against HEAD and deletes committed collection files', async () => {
    await cloneOrPull('delete-repo', remoteRoot, 'main')
    configureRepoUser('delete-repo')
    await commitAndPush('delete-repo', 'remove-me.postly.json', '{"remove":true}\n', 'Add removable file', 'main')

    const diff = await getDiff('delete-repo', 'remove-me.postly.json', '{"remove":false}\n')
    expect(diff).toEqual({
      localContent: '{"remove":false}\n',
      remoteContent: '{"remove":true}\n',
      hasChanges: true,
    })

    await deleteCollectionFile('delete-repo', 'remove-me.postly.json', 'main', 'Delete removable file')

    const verifyRoot = path.join(scratchRoot, 'verify-delete')
    fs.rmSync(verifyRoot, { recursive: true, force: true })
    git(scratchRoot, 'clone', remoteRoot, verifyRoot)
    expect(fs.existsSync(path.join(verifyRoot, 'remove-me.postly.json'))).toBe(false)
    expect(git(verifyRoot, 'log', '-1', '--pretty=%s').trim()).toBe('Delete removable file')
  })

  it('rejects path traversal outside the repository', async () => {
    await cloneOrPull('safe-repo', remoteRoot, 'main')
    configureRepoUser('safe-repo')
    await expect(
      commitAndPush('safe-repo', '../outside.json', '{}', 'unsafe', 'main'),
    ).rejects.toThrow('Invalid file path: must be within the repository directory')
  })
})
