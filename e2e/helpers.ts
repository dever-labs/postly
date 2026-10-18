import type { Page } from '@playwright/test'
import { expect } from './fixtures'

export async function reloadApp(window: Page): Promise<void> {
  await window.reload()
  await window.waitForSelector('[data-testid="app-root"]', { timeout: 20_000 })
}

export async function waitForRequestDraft(window: Page, requestId: string, predicate?: (draft: Record<string, unknown> | null) => boolean): Promise<void> {
  await expect.poll(async () => {
    const result = await window.evaluate(async (id: string) => {
      return (await window.api.drafts.request.get({ requestId: id })) as { data: Record<string, unknown> | null }
    }, requestId)
    return predicate ? predicate(result.data) : result.data !== null
  }).toBe(true)
}

export async function waitForCollectionDraft(window: Page, collectionId: string, predicate?: (draft: Record<string, unknown> | null) => boolean): Promise<void> {
  await expect.poll(async () => {
    const result = await window.evaluate(async (id: string) => {
      return (await window.api.drafts.collection.get({ collectionId: id })) as { data: Record<string, unknown> | null }
    }, collectionId)
    return predicate ? predicate(result.data) : result.data !== null
  }).toBe(true)
}

export async function waitForGroupDraft(window: Page, groupId: string, predicate?: (draft: Record<string, unknown> | null) => boolean): Promise<void> {
  await expect.poll(async () => {
    const result = await window.evaluate(async (id: string) => {
      return (await window.api.drafts.group.get({ groupId: id })) as { data: Record<string, unknown> | null }
    }, groupId)
    return predicate ? predicate(result.data) : result.data !== null
  }).toBe(true)
}

export async function waitForEnvironmentDraft(window: Page, envId: string, predicate?: (draft: Record<string, unknown> | null) => boolean): Promise<void> {
  await expect.poll(async () => {
    const result = await window.evaluate(async (id: string) => {
      return (await window.api.drafts.env.get({ envId: id })) as { data: Record<string, unknown> | null }
    }, envId)
    return predicate ? predicate(result.data) : result.data !== null
  }).toBe(true)
}
