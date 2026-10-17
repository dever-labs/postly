import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers: Record<string, (event: unknown, args: unknown) => Promise<unknown> | unknown> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, args: unknown) => Promise<unknown> | unknown) => {
      handlers[channel] = handler
    }),
  },
  BrowserWindow: { fromWebContents: vi.fn(() => null) },
  dialog: {},
}))

vi.mock('../database', () => ({
  queryAll: vi.fn(),
  runTransaction: vi.fn(),
}))

vi.mock('../services/variable-store', () => ({
  exportCollectionVariables: vi.fn(() => []),
  collectionVariableStatements: vi.fn(() => []),
}))

import { registerExportImportHandlers } from './export-import'

function invoke(channel: string, args: unknown) {
  return Promise.resolve(handlers[channel]({ sender: {} }, args)) as Promise<Record<string, unknown>>
}

beforeEach(() => {
  for (const key of Object.keys(handlers)) delete handlers[key]
  vi.clearAllMocks()
  registerExportImportHandlers()
})

describe('export/import IPC parsing handlers', () => {
  it('parses import text through postly:import:parse', async () => {
    const postman = JSON.stringify({
      info: {
        name: 'Parsed through IPC',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [
        {
          name: 'Ping',
          request: {
            method: 'GET',
            url: 'https://api.example.com/ping',
          },
        },
      ],
    })

    const result = await invoke('postly:import:parse', { text: postman })

    expect(result).toEqual({
      data: expect.objectContaining({
        format: 'postman',
        collections: [expect.objectContaining({ requests: 1, collection: expect.objectContaining({ name: 'Parsed through IPC' }) })],
      }),
    })
  })

  it('parses Bruno folders through postly:import:parse-folder', async () => {
    const result = await invoke('postly:import:parse-folder', {
      files: [
        {
          path: 'picked/bruno.json',
          text: JSON.stringify({ name: 'Picked by IPC' }),
        },
        {
          path: 'picked/request.bru',
          text: `meta {
  name: IPC request
  type: http
}

get {
  url: https://example.com/items
}
`,
        },
      ],
    })

    expect(result).toEqual({
      data: expect.objectContaining({
        format: 'bruno',
        collections: [expect.objectContaining({ requests: 1, collection: expect.objectContaining({ name: 'Picked by IPC' }) })],
      }),
    })
  })

  it('validates malformed parse arguments', async () => {
    await expect(invoke('postly:import:parse', { text: 123 })).resolves.toEqual({ error: 'No file content provided.' })
    await expect(invoke('postly:import:parse-folder', { files: 'nope' })).resolves.toEqual({ error: 'No files provided.' })
    await expect(invoke('postly:import:parse-folder', { files: [{ text: 'x' }] })).resolves.toEqual({ error: 'Each file must include string path and text.' })
    await expect(invoke('postly:import:parse-folder', { files: [{ path: 'picked/request.bru', text: 42 }] })).resolves.toEqual({ error: 'Each file must include string path and text.' })
  })
})
