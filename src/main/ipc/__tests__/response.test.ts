import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const state: { handlers: Record<string, (ev: unknown, data: unknown) => Promise<Record<string, unknown>>> } = { handlers: {} }
const showSaveDialog = vi.fn()

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn((ch: string, h: (ev: unknown, data: unknown) => Promise<Record<string, unknown>>) => { state.handlers[ch] = h }) },
  dialog: { showSaveDialog: (...args: unknown[]) => showSaveDialog(...args) },
  BrowserWindow: { fromWebContents: () => null },
}))

import { registerResponseHandlers } from '../response'
import { storeResponseBody, getResponseBody, clearResponseBodies, configureResponseStoreForTests } from '../../services/response-store'

const call = (channel: string, data: unknown) => state.handlers[channel]({ sender: {} }, data)
const BYTES = Buffer.from([0, 255, 128, 10, 13, 200, 1])
let dir: string

beforeEach(() => {
  state.handlers = {}
  showSaveDialog.mockReset()
  clearResponseBodies()
  configureResponseStoreForTests()
  registerResponseHandlers()
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'postly-save-'))
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('postly:response:save', () => {
  it('writes the exact bytes and suggests a name from Content-Disposition', async () => {
    const id = storeResponseBody({ raw: BYTES, url: 'https://x.test/dl/1', headers: { 'Content-Disposition': 'attachment; filename="data.bin"', 'Content-Type': 'application/octet-stream' } })
    const target = path.join(dir, 'out.bin')
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: target })

    const result = await call('postly:response:save', { bodyId: id })

    expect(showSaveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'data.bin' }))
    expect(result.data).toEqual({ filePath: target, size: BYTES.length })
    expect(Buffer.compare(fs.readFileSync(target), BYTES)).toBe(0)
  })

  it('writes nothing when the dialog is cancelled', async () => {
    const id = storeResponseBody({ raw: BYTES, url: 'https://x.test/a', headers: {} })
    showSaveDialog.mockResolvedValue({ canceled: true })
    expect(await call('postly:response:save', { bodyId: id })).toEqual({ data: null })
  })

  it('reports write failures such as a missing folder', async () => {
    const id = storeResponseBody({ raw: BYTES, url: 'https://x.test/a', headers: {} })
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: path.join(dir, 'missing', 'out.bin') })
    const result = await call('postly:response:save', { bodyId: id })
    expect(String(result.error)).toMatch(/ENOENT/)
  })

  it('reports a response that is no longer available', async () => {
    expect(String((await call('postly:response:save', { bodyId: 'nope' })).error)).toMatch(/no longer available/)
    expect(showSaveDialog).not.toHaveBeenCalled()
  })

  it('only keeps the latest few bodies', async () => {
    configureResponseStoreForTests({ maxTotalBytes: BYTES.length * 4 })
    const first = storeResponseBody({ raw: BYTES, url: 'https://x.test/a', headers: {} })
    for (let i = 0; i < 4; i++) storeResponseBody({ raw: BYTES, url: 'https://x.test/a', headers: {} })
    expect(String((await call('postly:response:save', { bodyId: first })).error)).toMatch(/no longer available/)
  })

  it('evicts older bodies when a byte budget is exceeded', async () => {
    configureResponseStoreForTests({ maxTotalBytes: 10 })
    const first = storeResponseBody({ raw: Buffer.from('12345'), url: 'https://x.test/a', headers: {} })
    const second = storeResponseBody({ raw: Buffer.from('67890'), url: 'https://x.test/b', headers: {} })
    storeResponseBody({ raw: Buffer.from('abcde'), url: 'https://x.test/c', headers: {} })

    expect(String((await call('postly:response:save', { bodyId: first })).error)).toMatch(/no longer available/)
    showSaveDialog.mockResolvedValue({ canceled: true })
    expect(await call('postly:response:save', { bodyId: second })).toEqual({ data: null })
  })

  it('refreshes recency when a stored body is read', async () => {
    configureResponseStoreForTests({ maxTotalBytes: 10 })
    const first = storeResponseBody({ raw: Buffer.from('12345'), url: 'https://x.test/a', headers: {} })
    const second = storeResponseBody({ raw: Buffer.from('67890'), url: 'https://x.test/b', headers: {} })

    expect(getResponseBody(first)).toBeDefined()
    storeResponseBody({ raw: Buffer.from('abcde'), url: 'https://x.test/c', headers: {} })

    showSaveDialog.mockResolvedValue({ canceled: true })
    expect(await call('postly:response:save', { bodyId: first })).toEqual({ data: null })
    expect(String((await call('postly:response:save', { bodyId: second })).error)).toMatch(/no longer available/)
  })

  it('does not retain a body larger than the memory budget', async () => {
    configureResponseStoreForTests({ maxTotalBytes: 4 })
    const id = storeResponseBody({ raw: Buffer.from('12345'), url: 'https://x.test/a', headers: {} })
    expect(id).toBeUndefined()
    expect(String((await call('postly:response:save', { bodyId: id as string | undefined })).error)).toMatch(/no longer available/)
  })
})

describe('postly:response:preview', () => {
  it('returns image bytes as base64', async () => {
    const id = storeResponseBody({ raw: BYTES, url: 'https://x.test/a.png', headers: { 'content-type': 'image/png' } })
    expect(await call('postly:response:preview', { bodyId: id })).toEqual({ data: { mime: 'image/png', base64: BYTES.toString('base64') } })
  })

  it('has no preview for other types', async () => {
    const id = storeResponseBody({ raw: BYTES, url: 'https://x.test/a.pdf', headers: { 'content-type': 'application/pdf' } })
    expect(await call('postly:response:preview', { bodyId: id })).toEqual({ data: null })
  })
})
