import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { reloadApp } from './helpers'

const scratchRoot = path.join(__dirname, '.scratch-git-overlay')
const bareRepo = path.join(scratchRoot, 'remote.git')
const bareRepoUrl = pathToFileURL(bareRepo).toString()
const seedRepo = path.join(scratchRoot, 'seed')

const runId = Date.now()
const integrationName = `Git Overlay ${runId}`
const importedCollectionName = `Git Catalog ${runId}`
const createdCollectionName = `Overlay Created ${runId}`
const renamedCollectionName = `Git Catalog Edited ${runId}`
const createdGroupName = `Created Group ${runId}`
const renamedGroupName = `Renamed Group ${runId}`
const createdRequestName = `Created Endpoint ${runId}`
const renamedRequestName = `Renamed Endpoint ${runId}`

let importedCollectionId = ''
let integrationId = ''

const git = (cwd: string, ...args: string[]) =>
  execFileSync(
    'git',
    ['-c', 'user.name=Postly Tests', '-c', 'user.email=tests@example.com', '-c', 'init.defaultBranch=main', ...args],
    { cwd, stdio: 'pipe' },
  ).toString('utf8')

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'collection'
const importedFileName = `${slug(importedCollectionName)}.postly.json`

function listRepoFiles(): string[] {
  return git(scratchRoot, `--git-dir=${bareRepo}`, 'ls-tree', '-r', '--name-only', 'main')
    .split('\n')
    .filter(Boolean)
}

function readRepoFile(filePath: string): string {
  return git(scratchRoot, `--git-dir=${bareRepo}`, 'show', `main:${filePath}`)
}

function configureRepoUser(repoPath: string) {
  git(repoPath, 'config', 'user.name', 'Postly Tests')
  git(repoPath, 'config', 'user.email', 'tests@example.com')
}

async function commitOverlay(window: Page, message: string, buttonName = 'Commit & Push') {
  const dialog = window.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByPlaceholder('Commit message…').fill(message)
  await dialog.getByRole('button', { name: buttonName, exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

async function openCollection(window: Page, collectionName: string) {
  await window.getByText(collectionName, { exact: true }).first().click()
  await expect(window.getByTestId('collection-name-input')).toBeVisible()
}

async function openGroup(window: Page, collectionName: string, groupName: string) {
  const collection = window.getByText(collectionName, { exact: true }).first()
  await collection.click()
  await window.getByText(groupName, { exact: true }).first().click()
  await expect(window.getByTestId('group-name-input')).toBeVisible()
}

async function getCollectionName(window: Page, collectionId: string) {
  return window.evaluate(async (id: string) => {
    const result = await window.api.folders.list() as { data?: Array<{ id: string; name: string }> }
    return result.data?.find((folder) => folder.id === id)?.name ?? null
  }, collectionId)
}

test.describe('Git commit overlay CRUD', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ window, electronApp }) => {
    fs.rmSync(scratchRoot, { recursive: true, force: true })
    fs.mkdirSync(scratchRoot, { recursive: true })
    git(scratchRoot, 'init', '--bare', bareRepo)

    fs.mkdirSync(seedRepo, { recursive: true })
    git(seedRepo, 'init')
    fs.writeFileSync(
      path.join(seedRepo, importedFileName),
      JSON.stringify({
        $schema: 'postly/v1',
        exportedAt: new Date().toISOString(),
        collections: [{
          name: importedCollectionName,
          description: '',
          source: 'git',
          auth: { type: 'none', config: {} },
          ssl: 'inherit',
          requests: [],
          folders: [{
            name: 'Existing Group',
            description: '',
            auth: { type: 'none', config: {} },
            ssl: 'inherit',
            requests: [{
              name: 'Existing Endpoint',
              method: 'GET',
              url: 'https://example.com/existing',
              protocol: 'http',
              params: [],
              headers: [],
              bodyType: 'none',
              bodyContent: '',
              auth: { type: 'none', config: {} },
              ssl: 'inherit',
              description: '',
              protocolConfig: {},
            }],
            folders: [],
          }],
        }],
      }, null, 2),
    )
    git(seedRepo, 'add', '.')
    git(seedRepo, 'commit', '-m', 'seed collections')
    git(seedRepo, 'push', bareRepo, 'HEAD:main')

    const created = await window.evaluate(async ({ name, repo, integrationName }: { name: string; repo: string; integrationName: string }) => {
      const created = await window.api.integrations.create({
        type: 'git',
        name: integrationName,
        baseUrl: '',
        repo,
        branch: 'main',
      }) as { data: { id: string } }
      await window.api.integrations.connect({ id: created.data.id })
      const imported = await window.api.git.import({ integrationId: created.data.id, collectionName: name }) as { data: { id: string } }
      return { integrationId: created.data.id, collectionId: imported.data.id }
    }, { name: importedCollectionName, repo: bareRepoUrl, integrationName })
    integrationId = created.integrationId
    importedCollectionId = created.collectionId

    const userDataPath = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const repoPath = path.join(userDataPath, 'repos', integrationId)
    configureRepoUser(repoPath)

    await reloadApp(window)
    await expect(window.getByText(integrationName, { exact: true })).toBeVisible()
    await expect(window.getByText(importedCollectionName, { exact: true })).toBeVisible()
  })

  test.afterAll(async ({ window }) => {
    if (importedCollectionId) {
      await window.evaluate(async (id: string) => {
        await window.api.folders.delete({ id })
      }, importedCollectionId)
    }
    fs.rmSync(scratchRoot, { recursive: true, force: true })
  })

  test('creates and deletes a git-backed collection through the overlay', async ({ window }) => {
    await window.getByRole('button', { name: `Add collection to ${integrationName}` }).click()
    await window.getByPlaceholder('Collection name…').fill(createdCollectionName)
    await window.getByPlaceholder('Collection name…').press('Enter')
    await commitOverlay(window, 'test: create git-backed collection')

    const createdFile = `${slug(createdCollectionName)}.postly.json`
    await expect.poll(() => listRepoFiles()).toContain(createdFile)
    await expect.poll(() => readRepoFile(createdFile)).toContain(createdCollectionName)

    await window.getByRole('button', { name: `More actions for ${createdCollectionName}` }).click()
    await window.getByRole('menuitem', { name: 'Delete' }).click()
    await commitOverlay(window, 'test: delete git-backed collection', 'Delete & Push')

    await expect.poll(() => listRepoFiles()).not.toContain(createdFile)
  })

  test('edits a git-backed collection and commits the change', async ({ window }) => {
    await openCollection(window, importedCollectionName)
    await window.getByTestId('collection-name-input').fill(renamedCollectionName)
    await window.getByTestId('collection-save-button').click()
    await commitOverlay(window, 'test: rename git-backed collection')

    await expect.poll(() => listRepoFiles()).toContain(importedFileName)
    await expect.poll(() => readRepoFile(importedFileName)).toContain(renamedCollectionName)
  })

  test('creates, edits, and deletes a group through the overlay', async ({ window }) => {
    await window.getByRole('button', { name: `Add folder to ${renamedCollectionName}` }).click()
    await window.getByPlaceholder('Folder name…').fill(createdGroupName)
    await window.getByPlaceholder('Folder name…').press('Enter')
    await commitOverlay(window, 'test: create git-backed group')

    await expect.poll(() => readRepoFile(importedFileName)).toContain(createdGroupName)

    await openGroup(window, renamedCollectionName, createdGroupName)
    await window.getByTestId('group-name-input').fill(renamedGroupName)
    await window.getByTestId('group-save-button').click()
    await commitOverlay(window, 'test: rename git-backed group')
    await expect.poll(() => readRepoFile(importedFileName)).toContain(renamedGroupName)

    await window.getByRole('button', { name: `More actions for ${renamedGroupName}` }).click()
    await window.getByRole('menuitem', { name: 'Delete' }).click()
    await commitOverlay(window, 'test: delete git-backed group')
    await expect.poll(() => readRepoFile(importedFileName)).not.toContain(renamedGroupName)
  })

  test('creates, edits, and deletes an endpoint through the overlay', async ({ window }) => {
    await reloadApp(window)
    let collectionName = ''
    await expect.poll(async () => {
      collectionName = await getCollectionName(window, importedCollectionId) ?? ''
      return collectionName
    }).not.toBe('')
    await expect(window.getByText(collectionName, { exact: true }).first()).toBeVisible()
    await window.getByRole('button', { name: `Add request to ${collectionName}` }).click()
    await commitOverlay(window, 'test: add git-backed endpoint')
    await window.getByText('New Request', { exact: true }).last().click()
    await expect(window.getByPlaceholder('Request name')).toBeVisible()
    await expect(window.getByPlaceholder('Request name')).toHaveValue('New Request')
    await window.getByPlaceholder('Request name').fill(createdRequestName)
    await window.getByTestId('url-input').fill('https://example.com/created')
    await window.getByPlaceholder('Request name').click()
    await expect(window.getByTestId('request-save-button')).toHaveClass(/text-amber-400/)
    await window.getByTestId('request-save-button').click()
    await commitOverlay(window, 'test: create git-backed endpoint')

    await expect.poll(() => readRepoFile(importedFileName)).toContain(createdRequestName)

    await window.getByPlaceholder('Request name').fill(renamedRequestName)
    await window.getByTestId('request-save-button').click()
    await commitOverlay(window, 'test: rename git-backed endpoint')
    await expect.poll(() => readRepoFile(importedFileName)).toContain(renamedRequestName)

    await window.getByRole('button', { name: `More actions for ${renamedRequestName}` }).click()
    await window.getByRole('menuitem', { name: 'Delete' }).click()
    await commitOverlay(window, 'test: delete git-backed endpoint')
    await expect.poll(() => readRepoFile(importedFileName)).not.toContain(renamedRequestName)
  })
})
