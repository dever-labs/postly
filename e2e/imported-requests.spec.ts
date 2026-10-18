import fs from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures'
import { MocklyServer } from '../src/main/services/__tests__/helpers/mockly'

type PreparedFixtures = {
  postmanCollection: string
  postmanEnvironment: string
  openApiFile: string
}

const stamp = Date.now()
const generated = path.join(__dirname, '.generated-imported-requests')

const names = {
  postmanCollection: `Imported Postman ${stamp}`,
  postmanRequest: `Create imported widget ${stamp}`,
  postmanEnvironment: `Imported Environment ${stamp}`,
  urlCollection: `URL Import ${stamp}`,
  openApiCollection: `Imported OpenAPI ${stamp}`,
  openApiFolder: 'orders',
  openApiRequest: `Get order ${stamp}`,
  primaryEnvironment: `Primary ${stamp}`,
  secondaryEnvironment: `Secondary ${stamp}`,
}

const mockIds = {
  postmanRequest: 'import-postman-request',
  openApiSecondary: 'import-openapi-secondary',
  urlSpec: 'import-url-openapi',
  urlRedirect: 'import-url-openapi-redirect',
  urlMissing: 'import-url-openapi-missing',
}

const postmanVars = {
  widgetId: `widget-${stamp}`,
  mode: `mode-${stamp}`,
  traceId: `trace-${stamp}`,
  stage: `stage-${stamp}`,
  widgetName: `Widget ${stamp}`,
}

let mockly: MocklyServer
let prepared: PreparedFixtures

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

function writeJson(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

function prepareFixtures(mocklyBase: string): PreparedFixtures {
  fs.rmSync(generated, { recursive: true, force: true })
  ensureDir(generated)

  const postmanCollection = path.join(generated, 'postman-collection.json')
  writeJson(postmanCollection, {
    info: {
      name: names.postmanCollection,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    variable: [
      { key: 'baseUrl', value: 'https://placeholder.example.com' },
      { key: 'widgetId', value: postmanVars.widgetId },
      { key: 'mode', value: postmanVars.mode },
      { key: 'traceId', value: postmanVars.traceId },
      { key: 'stage', value: postmanVars.stage },
      { key: 'widgetName', value: postmanVars.widgetName },
    ],
    item: [{
      name: names.postmanRequest,
      request: {
        method: 'POST',
        header: [
          { key: 'Content-Type', value: 'application/json' },
          { key: 'X-Stage', value: '{{stage}}' },
        ],
        url: {
          raw: '{{baseUrl}}/imported/widgets/{{widgetId}}?mode={{mode}}&trace={{traceId}}',
          query: [
            { key: 'mode', value: '{{mode}}' },
            { key: 'trace', value: '{{traceId}}' },
          ],
        },
        body: {
          mode: 'raw',
          raw: JSON.stringify({ name: '{{widgetName}}', secret: '{{secretToken}}' }, null, 2),
          options: { raw: { language: 'json' } },
        },
        auth: {
          type: 'bearer',
          bearer: [{ key: 'token', value: '{{secretToken}}' }],
        },
      },
    }],
  })

  const postmanEnvironment = path.join(generated, 'postman-environment.json')
  writeJson(postmanEnvironment, {
    _postman_variable_scope: 'environment',
    name: names.postmanEnvironment,
    values: [
      { key: 'secretToken', value: '', type: 'secret', enabled: true },
      { key: 'baseUrl', value: mocklyBase, enabled: true },
    ],
  })

  const openApiFile = path.join(generated, 'openapi-per-server.yaml')
  fs.writeFileSync(openApiFile, `openapi: 3.0.3
info:
  title: ${names.openApiCollection}
  version: '1'
servers:
  - url: ${mocklyBase}/primary
    description: ${names.primaryEnvironment}
  - url: ${mocklyBase}/secondary
    description: ${names.secondaryEnvironment}
paths:
  /orders/{orderId}:
    get:
      tags: [${names.openApiFolder}]
      summary: ${names.openApiRequest}
      parameters:
        - name: orderId
          in: path
          required: true
          schema:
            type: string
            default: order-${stamp}
        - name: view
          in: query
          required: true
          schema:
            type: string
            default: compact
`)

  return { postmanCollection, postmanEnvironment, openApiFile }
}

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

async function finishImport(window: Page, rootName: string): Promise<void> {
  await window.getByRole('button', { name: /^Import \d/ }).click()
  await expect(window.getByRole('treeitem', { name: new RegExp(`^${escapeRegex(rootName)}`) })).toBeVisible()
}

async function finishEnvironmentImport(window: Page, environmentName: string): Promise<void> {
  await window.getByRole('button', { name: /^Import \d+ environment/ }).click()
  await expect.poll(async () => {
    const names = await window.evaluate(async () => {
      return ((await window.api.environments.list()) as {
        data?: { environments?: Array<{ name: string }> }
      }).data?.environments?.map((environment) => environment.name) ?? []
    })
    return names.includes(environmentName)
  }, { timeout: 10_000 }).toBe(true)
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

async function activateEnvironment(window: Page, name: string): Promise<void> {
  await window.evaluate(async (targetName: string) => {
    const environments = ((await window.api.environments.list()) as {
      data?: { environments?: Array<{ id: string; name: string }> }
    }).data?.environments ?? []
    const target = environments.find((environment) => environment.name === targetName)
    if (!target) throw new Error(`Missing environment ${targetName}`)
    await window.api.environments.setActive({ id: target.id })
  }, name)
}

async function fillSecretEnvironmentValue(window: Page, environmentName: string, value: string): Promise<void> {
  await window.getByTestId('tab-environments').click()
  await window.getByText(environmentName, { exact: true }).first().click()
  const valueInput = window.locator('input[placeholder="value"]').first()
  await expect(valueInput).toHaveAttribute('type', 'password')
  await valueInput.fill(value)
  await window.getByRole('button', { name: /^Save$/ }).click()
  await expect(window.getByRole('button', { name: 'Saved' })).toBeVisible()
}

async function openRequest(window: Page, collectionName: string, requestName: string, folderName?: string): Promise<void> {
  await window.getByTestId('tab-apis').click()
  if (folderName) {
    await expandTreeItem(window, collectionName, folderName)
    await expandTreeItem(window, folderName, requestName)
  } else {
    await expandTreeItem(window, collectionName, requestName)
  }
  await window.getByText(requestName, { exact: true }).first().click()
  await window.getByTestId('url-input').waitFor({ state: 'visible' })
  await window.waitForTimeout(300)
}

function callHeaders(call: { headers?: Record<string, string> | undefined }): Record<string, string> {
  return Object.fromEntries(Object.entries(call.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]))
}

test.beforeAll(async () => {
  mockly = await MocklyServer.ensure()
  prepared = prepareFixtures(mockly.httpBase)

  await mockly.addMock({
    id: mockIds.postmanRequest,
    request: {
      method: 'POST',
      path: `/imported/widgets/${postmanVars.widgetId}`,
      query: {
        mode: postmanVars.mode,
        trace: postmanVars.traceId,
      },
      headers: {
        'X-Stage': postmanVars.stage,
      },
    },
    response: {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, source: 'postman-import' }),
    },
  })

  await mockly.addMock({
    id: mockIds.openApiSecondary,
    request: {
      method: 'GET',
      path: `/secondary/orders/order-${stamp}`,
      query: { view: 'compact' },
    },
    response: {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, source: 'openapi-import' }),
    },
  })

  await mockly.addMock({
    id: mockIds.urlSpec,
    request: { method: 'GET', path: '/docs/url-openapi.yaml' },
    response: {
      status: 200,
      headers: { 'Content-Type': 'application/yaml' },
      body: `openapi: 3.0.3
info:
  title: ${names.urlCollection}
  version: '1'
servers:
  - url: ${mockly.httpBase}/url-import
paths:
  /ping:
    get:
      summary: Ping imported URL
`,
    },
  })

  await mockly.addMock({
    id: mockIds.urlRedirect,
    request: { method: 'GET', path: '/docs/redirect' },
    response: {
      status: 302,
      headers: { Location: `${mockly.httpBase}/docs/url-openapi.yaml` },
    },
  })

  await mockly.addMock({
    id: mockIds.urlMissing,
    request: { method: 'GET', path: '/docs/missing' },
    response: {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
      body: 'missing',
    },
  })
})

test.beforeEach(async ({ window }) => {
  await mockly.clearAllCalls()
  await reloadApp(window)
  await window.evaluate(async () => {
    await window.api.proxy.set({ mode: 'none', url: '', username: '', password: '', bypass: '' })
  })
})

test.afterEach(async ({ window }) => {
  await window.evaluate(async () => {
    await window.api.proxy.set({ mode: 'system', url: '', username: '', password: '', bypass: '' })
  })
})

test.afterAll(async ({ window }) => {
  await window.evaluate(async ([collectionNames, environmentNames]: [string[], string[]]) => {
    const folders = ((await window.api.folders.list()) as {
      data?: Array<{ id: string; name: string; parentId?: string | null; parent_id?: string | null }>
    }).data ?? []

    for (const folder of folders) {
      if (!(folder.parentId ?? folder.parent_id) && collectionNames.includes(folder.name)) {
        await window.api.folders.delete({ id: folder.id })
      }
    }

    const environments = ((await window.api.environments.list()) as {
      data?: { environments?: Array<{ id: string; name: string }> }
    }).data?.environments ?? []

    for (const environment of environments) {
      if (environmentNames.includes(environment.name)) {
        await window.api.environments.delete({ id: environment.id })
      }
    }
  }, [[names.postmanCollection, names.urlCollection, names.openApiCollection], [names.postmanEnvironment, names.primaryEnvironment, names.secondaryEnvironment]] as [string[], string[]])

  await mockly?.stop()
  fs.rmSync(generated, { recursive: true, force: true })
})

test.describe('Imported requests', () => {
  test('imports a Postman collection and environment and sends the imported request', async ({ window }) => {
    await importFile(window, prepared.postmanCollection)
    await expect(window.getByTestId('import-format')).toContainText('Postman')
    await finishImport(window, names.postmanCollection)

    await importFile(window, prepared.postmanEnvironment)
    await expect(window.getByTestId('import-format')).toContainText('Postman environment')
    await finishEnvironmentImport(window, names.postmanEnvironment)

    await fillSecretEnvironmentValue(window, names.postmanEnvironment, 'resolved-secret-token')
    await activateEnvironment(window, names.postmanEnvironment)
    await openRequest(window, names.postmanCollection, names.postmanRequest)
    await window.getByTestId('send-button').click()

    await expect(window.getByTestId('response-status')).toContainText('200', { timeout: 10_000 })
    await expect(window.getByTestId('response-panel')).toContainText('postman-import')

    const { calls } = await mockly.waitForCalls(mockIds.postmanRequest, 1, '8s')
    expect(calls).toHaveLength(1)
    expect(JSON.parse(calls[0].body ?? '{}')).toEqual({
      name: postmanVars.widgetName,
      secret: 'resolved-secret-token',
    })

    const headers = callHeaders(calls[0])
    expect(headers.authorization).toBe('Bearer resolved-secret-token')
    expect(headers['x-stage']).toBe(postmanVars.stage)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].path).toBe(`/imported/widgets/${postmanVars.widgetId}`)
  })

  test('imports an OpenAPI document from a URL, following redirects and surfacing 404 errors', async ({ window }) => {
    await openImport(window)
    await window.getByTestId('import-url').fill(`${mockly.httpBase}/docs/missing`)
    await window.getByTestId('import-url-fetch').click()
    await expect(window.getByTestId('import-error')).toContainText('404')

    await window.getByTestId('import-url').fill(`${mockly.httpBase}/docs/redirect`)
    await window.getByTestId('import-url-fetch').click()
    await expect(window.getByTestId('import-format')).toContainText('OpenAPI')
    await finishImport(window, names.urlCollection)
  })

  test('imports OpenAPI server environments and sends through the selected server', async ({ window }) => {
    await importFile(window, prepared.openApiFile)
    await expect(window.getByTestId('import-format')).toContainText('OpenAPI')
    await finishImport(window, names.openApiCollection)

    await activateEnvironment(window, names.secondaryEnvironment)
    await openRequest(window, names.openApiCollection, names.openApiRequest, names.openApiFolder)
    await window.getByTestId('send-button').click()

    await expect(window.getByTestId('response-status')).toContainText('200', { timeout: 10_000 })
    await expect(window.getByTestId('response-panel')).toContainText('openapi-import')

    const { calls } = await mockly.waitForCalls(mockIds.openApiSecondary, 1, '8s')
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('GET')
    expect(calls[0].path).toBe(`/secondary/orders/order-${stamp}`)
  })
})
