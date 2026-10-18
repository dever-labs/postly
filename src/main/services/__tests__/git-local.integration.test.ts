import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const scratchRoot = path.join(__dirname, '.scratch-git-local')
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

describe('git-local with a real git repository', () => {
  it('detects the default branch of a reachable repository', async () => {
    const info = await testConnectivity(remoteRoot)
    expect(info.defaultBranch).toBe('main')
  })

  it('clones, then lists branches and reports the current one', async () => {
    await cloneOrPull('it-repo', remoteRoot, 'main')
    expect(fs.existsSync(path.join(userDataRoot, 'repos', 'it-repo', 'README.md'))).toBe(true)
    expect((await listBranches('it-repo')).sort()).toEqual(['develop', 'main'])
    expect(await getCurrentBranch('it-repo')).toBe('main')
    await cloneOrPull('it-repo', remoteRoot, 'main')
  })

  it('writes, commits, and pushes a collection export', async () => {
    await cloneOrPull('push-repo', remoteRoot, 'main')
    configureRepoUser('push-repo')

    await commitAndPush(
      'push-repo',
      'collections/api.postly.json',
      '{"hello":"world"}\n',
      'Save exported collection',
      'main',
    )

    const clonePath = path.join(userDataRoot, 'repos', 'push-repo')
    expect(fs.readFileSync(path.join(clonePath, 'collections', 'api.postly.json'), 'utf8')).toContain('"hello":"world"')
    expect(git(clonePath, 'log', '-1', '--pretty=%s').trim()).toBe('Save exported collection')

    const verifyRoot = path.join(scratchRoot, 'verify-push')
    fs.rmSync(verifyRoot, { recursive: true, force: true })
    git(scratchRoot, 'clone', remoteRoot, verifyRoot)
    expect(fs.readFileSync(path.join(verifyRoot, 'collections', 'api.postly.json'), 'utf8')).toContain('"hello":"world"')
  })

  it('rejects commit paths outside the repository', async () => {
    await cloneOrPull('safe-repo', remoteRoot, 'main')
    configureRepoUser('safe-repo')
    await expect(
      commitAndPush('safe-repo', '../outside.json', '{}', 'unsafe', 'main'),
    ).rejects.toThrow('Invalid file path: must be within the repository directory')
  })

  it('returns the HEAD file content for diffs and reports when content changed', async () => {
    await cloneOrPull('diff-repo', remoteRoot, 'main')
    const diff = await getDiff('diff-repo', 'README.md', 'changed\n')
    expect(diff).toEqual({
      localContent: 'changed\n',
      remoteContent: 'hello\n',
      hasChanges: true,
    })
  })

  it('deletes a committed collection file and pushes the removal', async () => {
    await cloneOrPull('delete-repo', remoteRoot, 'main')
    configureRepoUser('delete-repo')
    await commitAndPush('delete-repo', 'remove-me.postly.json', '{"remove":true}\n', 'Add removable file', 'main')

    await deleteCollectionFile('delete-repo', 'remove-me.postly.json', 'main', 'Delete removable file')

    const clonePath = path.join(userDataRoot, 'repos', 'delete-repo')
    expect(fs.existsSync(path.join(clonePath, 'remove-me.postly.json'))).toBe(false)

    const verifyRoot = path.join(scratchRoot, 'verify-delete')
    fs.rmSync(verifyRoot, { recursive: true, force: true })
    git(scratchRoot, 'clone', remoteRoot, verifyRoot)
    expect(fs.existsSync(path.join(verifyRoot, 'remove-me.postly.json'))).toBe(false)
    expect(git(verifyRoot, 'log', '-1', '--pretty=%s').trim()).toBe('Delete removable file')
  })

  it('lets SSH URLs through simple-git’s guard (they fail on the connection, not on the environment)', async () => {
    const err = await testConnectivity('git@127.0.0.1:nobody/nothing.git').catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toMatch(/not permitted|environment guard/)
  })
})
