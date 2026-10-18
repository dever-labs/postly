import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers: Record<string, (event: unknown, args?: unknown) => Promise<Record<string, unknown>>> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, args?: unknown) => Promise<Record<string, unknown>>) => {
      handlers[channel] = handler
    }),
  },
}))

vi.mock('../../database', () => ({
  queryAll: vi.fn(),
  queryOne: vi.fn(),
  run: vi.fn(),
}))

import { queryAll, queryOne, run } from '../../database'
import { registerSettingsHandlers } from '../settings'

const mockQueryAll = vi.mocked(queryAll)
const mockQueryOne = vi.mocked(queryOne)
const mockRun = vi.mocked(run)

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of Object.keys(handlers)) delete handlers[key]
  registerSettingsHandlers()
})

describe('settings IPC secret handling', () => {
  it('redacts secret settings on get', async () => {
    mockQueryOne.mockReturnValue({
      value: JSON.stringify({ baseUrl: 'https://bs.example.com', token: 'backstage-token', autoSync: true }),
    })

    const result = await handlers['postly:settings:get'](null, { key: 'backstage' })

    expect(result).toEqual({
      data: { baseUrl: 'https://bs.example.com', token: '', hasToken: true, autoSync: true },
    })
  })

  it('redacts secret settings on get-all', async () => {
    mockQueryAll.mockReturnValue([
      { key: 'github', value: JSON.stringify({ baseUrl: 'https://github.com', clientSecret: 'secret', token: 'oauth-token', orgs: [] }) },
    ])

    const result = await handlers['postly:settings:get-all'](null)
    const data = result.data as { github: Record<string, unknown> }

    expect(data.github).toMatchObject({
      baseUrl: 'https://github.com',
      clientSecret: '',
      token: '',
      hasClientSecret: true,
      hasToken: true,
    })
  })

  it('preserves a stored secret when the renderer sends the redacted shape back', async () => {
    mockQueryOne.mockReturnValue({
      value: JSON.stringify({ baseUrl: 'https://github.com', clientSecret: 'secret', token: 'oauth-token', orgs: ['acme'] }),
    })

    await handlers['postly:settings:set'](null, {
      key: 'github',
      value: { baseUrl: 'https://github.com', clientSecret: '', hasClientSecret: true, token: '', hasToken: true, orgs: ['acme'] },
    })

    expect(mockRun).toHaveBeenCalledWith(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
      ['github', JSON.stringify({ baseUrl: 'https://github.com', clientSecret: 'secret', token: 'oauth-token', orgs: ['acme'] })],
    )
  })

  it('clears a stored secret when the renderer explicitly clears it', async () => {
    mockQueryOne.mockReturnValue({
      value: JSON.stringify({ baseUrl: 'https://bs.example.com', token: 'backstage-token', autoSync: false }),
    })

    await handlers['postly:settings:set'](null, {
      key: 'backstage',
      value: { baseUrl: 'https://bs.example.com', token: '', hasToken: false, autoSync: false },
    })

    expect(mockRun).toHaveBeenCalledWith(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
      ['backstage', JSON.stringify({ baseUrl: 'https://bs.example.com', token: '', autoSync: false })],
    )
  })
})
