import fs from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'

type PersistedVariable = { key: string; value: string; isSecret: boolean }
type PersistedPair = { key: string; value: string; enabled: boolean; fieldType?: string }
type PersistedRequest = {
  name: string
  method: string
  url: string
  bodyType: string
  headers: PersistedPair[]
  params: PersistedPair[]
  authType: string
  authConfig: Record<string, string>
}
type PersistedFolder = {
  id: string
  name: string
  authType: string
  authConfig: Record<string, string>
  variables: PersistedVariable[]
  requests: PersistedRequest[]
  folders: PersistedFolder[]
}

const stamp = Date.now()
const postmanName = `Postman ${stamp}`
const insomniaName = `Insomnia ${stamp}`
const brunoName = `Bruno ${stamp}`
const brunoYamlName = `Bruno YAML ${stamp}`
const postmanV3Name = `Postman v3 ${stamp}`

const fixtures = path.join(__dirname, '..', 'src', 'main', 'services', '__tests__', 'fixtures')
const generated = path.join(__dirname, `.generated-import-sources-${stamp}`)

const POSTMAN = {
  info: { name: postmanName, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  variable: [{ key: 'host', value: 'https://api.example.test' }],
  item: [{
    name: 'Users',
    item: [{
      name: 'Create user',
      request: {
        method: 'POST',
        url: {
          raw: '{{host}}/users?active=true',
          query: [{ key: 'active', value: 'true' }],
        },
        header: [{ key: 'Content-Type', value: 'application/json' }],
        body: { mode: 'raw', raw: '{"a":1}', options: { raw: { language: 'json' } } },
        auth: { type: 'bearer', bearer: [{ key: 'token', value: 'abc' }] },
      },
      event: [
        { listen: 'test', script: { exec: ['pm.environment.set("id", pm.response.json().id);'] } },
        { listen: 'prerequest', script: { exec: ['console.log(1)'] } },
      ],
    }],
  }],
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

function prepareFixtures(): {
  insomniaFile: string
  brunoFolder: string
  brunoYamlFolder: string
  postmanV3Folder: string
  emptyFolder: string
  yamlOnlyFolder: string
} {
  fs.rmSync(generated, { recursive: true, force: true })
  ensureDir(generated)

  const insomniaFile = path.join(generated, 'insomnia-v5.yaml')
  fs.copyFileSync(
    path.join(fixtures, 'real-insomnia-v5-variables.yaml'),
    insomniaFile,
  )
  replaceOnce(insomniaFile, 'name: Variable Inheritance', `name: ${insomniaName}`)

  const brunoFolder = path.join(generated, 'bruno-collection')
  ensureDir(path.join(brunoFolder, 'users'))
  fs.writeFileSync(
    path.join(brunoFolder, 'bruno.json'),
    JSON.stringify({ version: '1', name: brunoName, type: 'collection' }, null, 2),
  )
  fs.writeFileSync(
    path.join(brunoFolder, 'collection.bru'),
    `auth {
  mode: basic
}

auth:basic {
  username: root-user
  password: root-pass
}

vars:pre-request {
  base_url: https://api.example.test
  auth_token: token-${stamp}
}
`,
  )
  fs.writeFileSync(
    path.join(brunoFolder, 'health.bru'),
    `meta {
  name: Health Check
  type: http
  seq: 1
}

get {
  url: {{base_url}}/health
  body: none
  auth: inherit
}

headers {
  Accept: application/json
}
`,
  )
  fs.writeFileSync(
    path.join(brunoFolder, 'users', 'folder.bru'),
    `meta {
  name: Users
  seq: 1
}
`,
  )
  fs.writeFileSync(
    path.join(brunoFolder, 'users', 'create-user.bru'),
    `meta {
  name: Create User
  type: http
  seq: 1
}

post {
  url: {{base_url}}/users
  body: json
  auth: bearer
}

headers {
  Content-Type: application/json
  X-Request: ${stamp}
}

auth:bearer {
  token: {{auth_token}}
}

body:json {
  {
    "name": "Ada"
  }
}
`,
  )

  const brunoYamlFolder = path.join(generated, 'bruno-yaml')
  copyDir(path.join(fixtures, 'bruno-yaml', 'spec-complex'), brunoYamlFolder)
  replaceOnce(
    path.join(brunoYamlFolder, 'opencollection.yml'),
    '  name: Spec Complex',
    `  name: ${brunoYamlName}`,
  )

  const postmanV3Folder = path.join(generated, 'postman-v3-workspace')
  copyDir(path.join(fixtures, 'postman-v3', 'workspace'), postmanV3Folder)
  replaceOnce(
    path.join(postmanV3Folder, 'postman', 'collections', 'Native', '.resources', 'definition.yaml'),
    'name: Native Git Sample',
    `name: ${postmanV3Name}`,
  )

  const emptyFolder = path.join(generated, 'empty-folder')
  ensureDir(emptyFolder)
  fs.writeFileSync(path.join(emptyFolder, 'readme.txt'), `nothing to import ${stamp}\n`)

  const yamlOnlyFolder = path.join(generated, 'yaml-only-folder')
  ensureDir(yamlOnlyFolder)
  fs.writeFileSync(
    path.join(yamlOnlyFolder, 'docker-compose.yml'),
    `services:
  api:
    image: postly-test:${stamp}
`,
  )

  return { insomniaFile, brunoFolder, brunoYamlFolder, postmanV3Folder, emptyFolder, yamlOnlyFolder }
}

const prepared = prepareFixtures()

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

async function importFolderFromOpenDialog(window: Page, folderPath: string): Promise<void> {
  await window.getByTestId('import-folder-input').setInputFiles(folderPath)
}

async function finishImport(window: Page, rootName: string): Promise<void> {
  await window.getByRole('button', { name: /Import 1 collection/ }).click()
  await expect(window.getByRole('treeitem', { name: new RegExp(`^${escapeRegex(rootName)}`) })).toBeVisible()
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

async function readImportedCollection(window: Page, rootName: string): Promise<PersistedFolder | null> {
  return window.evaluate(async (name) => {
    type RawFolder = Record<string, unknown> & { id: string; name: string }
    type RawRequest = Record<string, unknown> & { id: string; name: string }
    type RawVariable = { key: string; value: string; isSecret?: boolean; is_secret?: number }

    const parseArray = (value: unknown): Array<Record<string, unknown>> => {
      if (Array.isArray(value)) return value as Array<Record<string, unknown>>
      if (typeof value !== 'string' || !value.trim()) return []
      try {
        const parsed = JSON.parse(value)
        return Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : []
      } catch {
        return []
      }
    }

    const parseObject = (value: unknown): Record<string, string> => {
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, string>
      if (typeof value !== 'string' || !value.trim()) return {}
      try {
        const parsed = JSON.parse(value)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, string> : {}
      } catch {
        return {}
      }
    }

    const normalizePair = (row: Record<string, unknown>) => ({
      key: String(row.key ?? row.name ?? ''),
      value: String(row.value ?? ''),
      enabled: row.enabled !== false,
      fieldType: row.fieldType === 'file' || row.field_type === 'file' ? 'file' : undefined,
    })

    const sortRows = <T extends Record<string, unknown>>(rows: T[]): T[] =>
      [...rows].sort((a, b) =>
        Number(a.sortOrder ?? a.sort_order ?? 0) - Number(b.sortOrder ?? b.sort_order ?? 0)
        || Number(a.createdAt ?? a.created_at ?? 0) - Number(b.createdAt ?? b.created_at ?? 0)
        || String(a.name ?? '').localeCompare(String(b.name ?? '')))

    const folderResult = await window.api.folders.list() as { data?: RawFolder[] }
    const requestResult = await window.api.requests.listAll() as { data?: RawRequest[] }
    const variableResult = await window.api.variables.list() as { data?: { collections?: Record<string, RawVariable[]> } }

    const folders = folderResult.data ?? []
    const requests = requestResult.data ?? []
    const variablesByCollection = variableResult.data?.collections ?? {}
    const parentOf = (row: Record<string, unknown>) => String(row.parentId ?? row.parent_id ?? '')
    const folderIdOf = (row: Record<string, unknown>) => String(row.folderId ?? row.folder_id ?? '')

    const mapRequest = (row: RawRequest) => ({
      name: row.name,
      method: String(row.method ?? 'GET'),
      url: String(row.url ?? ''),
      bodyType: String(row.bodyType ?? row.body_type ?? 'none'),
      headers: parseArray(row.headers).map(normalizePair),
      params: parseArray(row.params).map(normalizePair),
      authType: String(row.authType ?? row.auth_type ?? 'none'),
      authConfig: parseObject(row.authConfig ?? row.auth_config),
    })

    const mapFolder = (row: RawFolder): PersistedFolder => ({
      id: row.id,
      name: String(row.name ?? ''),
      authType: String(row.authType ?? row.auth_type ?? 'none'),
      authConfig: parseObject(row.authConfig ?? row.auth_config),
      variables: (variablesByCollection[row.id] ?? []).map((variable) => ({
        key: variable.key,
        value: variable.value,
        isSecret: Boolean(variable.isSecret ?? variable.is_secret),
      })),
      requests: sortRows(requests.filter((request) => folderIdOf(request) === row.id)).map(mapRequest),
      folders: sortRows(folders.filter((folder) => parentOf(folder) === row.id)).map(mapFolder),
    })

    const root = folders.find((folder) => !parentOf(folder) && folder.name === name)
    return root ? mapFolder(root) : null
  }, rootName)
}

function variablesByKey(collection: PersistedFolder): Record<string, PersistedVariable> {
  return Object.fromEntries(collection.variables.map((variable) => [variable.key, variable]))
}

function requestByName(folder: PersistedFolder, requestName: string): PersistedRequest {
  const request = folder.requests.find((entry) => entry.name === requestName)
  if (!request) throw new Error(`Missing request ${requestName} in ${folder.name}`)
  return request
}

function folderByName(folder: PersistedFolder, childName: string): PersistedFolder {
  const child = folder.folders.find((entry) => entry.name === childName)
  if (!child) throw new Error(`Missing folder ${childName} in ${folder.name}`)
  return child
}

test.afterAll(async ({ window }) => {
  await window.evaluate(async (names: string[]) => {
    const result = await window.api.folders.list() as { data?: Array<{ id: string; name: string; parentId?: string | null; parent_id?: string | null }> }
    for (const folder of result.data ?? []) {
      if (!(folder.parentId ?? folder.parent_id) && names.includes(folder.name)) {
        await window.api.folders.delete({ id: folder.id })
      }
    }
  }, [postmanName, insomniaName, brunoName, brunoYamlName, postmanV3Name])
  fs.rmSync(generated, { recursive: true, force: true })
})

test.describe('Import sources', () => {
  test('imports a Postman collection with persisted folders, requests, auth, headers, and variables', async ({ window }) => {
    await openImport(window)
    await window.locator('input[type="file"]:not([data-testid="import-folder-input"])').setInputFiles({
      name: 'postman.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(POSTMAN)),
    })
    await expect(window.getByTestId('import-format')).toContainText('Postman')
    await expect(window.getByText('1 folder · 1 request')).toBeVisible()
    await expect(window.getByTestId('import-warnings')).toContainText('pre-request script')

    await finishImport(window, postmanName)

    const imported = await readImportedCollection(window, postmanName)
    expect(imported).not.toBeNull()
    expect(imported?.name).toBe(postmanName)
    expect(imported?.folders.map((folder) => folder.name)).toEqual(['Users'])
    expect(variablesByKey(imported!)).toMatchObject({
      host: { key: 'host', value: 'https://api.example.test', isSecret: false },
    })

    const request = requestByName(folderByName(imported!, 'Users'), 'Create user')
    expect(request).toMatchObject({
      method: 'POST',
      url: '{{host}}/users',
      bodyType: 'raw-json',
      authType: 'bearer',
      authConfig: { token: 'abc' },
    })
    expect(request.headers).toEqual([
      expect.objectContaining({ key: 'Content-Type', value: 'application/json', enabled: true }),
    ])
  })

  test('imports an Insomnia v5 file and persists folders, requests, auth, headers, and variables', async ({ window }) => {
    await importFile(window, prepared.insomniaFile)
    await expect(window.getByTestId('import-format')).toContainText('Insomnia')
    await expect(window.getByRole('button', { name: /Import 1 collection/ })).toBeVisible()

    await finishImport(window, insomniaName)

    const imported = await readImportedCollection(window, insomniaName)
    expect(imported).not.toBeNull()
    expect(imported?.name).toBe(insomniaName)
    expect(imported?.folders.map((folder) => folder.name)).toEqual(['grandparent'])
    expect(variablesByKey(imported!)).toMatchObject({
      'test-value': { key: 'test-value', value: 'grandparent', isSecret: false },
    })

    const grandparent = folderByName(imported!, 'grandparent')
    const parent = folderByName(grandparent, 'parent')
    const request = requestByName(parent, 'Child Request')
    expect(request).toMatchObject({
      method: 'GET',
      url: 'https://insomnia-airlines-api.onrender.com/test/extra-data',
      bodyType: 'none',
      authType: 'basic',
      authConfig: { username: '{{test-value}}', password: '' },
    })
    expect(request.headers).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'User-Agent', value: 'insomnia/12.5.1-alpha.0', enabled: true }),
      expect.objectContaining({ key: 'x-test-value', value: '{{test-value}}', enabled: true }),
    ]))
  })

  test('explains a Postman environment file', async ({ window }) => {
    await openImport(window)
    await window.locator('input[type="file"]:not([data-testid="import-folder-input"])').setInputFiles({
      name: 'env.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{"name":"E","values":[],"_postman_variable_scope":"environment"}'),
    })
    await expect(window.getByTestId('import-error')).toContainText('Postman environment')
  })

  test('imports a Bruno collection folder and persists folders, requests, auth, headers, and variables', async ({ window }) => {
    await importFolder(window, prepared.brunoFolder)
    await expect(window.getByTestId('import-format')).toContainText('Bruno')
    await finishImport(window, brunoName)

    const imported = await readImportedCollection(window, brunoName)
    expect(imported).not.toBeNull()
    expect(imported).toMatchObject({
      name: brunoName,
      authType: 'basic',
      authConfig: { username: 'root-user', password: 'root-pass' },
    })
    expect(imported?.folders.map((folder) => folder.name)).toEqual(['Users'])
    expect(variablesByKey(imported!)).toMatchObject({
      base_url: { key: 'base_url', value: 'https://api.example.test', isSecret: false },
      auth_token: { key: 'auth_token', value: `token-${stamp}`, isSecret: false },
    })

    const health = requestByName(imported!, 'Health Check')
    expect(health).toMatchObject({
      method: 'GET',
      url: '{{base_url}}/health',
      bodyType: 'none',
      authType: 'inherit',
      authConfig: {},
    })
    expect(health.headers).toEqual([
      expect.objectContaining({ key: 'Accept', value: 'application/json', enabled: true }),
    ])

    const createUser = requestByName(folderByName(imported!, 'Users'), 'Create User')
    expect(createUser).toMatchObject({
      method: 'POST',
      url: '{{base_url}}/users',
      bodyType: 'raw-json',
      authType: 'bearer',
      authConfig: { token: '{{auth_token}}' },
    })
    expect(createUser.headers).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'Content-Type', value: 'application/json', enabled: true }),
      expect.objectContaining({ key: 'X-Request', value: String(stamp), enabled: true }),
    ]))
  })

  test('imports a Postman v3 folder and persists folders, requests, auth, headers, and variables', async ({ window }) => {
    await importFolder(window, prepared.postmanV3Folder)
    await expect(window.getByTestId('import-format')).toContainText('Postman')
    await expect(window.getByText(postmanV3Name)).toBeVisible()
    await expect(window.getByTestId('import-warnings')).toContainText('environment')

    await finishImport(window, postmanV3Name)

    const imported = await readImportedCollection(window, postmanV3Name)
    expect(imported).not.toBeNull()
    expect(imported).toMatchObject({
      name: postmanV3Name,
      authType: 'bearer',
      authConfig: { token: '{{secretToken}}' },
    })
    expect(imported?.folders.map((folder) => folder.name)).toEqual(['Users'])
    expect(variablesByKey(imported!)).toMatchObject({
      baseUrl: { key: 'baseUrl', value: 'https://api.example.com', isSecret: false },
      secretToken: { key: 'secretToken', value: '', isSecret: true },
      folderOnly: { key: 'folderOnly', value: 'from-folder', isSecret: false },
      id: { key: 'id', value: '42', isSecret: false },
    })

    const createUser = requestByName(imported!, 'Create user')
    expect(createUser).toMatchObject({
      method: 'POST',
      url: '{{baseUrl}}/users/{{id}}',
      bodyType: 'raw-json',
      authType: 'apikey',
      authConfig: { key: 'X-Api-Key', value: 'abc123', in: 'query' },
    })
    expect(createUser.headers).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'Content-Type', value: 'application/json', enabled: true }),
      expect.objectContaining({ key: 'X-Trace', value: expect.stringContaining('$guid'), enabled: true }),
    ]))

    const users = folderByName(imported!, 'Users')
    const search = requestByName(users, 'Search users')
    expect(search).toMatchObject({
      method: 'POST',
      url: '{{baseUrl}}/graphql',
      bodyType: 'graphql',
    })
    expect(search.headers).toEqual([
      expect.objectContaining({ key: 'X-Mode', value: 'graph', enabled: true }),
    ])
  })

  test('imports a Bruno YAML folder and persists folders, requests, auth, headers, and variables', async ({ window }) => {
    await importFolder(window, prepared.brunoYamlFolder)
    await expect(window.getByTestId('import-format')).toContainText('Bruno')
    await expect(window.getByText(brunoYamlName)).toBeVisible()

    await finishImport(window, brunoYamlName)

    const imported = await readImportedCollection(window, brunoYamlName)
    expect(imported).not.toBeNull()
    expect(imported).toMatchObject({
      name: brunoYamlName,
      authType: 'bearer',
      authConfig: { token: '{{token}}' },
    })
    expect(imported?.folders.map((folder) => folder.name)).toEqual(['API'])
    expect(variablesByKey(imported!)).toMatchObject({
      token: { key: 'token', value: 'root-token', isSecret: false },
      shadow: { key: 'shadow', value: 'root-shadow', isSecret: false },
      folderVar: { key: 'folderVar', value: 'folder', isSecret: false },
      requestVar: { key: 'requestVar', value: 'request-value', isSecret: false },
      id: { key: 'id', value: '42', isSecret: false },
    })

    const api = folderByName(imported!, 'API')
    expect(api).toMatchObject({
      authType: 'apikey',
      authConfig: { key: 'X-Key', value: '{{token}}', in: 'query' },
    })
    expect(api.requests.map((request) => request.name)).toEqual(['Query Users', 'Login'])

    const graphql = requestByName(api, 'Query Users')
    expect(graphql).toMatchObject({
      method: 'POST',
      url: 'https://api.example.com/graphql',
      bodyType: 'graphql',
      authType: 'basic',
      authConfig: { username: 'user', password: 'pass' },
    })
    expect(graphql.headers).toEqual([
      expect.objectContaining({ key: 'X-Env', value: '{{folderVar}}', enabled: true }),
    ])

    const login = requestByName(api, 'Login')
    expect(login).toMatchObject({
      method: 'POST',
      url: 'https://api.example.com/users/{{id}}',
      bodyType: 'raw-json',
      authType: 'oauth2',
      authConfig: {
        grantType: 'password',
        clientId: 'client',
        clientSecret: 'secret',
        authUrl: '',
        tokenUrl: 'https://auth.example.com/token',
        scopes: 'read write',
        redirectUri: '',
      },
    })
    expect(login.headers).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'Content-Type', value: 'application/json', enabled: true }),
      expect.objectContaining({ key: 'X-Off', value: 'off', enabled: false }),
    ]))
  })

  test('shows folder import errors and does not import invalid folders', async ({ window }) => {
    const before = await rootCollectionNames(window)

    await importFolder(window, prepared.emptyFolder)
    await expect(window.getByTestId('import-error')).toContainText('No Bruno (.bru or YAML) or Postman v3 collection files were found in that folder')
    expect(await rootCollectionNames(window)).toEqual(before)

    await importFolderFromOpenDialog(window, prepared.yamlOnlyFolder)
    await expect(window.getByTestId('import-error')).toContainText('No Bruno (.bru or YAML) or Postman v3 collection files were found in that folder')
    expect(await rootCollectionNames(window)).toEqual(before)
  })
})
