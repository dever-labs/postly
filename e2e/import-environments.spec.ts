import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'

type PersistedEnvironment = {
  name: string
  isActive: boolean
  vars: Array<{ key: string; value: string; isSecret: boolean }>
}

type PersistedCollectionVariable = { value: string; isSecret: boolean }

const stamp = Date.now()
const fixtures = path.join(__dirname, '..', 'src', 'main', 'services', '__tests__', 'fixtures')
const generated = path.join(__dirname, '.generated-import-environments')

const names = {
  insomniaV5Collection: `Insomnia V5 ${stamp}`,
  insomniaV5BaseEnv: `Insomnia V5 Base ${stamp}`,
  insomniaV5DevEnv: `Insomnia V5 Dev ${stamp}`,
  insomniaV5SecretEnv: `Insomnia V5 Secret ${stamp}`,
  insomniaV4Collection: `Insomnia V4 ${stamp}`,
  insomniaV4BaseEnv: `Insomnia V4 Base ${stamp}`,
  insomniaV4DevEnv: `Insomnia V4 Dev ${stamp}`,
  insomniaV4ProdEnv: `Insomnia V4 Prod ${stamp}`,
  brunoBruCollection: `Bruno BRU ${stamp}`,
  brunoBruEnv: `BruDev${stamp}`,
  brunoJsonCollection: `Bruno JSON ${stamp}`,
  brunoJsonEnv: `Bruno JSON Env ${stamp}`,
  brunoYamlCollection: `Bruno YAML ${stamp}`,
  brunoYamlEnv: `BruYamlDev${stamp}`,
  openApiCollection: `OpenAPI Env ${stamp}`,
  openApiPrimaryEnv: `api-${stamp}.example.com`,
  openApiSecondaryEnv: `staging-${stamp}.example.com`,
  postmanV3Collection: `Postman v3 Env ${stamp}`,
  postmanV3Env: `Postman Stage ${stamp}`,
  postmanStandaloneEnv: `Postman Standalone ${stamp}`,
  insomniaStandaloneEnv: `Insomnia Standalone ${stamp}`,
  dedupeEnv: `Duplicate Env ${stamp}`,
  secretEnv: `Secret Env ${stamp}`,
  secretCollection: `Secret Collection ${stamp}`,
  secretRequest: `Send Secret ${stamp}`,
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function copyDir(source: string, destination: string): void {
  ensureDir(destination)
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const nextSource = path.join(source, entry.name)
    const nextDestination = path.join(destination, entry.name)
    if (entry.isDirectory()) copyDir(nextSource, nextDestination)
    else fs.copyFileSync(nextSource, nextDestination)
  }
}

function replaceOnce(filePath: string, searchValue: string, replacement: string): void {
  const current = fs.readFileSync(filePath, 'utf-8')
  if (!current.includes(searchValue)) throw new Error(`Could not find "${searchValue}" in ${filePath}`)
  fs.writeFileSync(filePath, current.replace(searchValue, replacement))
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function prepareFixtures() {
  fs.rmSync(generated, { recursive: true, force: true })
  ensureDir(generated)

  const insomniaV5File = path.join(generated, 'insomnia-v5-environments.yaml')
  fs.writeFileSync(insomniaV5File, `type: collection.insomnia.rest/5.0
schema_version: "5.1"
name: ${names.insomniaV5Collection}
meta:
  id: wrk_v5_${stamp}
collection:
  - url: "{{ _.base_url }}/users"
    name: Ping
    meta:
      id: req_v5_${stamp}
    method: GET
environments:
  name: ${names.insomniaV5BaseEnv}
  meta:
    id: env_base_v5_${stamp}
    isPrivate: false
  data:
    base_url: https://api-${stamp}.example.com
    token: base-token-${stamp}
  subEnvironments:
    - name: ${names.insomniaV5DevEnv}
      meta:
        id: env_dev_v5_${stamp}
        sortKey: 20
        isPrivate: false
      data:
        nested:
          url: "{{ _.base_url }}/v2"
        tags:
          - a
          - b
    - name: ${names.insomniaV5SecretEnv}
      meta:
        id: env_secret_v5_${stamp}
        sortKey: 10
        isPrivate: true
      data:
        token: "{{ _.token }}"
        region: us
`)

  const insomniaV4File = path.join(generated, 'insomnia-v4-environments.json')
  writeJson(insomniaV4File, {
    _type: 'export',
    __export_format: 4,
    resources: [
      { _id: 'wrk_v4_1', _type: 'workspace', parentId: null, name: names.insomniaV4Collection, description: '' },
      { _id: 'env_base_v4_1', _type: 'environment', parentId: 'wrk_v4_1', name: names.insomniaV4BaseEnv, data: { host: `api-${stamp}.example.com`, base_url: 'https://{{ _.host }}' } },
      { _id: 'env_dev_v4_1', _type: 'environment', parentId: 'env_base_v4_1', name: names.insomniaV4DevEnv, metaSortKey: 20, data: { api: { url: '{{ _.base_url }}/v1' } } },
      { _id: 'env_prod_v4_1', _type: 'environment', parentId: 'env_base_v4_1', name: names.insomniaV4ProdEnv, metaSortKey: 10, isPrivate: true, data: { token: `shh-${stamp}`, nested: { enabled: true } } },
      { _id: 'req_v4_1', _type: 'request', parentId: 'wrk_v4_1', name: 'Ping', method: 'GET', url: '{{ _.base_url }}/ping' },
    ],
  })

  const brunoFolder = path.join(generated, 'bruno-env-folder')
  ensureDir(path.join(brunoFolder, 'environments'))
  writeJson(path.join(brunoFolder, 'bruno.json'), { name: names.brunoBruCollection, version: '1', type: 'collection' })
  fs.copyFileSync(path.join(fixtures, 'bruno', 'env-import', 'request.bru'), path.join(brunoFolder, 'request.bru'))
  fs.copyFileSync(path.join(fixtures, 'bruno', 'env-import', 'environments', 'Dev.bru'), path.join(brunoFolder, 'environments', `${names.brunoBruEnv}.bru`))

  const brunoJsonFile = path.join(generated, 'bruno-export.json')
  writeJson(brunoJsonFile, {
    name: names.brunoJsonCollection,
    version: '1',
    items: [{
      type: 'http',
      name: 'Ping',
      seq: 1,
      request: {
        url: 'https://example.com/ping',
        method: 'GET',
      },
    }],
    environments: [{
      name: names.brunoJsonEnv,
      variables: [
        { name: 'token', value: `secret-${stamp}`, enabled: true, secret: true },
        { name: 'region', value: 'us-east-1', enabled: true },
        { name: 'disabled', value: 'skip', enabled: false },
      ],
    }],
    brunoConfig: {},
  })

  const brunoYamlFolder = path.join(generated, 'bruno-yaml-env-folder')
  ensureDir(path.join(brunoYamlFolder, 'environments'))
  fs.copyFileSync(path.join(fixtures, 'bruno-yaml', 'env-import', 'opencollection.yml'), path.join(brunoYamlFolder, 'opencollection.yml'))
  replaceOnce(path.join(brunoYamlFolder, 'opencollection.yml'), 'name: YAML Environment Import', `name: ${names.brunoYamlCollection}`)
  fs.copyFileSync(path.join(fixtures, 'bruno-yaml', 'env-import', 'request.yml'), path.join(brunoYamlFolder, 'request.yml'))
  fs.copyFileSync(path.join(fixtures, 'bruno-yaml', 'env-import', 'environments', 'dev.yml'), path.join(brunoYamlFolder, 'environments', 'dev.yml'))
  replaceOnce(path.join(brunoYamlFolder, 'environments', 'dev.yml'), 'name: Development', `name: ${names.brunoYamlEnv}`)

  const openApiFile = path.join(generated, 'openapi-env.yaml')
  fs.writeFileSync(openApiFile, `openapi: 3.0.3
info:
  title: ${names.openApiCollection}
  version: '1'
servers:
  - url: https://{env}.example.com/v1
    variables:
      env:
        default: api-${stamp}
  - url: https://staging-${stamp}.example.com/v1
paths:
  /widgets:
    get:
      tags: [widgets]
      summary: List widgets
`)

  const postmanV3Folder = path.join(generated, 'postman-v3-workspace')
  copyDir(path.join(fixtures, 'postman-v3', 'workspace'), postmanV3Folder)
  replaceOnce(
    path.join(postmanV3Folder, 'postman', 'collections', 'Native', '.resources', 'definition.yaml'),
    'name: Native Git Sample',
    `name: ${names.postmanV3Collection}`,
  )
  replaceOnce(
    path.join(postmanV3Folder, 'postman', 'environments', 'Stage.yaml'),
    'name: Stage',
    `name: ${names.postmanV3Env}`,
  )

  const postmanStandaloneFile = path.join(generated, 'postman-standalone-environment.json')
  writeJson(postmanStandaloneFile, {
    _postman_variable_scope: 'environment',
    name: names.postmanStandaloneEnv,
    values: [
      { key: 'baseUrl', value: `https://standalone-${stamp}.example.com`, enabled: true },
      { key: 'apiKey', value: `secret-${stamp}`, type: 'secret', enabled: true },
      { key: 'disabled', value: 'skip', enabled: false },
    ],
  })

  const insomniaStandaloneFile = path.join(generated, 'insomnia-standalone-environment.yaml')
  fs.writeFileSync(insomniaStandaloneFile, `type: environment.insomnia.rest/5.0
schema_version: "5.1"
name: ${names.insomniaStandaloneEnv} File
meta:
  id: wrk_env_${stamp}
environments:
  name: ${names.insomniaStandaloneEnv}
  meta:
    id: env_standalone_${stamp}
    isPrivate: false
  data:
    base_url: http://localhost:${1000 + (stamp % 50000)}
    auth_token: token-${stamp}
`)

  const dedupeFile = path.join(generated, 'duplicate-environment.json')
  writeJson(dedupeFile, {
    _postman_variable_scope: 'environment',
    name: names.dedupeEnv,
    values: [
      { key: 'baseUrl', value: `https://duplicate-${stamp}.example.com`, enabled: true },
    ],
  })

  const secretFile = path.join(generated, 'secret-environment.json')
  writeJson(secretFile, {
    _postman_variable_scope: 'environment',
    name: names.secretEnv,
    values: [
      { key: 'secretVar', value: `filled-${stamp}`, type: 'secret', enabled: true },
    ],
  })

  return {
    insomniaV5File,
    insomniaV4File,
    brunoFolder,
    brunoJsonFile,
    brunoYamlFolder,
    openApiFile,
    postmanV3Folder,
    postmanStandaloneFile,
    insomniaStandaloneFile,
    dedupeFile,
    secretFile,
  }
}

const prepared = prepareFixtures()

const collectionNames = [
  names.insomniaV5Collection,
  names.insomniaV4Collection,
  names.brunoBruCollection,
  names.brunoJsonCollection,
  names.brunoYamlCollection,
  names.openApiCollection,
  names.postmanV3Collection,
  names.secretCollection,
]

const environmentNames = [
  names.insomniaV5BaseEnv,
  names.insomniaV5DevEnv,
  names.insomniaV5SecretEnv,
  names.insomniaV4BaseEnv,
  names.insomniaV4DevEnv,
  names.insomniaV4ProdEnv,
  names.brunoBruEnv,
  names.brunoJsonEnv,
  names.brunoYamlEnv,
  names.openApiPrimaryEnv,
  names.openApiSecondaryEnv,
  names.postmanV3Env,
  names.postmanStandaloneEnv,
  names.insomniaStandaloneEnv,
  names.dedupeEnv,
  `${names.dedupeEnv} (2)`,
  names.secretEnv,
]

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function reloadApp(window: Page): Promise<void> {
  await window.reload()
  await window.waitForSelector('[data-testid="app-root"]', { timeout: 20_000 })
}

async function openImport(window: Page): Promise<void> {
  await window.getByTestId('btn-import').click()
}

async function importFile(window: Page, filePath: string): Promise<void> {
  await openImport(window)
  await window.locator('input[type="file"]:not([data-testid="import-folder-input"])').setInputFiles(filePath)
}

async function importFolder(window: Page, folderPath: string): Promise<void> {
  await openImport(window)
  await window.getByTestId('import-folder-input').setInputFiles(folderPath)
}

async function finishCollectionImport(window: Page, rootName: string): Promise<void> {
  await window.getByRole('button', { name: /^Import \d/ }).click()
  await expect(window.getByRole('treeitem', { name: new RegExp(`^${escapeRegex(rootName)}`) })).toBeVisible()
}

async function finishEnvironmentOnlyImport(window: Page, envNames: string[]): Promise<PersistedEnvironment[]> {
  await window.getByRole('button', { name: /^Import \d+ environment/ }).click()
  await expect.poll(async () => (await readEnvironments(window, envNames)).length, { timeout: 10_000 }).toBe(envNames.length)
  return readEnvironments(window, envNames)
}

async function rootCollectionNames(window: Page): Promise<string[]> {
  return window.evaluate(async () => {
    const result = await window.api.folders.list() as { data?: Array<{ name: string; parentId?: string | null; parent_id?: string | null }> }
    return (result.data ?? [])
      .filter((folder) => !(folder.parentId ?? folder.parent_id))
      .map((folder) => folder.name)
      .sort()
  })
}

async function readEnvironments(window: Page, targetNames: string[]): Promise<PersistedEnvironment[]> {
  return window.evaluate(async (wantedNames: string[]) => {
    type RawEnvironment = { id: string; name: string; isActive?: boolean; is_active?: number }
    type RawVar = { key: string; value: string; isSecret?: boolean; is_secret?: number }

    const wanted = new Set(wantedNames)
    const result = await window.api.environments.list() as { data?: { environments?: RawEnvironment[] } }
    const environments = (result.data?.environments ?? [])
      .filter((environment) => wanted.has(environment.name))
      .sort((a, b) => a.name.localeCompare(b.name))

    const loaded = await Promise.all(environments.map(async (environment) => {
      const varsResult = await window.api.environments.vars.list({ envId: environment.id }) as { data?: RawVar[] }
      const vars = (varsResult.data ?? [])
        .map((variable) => ({
          key: variable.key,
          value: variable.value,
          isSecret: Boolean(variable.isSecret ?? variable.is_secret ?? false),
        }))
        .sort((a, b) => a.key.localeCompare(b.key) || a.value.localeCompare(b.value))
      return {
        name: environment.name,
        isActive: Boolean(environment.isActive ?? environment.is_active ?? false),
        vars,
      }
    }))

    return loaded
  }, targetNames)
}

async function readCollectionVariables(window: Page, rootName: string): Promise<Record<string, PersistedCollectionVariable> | null> {
  return window.evaluate(async (name: string) => {
    type RawFolder = { id: string; name: string; parentId?: string | null; parent_id?: string | null }
    type RawVariable = { key: string; value: string; isSecret?: boolean; is_secret?: number }

    const folders = ((await window.api.folders.list()) as { data?: RawFolder[] }).data ?? []
    const root = folders.find((folder) => !(folder.parentId ?? folder.parent_id) && folder.name === name)
    if (!root) return null

    const variableResult = await window.api.variables.list() as { data?: { collections?: Record<string, RawVariable[]> } }
    const variables = variableResult.data?.collections?.[root.id] ?? []
    return Object.fromEntries(
      variables
        .map((variable) => [variable.key, { value: variable.value, isSecret: Boolean(variable.isSecret ?? variable.is_secret ?? false) }])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    )
  }, rootName)
}

test.beforeEach(async ({ window }) => {
  await reloadApp(window)
})

test.afterEach(async ({ window }) => {
  await window.evaluate(() => window.api.proxy.set({ mode: 'system', url: '', username: '', password: '', bypass: '' }))
})

test.afterAll(async ({ window }) => {
  await window.evaluate(async ([rootNames, envNames]: [string[], string[]]) => {
    const folders = ((await window.api.folders.list()) as {
      data?: Array<{ id: string; name: string; parentId?: string | null; parent_id?: string | null }>
    }).data ?? []

    for (const folder of folders) {
      if (!(folder.parentId ?? folder.parent_id) && rootNames.includes(folder.name)) {
        await window.api.folders.delete({ id: folder.id })
      }
    }

    const environments = ((await window.api.environments.list()) as {
      data?: { environments?: Array<{ id: string; name: string }> }
    }).data?.environments ?? []

    for (const environment of environments) {
      if (envNames.includes(environment.name)) {
        await window.api.environments.delete({ id: environment.id })
      }
    }
  }, [collectionNames, environmentNames] as [string[], string[]])

  fs.rmSync(generated, { recursive: true, force: true })
})

test.describe('Import environments', () => {
  test('imports Insomnia v5 base and sub environments from the real Import page', async ({ window }) => {
    await importFile(window, prepared.insomniaV5File)

    await expect(window.getByTestId('import-format')).toContainText('Insomnia export')

    await finishCollectionImport(window, names.insomniaV5Collection)

    expect(await readEnvironments(window, [names.insomniaV5BaseEnv, names.insomniaV5DevEnv, names.insomniaV5SecretEnv])).toEqual([
      {
        name: names.insomniaV5BaseEnv,
        isActive: false,
        vars: [
          { key: 'base_url', value: `https://api-${stamp}.example.com`, isSecret: false },
          { key: 'token', value: `base-token-${stamp}`, isSecret: false },
        ],
      },
      {
        name: names.insomniaV5DevEnv,
        isActive: false,
        vars: [
          { key: 'base_url', value: `https://api-${stamp}.example.com`, isSecret: false },
          { key: 'nested.url', value: '{{base_url}}/v2', isSecret: false },
          { key: 'tags', value: '["a","b"]', isSecret: false },
          { key: 'token', value: `base-token-${stamp}`, isSecret: false },
        ],
      },
      {
        name: names.insomniaV5SecretEnv,
        isActive: false,
        vars: [
          { key: 'base_url', value: `https://api-${stamp}.example.com`, isSecret: false },
          { key: 'region', value: 'us', isSecret: true },
          { key: 'token', value: '{{token}}', isSecret: true },
        ],
      },
    ])

    expect(await readCollectionVariables(window, names.insomniaV5Collection)).toMatchObject({
      base_url: { value: `https://api-${stamp}.example.com`, isSecret: false },
      token: { value: `base-token-${stamp}`, isSecret: false },
    })
  })

  test('imports Insomnia v4 sub-environments and keeps base variables on the collection', async ({ window }) => {
    await importFile(window, prepared.insomniaV4File)

    await expect(window.getByTestId('import-format')).toContainText('Insomnia export')

    await finishCollectionImport(window, names.insomniaV4Collection)

    expect(await readEnvironments(window, [names.insomniaV4BaseEnv, names.insomniaV4DevEnv, names.insomniaV4ProdEnv])).toEqual([
      {
        name: names.insomniaV4BaseEnv,
        isActive: false,
        vars: [
          { key: 'base_url', value: 'https://{{host}}', isSecret: false },
          { key: 'host', value: `api-${stamp}.example.com`, isSecret: false },
        ],
      },
      {
        name: names.insomniaV4DevEnv,
        isActive: false,
        vars: [
          { key: 'api.url', value: '{{base_url}}/v1', isSecret: false },
          { key: 'base_url', value: 'https://{{host}}', isSecret: false },
          { key: 'host', value: `api-${stamp}.example.com`, isSecret: false },
        ],
      },
      {
        name: names.insomniaV4ProdEnv,
        isActive: false,
        vars: [
          { key: 'base_url', value: 'https://{{host}}', isSecret: false },
          { key: 'host', value: `api-${stamp}.example.com`, isSecret: false },
          { key: 'nested.enabled', value: 'true', isSecret: true },
          { key: 'token', value: `shh-${stamp}`, isSecret: true },
        ],
      },
    ])

    expect(await readCollectionVariables(window, names.insomniaV4Collection)).toMatchObject({
      base_url: { value: 'https://{{host}}', isSecret: false },
      host: { value: `api-${stamp}.example.com`, isSecret: false },
    })
  })

  test('imports Bruno .bru environments with secret and disabled variables', async ({ window }) => {
    await importFolder(window, prepared.brunoFolder)

    await expect(window.getByTestId('import-format')).toContainText('Bruno')

    await finishCollectionImport(window, names.brunoBruCollection)

    expect(await readEnvironments(window, [names.brunoBruEnv])).toEqual([
      {
        name: names.brunoBruEnv,
        isActive: false,
        vars: [
          { key: 'apiKey', value: '', isSecret: true },
          { key: 'fromProcess', value: '', isSecret: false },
          { key: 'host', value: 'https://dev.example.com', isSecret: false },
        ],
      },
    ])
  })

  test('imports Bruno JSON export environments', async ({ window }) => {
    await importFile(window, prepared.brunoJsonFile)

    await expect(window.getByTestId('import-format')).toContainText('Bruno')

    await finishCollectionImport(window, names.brunoJsonCollection)

    expect(await readEnvironments(window, [names.brunoJsonEnv])).toEqual([
      {
        name: names.brunoJsonEnv,
        isActive: false,
        vars: [
          { key: 'region', value: 'us-east-1', isSecret: false },
          { key: 'token', value: '', isSecret: true },
        ],
      },
    ])
  })

  test('imports Bruno YAML folder environments', async ({ window }) => {
    await importFolder(window, prepared.brunoYamlFolder)

    await expect(window.getByTestId('import-format')).toContainText('Bruno')

    await finishCollectionImport(window, names.brunoYamlCollection)

    expect(await readEnvironments(window, [names.brunoYamlEnv])).toEqual([
      {
        name: names.brunoYamlEnv,
        isActive: false,
        vars: [
          { key: 'apiKey', value: '', isSecret: true },
          { key: 'fromProcess', value: '', isSecret: false },
          { key: 'host', value: 'https://dev.example.com', isSecret: false },
        ],
      },
    ])
  })

  test('imports OpenAPI servers as environments and preserves the collection baseUrl variable', async ({ window }) => {
    await importFile(window, prepared.openApiFile)

    await expect(window.getByTestId('import-format')).toContainText('OpenAPI')

    await finishCollectionImport(window, names.openApiCollection)

    expect(await readEnvironments(window, [names.openApiPrimaryEnv, names.openApiSecondaryEnv])).toEqual([
      {
        name: names.openApiPrimaryEnv,
        isActive: false,
        vars: [
          { key: 'baseUrl', value: 'https://{{env}}.example.com/v1', isSecret: false },
          { key: 'env', value: `api-${stamp}`, isSecret: false },
        ],
      },
      {
        name: names.openApiSecondaryEnv,
        isActive: false,
        vars: [
          { key: 'baseUrl', value: `https://staging-${stamp}.example.com/v1`, isSecret: false },
        ],
      },
    ])

    expect(await readCollectionVariables(window, names.openApiCollection)).toMatchObject({
      baseUrl: { value: `https://api-${stamp}.example.com/v1`, isSecret: false },
    })
  })

  test('imports Postman v3 workspace environments from a folder', async ({ window }) => {
    await importFolder(window, prepared.postmanV3Folder)

    await expect(window.getByTestId('import-format')).toContainText('Postman')

    await finishCollectionImport(window, names.postmanV3Collection)

    expect(await readEnvironments(window, [names.postmanV3Env])).toEqual([
      {
        name: names.postmanV3Env,
        isActive: false,
        vars: [
          { key: 'apiToken', value: '', isSecret: true },
          { key: 'baseUrl', value: 'https://stage.example.com', isSecret: false },
        ],
      },
    ])
  })

  test('imports a standalone Postman environment file through the environment-only flow', async ({ window }) => {
    const beforeCollections = await rootCollectionNames(window)

    await importFile(window, prepared.postmanStandaloneFile)

    await expect(window.getByTestId('import-format')).toContainText('Postman environment')
    await expect(window.getByRole('button', { name: /Import 1 environment/ })).toBeVisible()

    expect(await finishEnvironmentOnlyImport(window, [names.postmanStandaloneEnv])).toEqual([
      {
        name: names.postmanStandaloneEnv,
        isActive: false,
        vars: [
          { key: 'apiKey', value: '', isSecret: true },
          { key: 'baseUrl', value: `https://standalone-${stamp}.example.com`, isSecret: false },
        ],
      },
    ])

    expect(await rootCollectionNames(window)).toEqual(beforeCollections)
  })

  test('imports a standalone Insomnia environment file through the environment-only flow', async ({ window }) => {
    const beforeCollections = await rootCollectionNames(window)

    await importFile(window, prepared.insomniaStandaloneFile)

    await expect(window.getByTestId('import-format')).toContainText('Insomnia environment')
    await expect(window.getByRole('button', { name: /Import 1 environment/ })).toBeVisible()

    expect(await finishEnvironmentOnlyImport(window, [names.insomniaStandaloneEnv])).toEqual([
      {
        name: names.insomniaStandaloneEnv,
        isActive: false,
        vars: [
          { key: 'auth_token', value: `token-${stamp}`, isSecret: false },
          { key: 'base_url', value: `http://localhost:${1000 + (stamp % 50000)}`, isSecret: false },
        ],
      },
    ])

    expect(await rootCollectionNames(window)).toEqual(beforeCollections)
  })

  test('de-duplicates imported environment names', async ({ window }) => {
    await importFile(window, prepared.dedupeFile)
    await finishEnvironmentOnlyImport(window, [names.dedupeEnv])

    await reloadApp(window)
    await importFile(window, prepared.dedupeFile)
    await finishEnvironmentOnlyImport(window, [names.dedupeEnv, `${names.dedupeEnv} (2)`])

    expect(await readEnvironments(window, [names.dedupeEnv, `${names.dedupeEnv} (2)`])).toEqual([
      {
        name: names.dedupeEnv,
        isActive: false,
        vars: [{ key: 'baseUrl', value: `https://duplicate-${stamp}.example.com`, isSecret: false }],
      },
      {
        name: `${names.dedupeEnv} (2)`,
        isActive: false,
        vars: [{ key: 'baseUrl', value: `https://duplicate-${stamp}.example.com`, isSecret: false }],
      },
    ])
  })

  test('imports blank secret variables, keeps them masked, and resolves them when sending a request', async ({ window }) => {
    const seen: Array<{ url: string; secret: string }> = []
    const server = http.createServer((req, res) => {
      seen.push({ url: req.url ?? '', secret: String(req.headers['x-secret'] ?? '') })
      res.end('ok')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const filledSecret = `resolved-${stamp}`

    try {
      await importFile(window, prepared.secretFile)

      await expect(window.getByTestId('import-format')).toContainText('Postman environment')
      await expect(window.getByText(/secret variable was imported without a value/i)).toBeVisible()
      await finishEnvironmentOnlyImport(window, [names.secretEnv])

      expect(await readEnvironments(window, [names.secretEnv])).toEqual([
        {
          name: names.secretEnv,
          isActive: false,
          vars: [{ key: 'secretVar', value: '', isSecret: true }],
        },
      ])

      await reloadApp(window)
      await window.getByTestId('tab-environments').click()
      await window.getByText(names.secretEnv, { exact: true }).first().click()

      const valueInput = window.locator('input[placeholder="value"]').first()
      await expect(valueInput).toHaveAttribute('type', 'password')
      await expect(valueInput).toHaveValue('')
      await valueInput.fill(filledSecret)
      await window.getByRole('button', { name: /^Save$/ }).click()
      await expect(window.getByRole('button', { name: 'Saved' })).toBeVisible()
      await window.evaluate(async (name: string) => {
        const environments = ((await window.api.environments.list()) as {
          data?: { environments?: Array<{ id: string; name: string }> }
        }).data?.environments ?? []
        const target = environments.find((environment) => environment.name === name)
        if (!target) throw new Error(`Missing environment ${name}`)
        await window.api.environments.setActive({ id: target.id })
      }, names.secretEnv)

      expect(await readEnvironments(window, [names.secretEnv])).toEqual([
        {
          name: names.secretEnv,
          isActive: true,
          vars: [{ key: 'secretVar', value: filledSecret, isSecret: true }],
        },
      ])

      await window.evaluate(async ([collectionName, requestName, url]: [string, string, string]) => {
        await window.api.proxy.set({ mode: 'none', url: '', username: '', password: '', bypass: '' })
        const collection = await window.api.collections.create({ name: collectionName }) as { data: { id: string } }
        const request = await window.api.requests.create({ folderId: collection.data.id, name: requestName, method: 'GET' }) as { data: { id: string } }
        await window.api.requests.update({
          id: request.data.id,
          url,
          headers: JSON.stringify([{ id: crypto.randomUUID(), key: 'X-Secret', value: '{{secretVar}}', enabled: true }]),
        })
      }, [names.secretCollection, names.secretRequest, `${base}/secret/{{secretVar}}?via={{secretVar}}`] as [string, string, string])

      await reloadApp(window)
      await window.getByText(names.secretCollection).first().click()
      await window.getByText(names.secretRequest, { exact: true }).first().click()
      await window.getByTestId('url-input').waitFor({ state: 'visible' })
      await window.getByTestId('send-button').click()
      await expect(window.getByTestId('response-status')).toContainText('200', { timeout: 10_000 })

      expect(seen.at(-1)).toEqual({
        url: `/secret/${filledSecret}?via=${filledSecret}`,
        secret: filledSecret,
      })
    } finally {
      server.closeAllConnections()
      server.close()
    }
  })
})
