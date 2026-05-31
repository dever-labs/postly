import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Capture IPC handlers ─────────────────────────────────────────────────────

const state: { handlers: Record<string, (ev: unknown, args?: unknown) => Promise<unknown>> } = {
  handlers: {},
}

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((ch: string, fn: (ev: unknown, args?: unknown) => Promise<unknown>) => {
      state.handlers[ch] = fn
    }),
  },
}))

// ─── Mock updater service ─────────────────────────────────────────────────────

vi.mock('../../services/updater', () => ({
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  installUpdate: vi.fn(),
  setUpdateFeedUrl: vi.fn(),
}))

import { registerUpdaterHandlers } from '../updater'
import {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  setUpdateFeedUrl,
} from '../../services/updater'

const mockCheck = vi.mocked(checkForUpdates)
const mockDownload = vi.mocked(downloadUpdate)
const mockInstall = vi.mocked(installUpdate)
const mockSetFeed = vi.mocked(setUpdateFeedUrl)

beforeEach(() => {
  vi.clearAllMocks()
  Object.keys(state.handlers).forEach((k) => delete state.handlers[k])
  registerUpdaterHandlers()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('registerUpdaterHandlers', () => {
  it('registers all four IPC channels', () => {
    expect(state.handlers).toHaveProperty('postly:updater:check')
    expect(state.handlers).toHaveProperty('postly:updater:download')
    expect(state.handlers).toHaveProperty('postly:updater:install')
    expect(state.handlers).toHaveProperty('postly:updater:set-feed')
  })

  describe('postly:updater:check', () => {
    it('calls checkForUpdates and returns { data: true }', async () => {
      const result = await state.handlers['postly:updater:check'](null)
      expect(mockCheck).toHaveBeenCalledOnce()
      expect(result).toEqual({ data: true })
    })

    it('returns { error } when checkForUpdates throws', async () => {
      mockCheck.mockImplementationOnce(() => { throw new Error('check failed') })
      const result = await state.handlers['postly:updater:check'](null)
      expect(result).toEqual({ error: 'Error: check failed' })
    })
  })

  describe('postly:updater:download', () => {
    it('calls downloadUpdate and returns { data: true }', async () => {
      const result = await state.handlers['postly:updater:download'](null)
      expect(mockDownload).toHaveBeenCalledOnce()
      expect(result).toEqual({ data: true })
    })

    it('returns { error } when downloadUpdate throws', async () => {
      mockDownload.mockImplementationOnce(() => { throw new Error('download failed') })
      const result = await state.handlers['postly:updater:download'](null)
      expect(result).toEqual({ error: 'Error: download failed' })
    })
  })

  describe('postly:updater:install', () => {
    it('calls installUpdate and returns { data: true }', async () => {
      const result = await state.handlers['postly:updater:install'](null)
      expect(mockInstall).toHaveBeenCalledOnce()
      expect(result).toEqual({ data: true })
    })

    it('returns { error } when installUpdate throws', async () => {
      mockInstall.mockImplementationOnce(() => { throw new Error('install failed') })
      const result = await state.handlers['postly:updater:install'](null)
      expect(result).toEqual({ error: 'Error: install failed' })
    })
  })

  describe('postly:updater:set-feed', () => {
    it('calls setUpdateFeedUrl with the provided url', async () => {
      const result = await state.handlers['postly:updater:set-feed'](null, { url: 'https://updates.example.com' })
      expect(mockSetFeed).toHaveBeenCalledWith('https://updates.example.com')
      expect(result).toEqual({ data: true })
    })

    it('returns { error } when setUpdateFeedUrl throws', async () => {
      mockSetFeed.mockImplementationOnce(() => { throw new Error('bad url') })
      const result = await state.handlers['postly:updater:set-feed'](null, { url: 'bad' })
      expect(result).toEqual({ error: 'Error: bad url' })
    })
  })
})
