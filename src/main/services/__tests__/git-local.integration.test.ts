import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'

const root = vi.hoisted(() => `${process.env.TMPDIR ?? '/tmp'}/postly-git-it-${process.pid}`)

vi.mock('electron', () => ({ app: { getPath: () => root } }))
vi.mock('../../database', () => ({ queryAll: vi.fn(), queryOne: vi.fn(), run: vi.fn() }))

import { testConnectivity, cloneOrPull, listBranches, getCurrentBranch } from '../git-local'

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'init.defaultBranch=main', ...args], { cwd, stdio: 'pipe' })

let remote: string

beforeAll(() => {
  fs.mkdirSync(root, { recursive: true })
  remote = path.join(root, 'remote.git')
  git(root, 'init', '--bare', remote)
  const seed = fs.mkdtempSync(path.join(os.tmpdir(), 'postly-seed-'))
  git(seed, 'init')
  fs.writeFileSync(path.join(seed, 'README.md'), 'hello')
  git(seed, 'add', '.')
  git(seed, 'commit', '-m', 'init')
  git(seed, 'push', remote, 'HEAD:main')
  git(seed, 'push', remote, 'HEAD:develop')
  fs.rmSync(seed, { recursive: true, force: true })
})

afterAll(() => { fs.rmSync(root, { recursive: true, force: true }) })

// Runs the real git binary: the unit tests mock simple-git and cannot see problems with how Postly calls it
describe('git-local with a real git repository', () => {
  it('detects the default branch of a reachable repository', async () => {
    const info = await testConnectivity(remote)
    expect(info.defaultBranch).toBe('main')
  })

  it('clones, then lists branches and reports the current one', async () => {
    await cloneOrPull('it-repo', remote, 'main')
    expect(fs.existsSync(path.join(root, 'repos', 'it-repo', 'README.md'))).toBe(true)
    expect((await listBranches('it-repo')).sort()).toEqual(['develop', 'main'])
    expect(await getCurrentBranch('it-repo')).toBe('main')
    await cloneOrPull('it-repo', remote, 'main')
  })

  it('lets SSH URLs through simple-git\'s guard (they fail on the connection, not on the environment)', async () => {
    const err = await testConnectivity('git@127.0.0.1:nobody/nothing.git').catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).not.toMatch(/not permitted|environment guard/)
  })
})
