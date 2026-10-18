import { test, expect } from './fixtures'
import type { Page } from '@playwright/test'
import type { StubHandle } from '../src/main/services/__tests__/helpers/http-stub'

let requestId = ''
let collectionId = ''
let fastEndpoint: StubHandle
let slowEndpoint: StubHandle
const runId = Date.now()
const collectionName = `E2E Send & Cancel ${runId}`
const requestName = `Stubbed Request ${runId}`

async function openRequestEditor(window: Page, options: { clearDraft?: boolean } = {}): Promise<void> {
  if (options.clearDraft) {
    await window.evaluate(async (id: string) => {
      await window.api.drafts.request.delete({ requestId: id })
    }, requestId)
  }

  await window.locator(`text=${collectionName}`).first().click()
  await window.locator(`text=${requestName}`).first().click()

  const urlInput = window.locator('[data-testid="url-input"]')
  await urlInput.waitFor({ state: 'visible' })
}

async function setRequestUrl(
  window: Page,
  url: string,
): Promise<void> {
  await window.evaluate(async ({ id, nextUrl }: { id: string; nextUrl: string }) => {
    await window.api.drafts.request.upsert({ requestId: id, url: nextUrl })
  }, { id: requestId, nextUrl: url })
  await openRequestEditor(window)
  await expect(window.locator('[data-testid="url-input"]')).toHaveValue(url)
}

test.describe('Send & cancel request', () => {
  test.beforeAll(async ({ window }) => {
    collectionId = await window.evaluate(async (name: string) => {
      const res = await window.api.collections.create({ name })
      return (res as { data: { id: string } }).data.id
    }, collectionName)
    const grpId = await window.evaluate(async (collectionId: string) => {
      const res = await window.api.folders.create({ parentId: collectionId, name: 'Default' })
      return (res as { data: { id: string } }).data.id
    }, collectionId)
    requestId = await window.evaluate(async ({ folderId, name }: { folderId: string; name: string }) => {
      const res = await window.api.requests.create({ folderId, name, method: 'GET' })
      return (res as { data: { id: string } }).data.id
    }, { folderId: grpId, name: requestName })

    await window.reload()
    await window.waitForSelector('[data-testid="app-root"]', { timeout: 20_000 })
  })

  test.afterAll(async ({ window }) => {
    if (collectionId) {
      await window.evaluate(async (id: string) => {
        await window.api.folders.delete({ id })
      }, collectionId)
    }
  })

  test.beforeEach(async ({ window, stubServer }) => {
    fastEndpoint = await stubServer.stub({
      method: 'GET',
      path: '/fast',
      response: {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: { message: 'hello from the stub server' },
      },
    })

    slowEndpoint = await stubServer.stub({
      method: 'GET',
      path: '/slow',
      response: {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: { message: 'this should be cancelled' },
        delayMs: 10_000,
      },
    })

    await openRequestEditor(window, { clearDraft: true })
  })

  test('successful request shows response with status 200', async ({ window, stubServer }) => {
    const url = `${stubServer.baseUrl}/fast`
    await setRequestUrl(window, url)
    await window.locator('[data-testid="send-button"]').click()

    await expect(window.locator('[data-testid="response-panel"]')).toBeVisible({ timeout: 10_000 })
    await expect(window.locator('[data-testid="response-status"]')).toContainText('200')

    const requests = await stubServer.waitForRequests(fastEndpoint, 1)
    expect(requests).toHaveLength(1)
  })

  test('response body contains the JSON returned by the stub server', async ({ window, stubServer }) => {
    const url = `${stubServer.baseUrl}/fast`
    await setRequestUrl(window, url)
    await window.locator('[data-testid="send-button"]').click()

    await expect(window.locator('[data-testid="response-panel"]')).toBeVisible({ timeout: 10_000 })
    await expect(window.locator('[data-testid="response-panel"]')).toContainText('hello from the stub server')
  })

  test('send button is replaced by Cancel while a slow request is in flight', async ({ window, stubServer }) => {
    const url = `${stubServer.baseUrl}/slow`
    await setRequestUrl(window, url)
    await window.locator('[data-testid="send-button"]').click()

    await expect(window.locator('[data-testid="cancel-button"]')).toBeVisible({ timeout: 8_000 })
    await expect(window.locator('[data-testid="send-button"]')).not.toBeVisible()
    await expect(window.locator('[data-testid="response-loading"]')).toBeVisible()

    await window.locator('[data-testid="cancel-button"]').click()
    await expect(window.locator('[data-testid="send-button"]')).toBeVisible({ timeout: 10_000 })

    const requests = await stubServer.waitForRequests(slowEndpoint, 1)
    expect(requests).toHaveLength(1)
  })

  test('clicking Cancel aborts the request and restores Send button', async ({ window, stubServer }) => {
    const url = `${stubServer.baseUrl}/slow`
    await setRequestUrl(window, url)
    await window.locator('[data-testid="send-button"]').click()

    await expect(window.locator('[data-testid="cancel-button"]')).toBeVisible({ timeout: 8_000 })
    await window.locator('[data-testid="cancel-button"]').click()

    await expect(window.locator('[data-testid="send-button"]')).toBeVisible({ timeout: 10_000 })
    await expect(window.locator('[data-testid="response-empty"]')).not.toBeVisible()
    await expect(window.locator('[data-testid="response-panel"]')).toBeVisible()
  })

  test('pressing Enter in URL bar sends the request', async ({ window, stubServer }) => {
    const url = `${stubServer.baseUrl}/fast`
    const urlInput = window.locator('[data-testid="url-input"]')
    await urlInput.fill(url)
    await expect(urlInput).toHaveValue(url)
    await urlInput.press('Enter')

    await expect(window.locator('[data-testid="response-panel"]')).toBeVisible({ timeout: 10_000 })
    await expect(window.locator('[data-testid="response-status"]')).toContainText('200')
  })

  test('second send is blocked while a request is in flight', async ({ window, stubServer }) => {
    const url = `${stubServer.baseUrl}/slow`
    await setRequestUrl(window, url)
    await window.locator('[data-testid="send-button"]').click()

    await expect(window.locator('[data-testid="cancel-button"]')).toBeVisible({ timeout: 8_000 })
    await expect(window.locator('[data-testid="send-button"]')).not.toBeVisible()

    await window.locator('[data-testid="cancel-button"]').click()
    await expect(window.locator('[data-testid="send-button"]')).toBeVisible({ timeout: 10_000 })
  })
})
