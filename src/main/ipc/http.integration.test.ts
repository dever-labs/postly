import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers: Record<string, (event: unknown, args: unknown) => Promise<unknown> | unknown> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, args: unknown) => Promise<unknown> | unknown) => {
      handlers[channel] = handler
    }),
  },
}))

vi.mock('../database', () => ({
  queryOne: vi.fn(),
  queryAll: vi.fn(),
}))

vi.mock('../services/http-executor', () => ({
  executeRequest: vi.fn(),
}))

vi.mock('../services/file-access', () => ({
  collectLocalFilePaths: vi.fn(() => []),
  confirmLocalFileReads: vi.fn(async () => true),
}))

vi.mock('../services/extract-apply', () => ({
  applyExtraction: vi.fn(),
  guardedRegex: vi.fn(),
}))

vi.mock('../services/history', () => ({
  recordHistory: vi.fn(),
}))

vi.mock('../services/oauth', () => ({
  getValidTokenForConfig: vi.fn(),
  authorizeInline: vi.fn(),
}))

import { queryOne, queryAll } from '../database'
import { executeRequest } from '../services/http-executor'
import { registerHttpHandlers } from './http'

const mockQueryOne = vi.mocked(queryOne)
const mockQueryAll = vi.mocked(queryAll)
const mockExecuteRequest = vi.mocked(executeRequest)

function makeRequest(requestId: string) {
  return {
    requestId,
    method: 'GET',
    url: `https://api.example.test/${requestId}`,
    headers: {},
    bodyType: 'none',
    authType: 'none',
    authConfig: {},
  }
}

function makeSender(id: number) {
  return {
    id,
    isDestroyed: () => false,
    send: vi.fn(),
  }
}

describe('http IPC integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQueryOne.mockReturnValue(null)
    mockQueryAll.mockReturnValue([])
    registerHttpHandlers()
  })

  it('cancels only the targeted slow request and lets the other finish', async () => {
    const sender = makeSender(42)
    let releaseSecond: (() => void) | undefined

    mockExecuteRequest.mockImplementation(async (request, options) => {
      const requestId = (request as { requestId?: string }).requestId
      if (requestId === 'req-1') {
        await new Promise<void>((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        })
      }
      await new Promise<void>((resolve) => {
        releaseSecond = () => resolve()
      })
      return {
        status: 200,
        statusText: 'OK',
        headers: {},
        body: requestId ?? '',
        duration: 25,
        size: 4,
      }
    })

    const first = Promise.resolve(handlers['postly:http:execute']({ sender }, makeRequest('req-1'))) as Promise<{ error?: string }>
    const second = Promise.resolve(handlers['postly:http:execute']({ sender }, makeRequest('req-2'))) as Promise<{ data?: { body: string } }>

    await vi.waitFor(() => expect(mockExecuteRequest).toHaveBeenCalledTimes(2))
    await Promise.resolve(handlers['postly:http:cancel']({ sender }, { requestId: 'req-1' }))

    const firstResult = await first
    expect(firstResult.error).toContain('aborted')

    releaseSecond?.()
    const secondResult = await second
    expect(secondResult.data?.body).toBe('req-2')
  })
})
