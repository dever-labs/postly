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
  applyFeedUrl: vi.fn(),
  getEnterpriseConfig: vi.fn().mockReturnValue({}),
}))

import { registerUpdaterHandlers } from '../updater'
import {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  applyFeedUrl,
  getEnterpriseConfig,
} from '../../services/updater'

const mockCheck = vi.mocked(checkForUpdates)
const mockDownload = vi.mocked(downloadUpdate)
const mockInstall = vi.mocked(installUpdate)
const mockApplyFeed = vi.mocked(applyFeedUrl)
const mockGetEnterprise = vi.mocked(getEnterpriseConfig)

beforeEach(() => {
  vi.clearAllMocks()
  mockGetEnterprise.mockReturnValue({})
  Object.keys(state.handlers).forEach((k) => delete state.handlers[k])
  registerUpdaterHandlers()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('registerUpdaterHandlers', () => {
  it('registers all five IPC channels', () => {
    expect(state.handlers).toHaveProperty('postly:updater:check')
    expect(state.handlers).toHaveProperty('postly:updater:download')
    expect(state.handlers).toHaveProperty('postly:updater:install')
    expect(state.handlers).toHaveProperty('postly:updater:set-feed')
    expect(state.handlers).toHaveProperty('postly:updater:get-enterprise-config')
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
    it('calls applyFeedUrl with provided url when no enterprise config', async () => {
      const result = await state.handlers['postly:updater:set-feed'](null, { url: 'https://updates.example.com' })
      expect(mockApplyFeed).toHaveBeenCalledWith('https://updates.example.com')
      expect(result).toEqual({ data: true })
    })

    it('passes undefined to applyFeedUrl when url is empty (reverts to GitHub)', async () => {
      await state.handlers['postly:updater:set-feed'](null, { url: '' })
      expect(mockApplyFeed).toHaveBeenCalledWith(undefined)
    })

    it('skips applyFeedUrl when enterprise config is active', async () => {
      mockGetEnterprise.mockReturnValueOnce({ updateUrl: 'https://corp.internal/postly/' })
      await state.handlers['postly:updater:set-feed'](null, { url: 'https://other.com' })
      expect(mockApplyFeed).not.toHaveBeenCalled()
    })

    it('returns { error } when applyFeedUrl throws', async () => {
      mockApplyFeed.mockImplementationOnce(() => { throw new Error('bad url') })
      const result = await state.handlers['postly:updater:set-feed'](null, { url: 'bad' })
      expect(result).toEqual({ error: 'Error: bad url' })
    })
  })

  describe('postly:updater:get-enterprise-config', () => {
    it('returns the enterprise config', async () => {
      mockGetEnterprise.mockReturnValueOnce({ updateUrl: 'https://corp.internal/postly/' })
      const result = await state.handlers['postly:updater:get-enterprise-config'](null)
      expect(result).toEqual({ data: { updateUrl: 'https://corp.internal/postly/' } })
    })

    it('returns empty object when no enterprise config', async () => {
      const result = await state.handlers['postly:updater:get-enterprise-config'](null)
      expect(result).toEqual({ data: {} })
    })
  })
})
