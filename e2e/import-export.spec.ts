// e2e/import-export.spec.ts
// Tests import of both new (folders) and old (groups) export formats
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'

function buildRequest(name: string, method: string, url: string) {
  return {
    name,
    method,
    url,
    protocol: 'http',
    params: [],
    headers: [],
    bodyType: 'none',
    bodyContent: '',
    auth: { type: 'none', config: {} },
    ssl: 'inherit',
    description: '',
    protocolConfig: {},
  }
}

async function ensureLocalSourceVisible(window: Page) {
  const sourceContent = window.locator('[data-testid="source-content-local"]')
  if (!(await sourceContent.isVisible())) {
    await window.locator('[data-testid="source-toggle-local"]').click()
  }
  await expect(sourceContent).toBeVisible()
}

async function expandTreeItem(window: Page, label: string, childLabel: string) {
  const sidebar = window.locator('[data-testid="sidebar"]')
  const child = sidebar.getByText(childLabel, { exact: true }).first()
  if (await child.isVisible()) return

  const labelText = sidebar.getByText(label, { exact: true }).first()
  await expect(labelText).toBeVisible()
  await labelText.locator('xpath=ancestor::button[1]/preceding-sibling::button[1]').click()
  await expect(child).toBeVisible()
}

async function importCollectionsAndReload(window: Page, collections: Array<Record<string, unknown>>) {
  await window.evaluate(async (input: Array<Record<string, unknown>>) => {
    const result = await window.api.exportImport.importCollections({ collections: input })
    if ((result as { error?: string }).error) {
      throw new Error((result as { error: string }).error)
    }
  }, collections)

  await window.reload()
  await window.waitForSelector('[data-testid="app-root"]', { timeout: 20_000 })
  await ensureLocalSourceVisible(window)
}

async function getRootFolderIdByName(window: Page, name: string) {
  return window.evaluate(async (collectionName: string) => {
    const result = await window.api.folders.list()
    const folders = ((result as { data?: Array<Record<string, unknown>> }).data ?? [])
    const match = folders.find((folder) => !((folder.parentId ?? folder.parent_id) as string | null | undefined) && folder.name === collectionName)
    return (match?.id as string | null | undefined) ?? null
  }, name)
}

const timestamp = Date.now()
const importedCollectionIds: string[] = []

const newFormatCollectionName = `New Format API ${timestamp}`
const rootLevelCollectionName = `Root Level API ${timestamp}`
const legacyCollectionName = `Legacy API ${timestamp}`

const endpointsFolderName = `Endpoints ${timestamp}`
const newFormatRequestName = `Get Health ${timestamp}`
const rootLevelRequestName = `Ping Root ${timestamp}`
const legacyGroupName = `Users ${timestamp}`
const legacyRequestName = `List Users ${timestamp}`

test.afterAll(async ({ window }) => {
  await window.evaluate(async (ids: string[]) => {
    for (const id of ids) {
      await window.api.folders.delete({ id })
    }
  }, importedCollectionIds)
})

test.describe('Import — new format (folders)', () => {
  test.beforeAll(async ({ window }) => {
    await importCollectionsAndReload(window, [
      {
        name: newFormatCollectionName,
        description: '',
        source: 'local',
        auth: { type: 'none', config: {} },
        ssl: 'inherit',
        requests: [],
        folders: [
          {
            name: endpointsFolderName,
            description: '',
            auth: { type: 'none', config: {} },
            ssl: 'inherit',
            requests: [buildRequest(newFormatRequestName, 'GET', '/health')],
            folders: [],
          },
        ],
      },
    ])

    const collectionId = await getRootFolderIdByName(window, newFormatCollectionName)
    if (!collectionId) throw new Error(`Imported collection not found: ${newFormatCollectionName}`)
    importedCollectionIds.push(collectionId)
  })

  test('shows the imported collection in the sidebar', async ({ window }) => {
    await expect(window.locator('[data-testid="sidebar"]').getByText(newFormatCollectionName, { exact: true })).toBeVisible()
  })

  test('shows the sub-folder in the sidebar after expanding', async ({ window }) => {
    await expandTreeItem(window, newFormatCollectionName, endpointsFolderName)
    await expect(window.locator('[data-testid="sidebar"]').getByText(endpointsFolderName, { exact: true })).toBeVisible()
  })

  test('shows the request inside the sub-folder', async ({ window }) => {
    await expandTreeItem(window, newFormatCollectionName, endpointsFolderName)
    await expandTreeItem(window, endpointsFolderName, newFormatRequestName)
    await expect(window.locator('[data-testid="sidebar"]').getByText(newFormatRequestName, { exact: true })).toBeVisible()
  })
})

test.describe('Import — new format with root-level requests', () => {
  test.beforeAll(async ({ window }) => {
    await importCollectionsAndReload(window, [
      {
        name: rootLevelCollectionName,
        description: '',
        source: 'local',
        auth: { type: 'none', config: {} },
        ssl: 'inherit',
        requests: [buildRequest(rootLevelRequestName, 'GET', '/ping')],
        folders: [],
      },
    ])

    const collectionId = await getRootFolderIdByName(window, rootLevelCollectionName)
    if (!collectionId) throw new Error(`Imported collection not found: ${rootLevelCollectionName}`)
    importedCollectionIds.push(collectionId)
  })

  test('shows the collection', async ({ window }) => {
    await expect(window.locator('[data-testid="sidebar"]').getByText(rootLevelCollectionName, { exact: true })).toBeVisible()
  })

  test('shows the root-level request directly under the collection', async ({ window }) => {
    await expandTreeItem(window, rootLevelCollectionName, rootLevelRequestName)
    await expect(window.locator('[data-testid="sidebar"]').getByText(rootLevelRequestName, { exact: true })).toBeVisible()
  })
})

test.describe('Import — old format (groups)', () => {
  test.beforeAll(async ({ window }) => {
    await importCollectionsAndReload(window, [
      {
        name: legacyCollectionName,
        description: '',
        source: 'local',
        auth: { type: 'none', config: {} },
        ssl: 'inherit',
        requests: [],
        groups: [
          {
            name: legacyGroupName,
            description: '',
            auth: { type: 'none', config: {} },
            ssl: 'inherit',
            requests: [buildRequest(legacyRequestName, 'GET', '/users')],
            folders: [],
          },
        ],
      },
    ])

    const collectionId = await getRootFolderIdByName(window, legacyCollectionName)
    if (!collectionId) throw new Error(`Imported collection not found: ${legacyCollectionName}`)
    importedCollectionIds.push(collectionId)
  })

  test('shows the legacy collection in the sidebar', async ({ window }) => {
    await expect(window.locator('[data-testid="sidebar"]').getByText(legacyCollectionName, { exact: true })).toBeVisible()
  })

  test('shows the group as a folder after expanding', async ({ window }) => {
    await expandTreeItem(window, legacyCollectionName, legacyGroupName)
    await expect(window.locator('[data-testid="sidebar"]').getByText(legacyGroupName, { exact: true })).toBeVisible()
  })

  test('shows the request inside the group', async ({ window }) => {
    await expandTreeItem(window, legacyCollectionName, legacyGroupName)
    await expandTreeItem(window, legacyGroupName, legacyRequestName)
    await expect(window.locator('[data-testid="sidebar"]').getByText(legacyRequestName, { exact: true })).toBeVisible()
  })
})
