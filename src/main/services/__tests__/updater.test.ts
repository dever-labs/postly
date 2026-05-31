import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── Module-level state ───────────────────────────────────────────────────────
let isPackaged = false

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return isPackaged
    },
  },
}))

// ─── Fake BrowserWindow ───────────────────────────────────────────────────────

const mockSend = vi.fn()
const mockIsDestroyed = vi.fn().mockReturnValue(false)
const mockWin = { webContents: { send: mockSend }, isDestroyed: mockIsDestroyed }

// ─── Fake autoUpdater ─────────────────────────────────────────────────────────

const auListeners: Record<string, Array<(...args: unknown[]) => void>> = {}
const mockAutoUpdater = {
  autoDownload: true,
  autoInstallOnAppQuit: false,
  logger: undefined as unknown,
  on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    auListeners[event] = auListeners[event] ?? []
    auListeners[event].push(handler)
  }),
  checkForUpdates: vi.fn().mockResolvedValue(undefined),
  downloadUpdate: vi.fn().mockResolvedValue(undefined),
  quitAndInstall: vi.fn(),
  setFeedURL: vi.fn(),
}

function fireAuEvent(event: string, ...args: unknown[]) {
  for (const h of auListeners[event] ?? []) h(...args)
}

// ─── Import after mocks ───────────────────────────────────────────────────────

import {
  initUpdater,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  setUpdateFeedUrl,
  __setAutoUpdaterForTesting,
} from '../updater'

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockIsDestroyed.mockReturnValue(false)
  Object.keys(auListeners).forEach((k) => delete auListeners[k])
  mockAutoUpdater.on.mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
    auListeners[event] = auListeners[event] ?? []
    auListeners[event].push(handler)
  })
  __setAutoUpdaterForTesting(mockAutoUpdater)
})

afterEach(() => {
  vi.useRealTimers()
  __setAutoUpdaterForTesting(null)
})

// ─── Dev mode (not packaged) ──────────────────────────────────────────────────

describe('dev mode (not packaged)', () => {
  beforeEach(() => {
    isPackaged = false
    initUpdater(mockWin as never)
  })

  it('initUpdater does not configure autoUpdater', () => {
    expect(mockAutoUpdater.on).not.toHaveBeenCalled()
  })

  it('checkForUpdates emits "checking" immediately', () => {
    vi.useFakeTimers()
    checkForUpdates()
    expect(mockSend).toHaveBeenCalledWith('postly:updater:event', { type: 'checking' })
  })

  it('checkForUpdates emits "not-available" after 800ms', () => {
    vi.useFakeTimers()
    checkForUpdates()
    vi.advanceTimersByTime(800)
    expect(mockSend).toHaveBeenCalledWith('postly:updater:event', { type: 'not-available' })
  })

  it('checkForUpdates does not call autoUpdater.checkForUpdates', () => {
    vi.useFakeTimers()
    checkForUpdates()
    vi.advanceTimersByTime(800)
    expect(mockAutoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('downloadUpdate is a no-op', () => {
    downloadUpdate()
    expect(mockAutoUpdater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('installUpdate is a no-op', () => {
    installUpdate()
    expect(mockAutoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('setUpdateFeedUrl is a no-op', () => {
    setUpdateFeedUrl('https://updates.example.com')
    expect(mockAutoUpdater.setFeedURL).not.toHaveBeenCalled()
  })
})

// ─── Packaged mode ────────────────────────────────────────────────────────────

describe('packaged mode', () => {
  beforeEach(() => {
    isPackaged = true
    initUpdater(mockWin as never)
  })

  it('initUpdater disables auto-download', () => {
    expect(mockAutoUpdater.autoDownload).toBe(false)
  })

  it('initUpdater enables auto-install on quit', () => {
    expect(mockAutoUpdater.autoInstallOnAppQuit).toBe(true)
  })

  it('initUpdater registers all autoUpdater event listeners', () => {
    const events = mockAutoUpdater.on.mock.calls.map(([ev]) => ev)
    expect(events).toContain('checking-for-update')
    expect(events).toContain('update-available')
    expect(events).toContain('update-not-available')
    expect(events).toContain('download-progress')
    expect(events).toContain('update-downloaded')
    expect(events).toContain('error')
  })

  it('checkForUpdates delegates to autoUpdater', () => {
    checkForUpdates()
    expect(mockAutoUpdater.checkForUpdates).toHaveBeenCalledOnce()
  })

  it('downloadUpdate delegates to autoUpdater', () => {
    downloadUpdate()
    expect(mockAutoUpdater.downloadUpdate).toHaveBeenCalledOnce()
  })

  it('installUpdate calls quitAndInstall(false, true)', () => {
    installUpdate()
    expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('setUpdateFeedUrl calls setFeedURL with generic provider', () => {
    setUpdateFeedUrl('https://updates.example.com/postly/')
    expect(mockAutoUpdater.setFeedURL).toHaveBeenCalledWith({
      provider: 'generic',
      url: 'https://updates.example.com/postly/',
    })
  })

  describe('event forwarding to renderer', () => {
    it('forwards checking-for-update → { type: "checking" }', () => {
      fireAuEvent('checking-for-update')
      expect(mockSend).toHaveBeenCalledWith('postly:updater:event', { type: 'checking' })
    })

    it('forwards update-available → { type: "available", version }', () => {
      fireAuEvent('update-available', { version: '2.0.0' })
      expect(mockSend).toHaveBeenCalledWith('postly:updater:event', { type: 'available', version: '2.0.0' })
    })

    it('forwards update-not-available → { type: "not-available" }', () => {
      fireAuEvent('update-not-available')
      expect(mockSend).toHaveBeenCalledWith('postly:updater:event', { type: 'not-available' })
    })

    it('forwards download-progress → percent rounded to integer', () => {
      fireAuEvent('download-progress', { percent: 45.7 })
      expect(mockSend).toHaveBeenCalledWith('postly:updater:event', { type: 'progress', percent: 46 })
    })

    it('forwards update-downloaded → { type: "downloaded", version }', () => {
      fireAuEvent('update-downloaded', { version: '2.0.0' })
      expect(mockSend).toHaveBeenCalledWith('postly:updater:event', { type: 'downloaded', version: '2.0.0' })
    })

    it('forwards error → { type: "error", error: message }', () => {
      fireAuEvent('error', new Error('network timeout'))
      expect(mockSend).toHaveBeenCalledWith('postly:updater:event', { type: 'error', error: 'network timeout' })
    })

    it('does not emit to a destroyed window', () => {
      mockIsDestroyed.mockReturnValue(true)
      fireAuEvent('checking-for-update')
      expect(mockSend).not.toHaveBeenCalled()
    })
  })
})
