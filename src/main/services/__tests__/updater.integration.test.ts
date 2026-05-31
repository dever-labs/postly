/**
 * Integration tests for the enterprise update flow using Mockly as the
 * real HTTP update server.
 *
 * electron-updater cannot run in a Node test environment (it requires a
 * packaged Electron app). We replace it via __setAutoUpdaterForTesting with
 * a lightweight HTTP shim that makes real network requests to a Mockly server
 * and fires the same events electron-updater would. This lets us exercise the
 * full event-forwarding pipeline against a real HTTP server.
 *
 * Scenarios covered:
 *   • Update available    — server returns a newer version in latest.yml
 *   • No update           — server returns the current version
 *   • Server errors       — 404, 503, connection refused
 *   • Download flow       — manifest fetch → binary fetch → downloaded event
 *   • Download progress   — progress event fires mid-download
 *   • Fault injection     — slow server, all-503 scenario
 *   • Enterprise URL      — applyFeedUrl() correctly routes requests
 *   • Enterprise config   — getEnterpriseConfig() reads enterprise.json from disk
 *
 * Prerequisites: run `node scripts/download-mockly.mjs` to download the binary.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'
import os from 'os'
import fs from 'fs'
import path from 'path'
import type { BrowserWindow } from 'electron'
import { MocklyServer, getFreePort } from './helpers/mockly'
import type { UpdaterEvent } from '../updater'

// ─── Mock electron ─────────────────────────────────────────────────────────────
//
// isPackaged = true so that initUpdater registers listeners and
// applyFeedUrl / checkForUpdates use the real (shim) code path.

const CURRENT_VERSION = '1.0.0'

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: vi.fn(() => CURRENT_VERSION),
  },
  BrowserWindow: vi.fn(),
}))

// ─── Real-HTTP autoUpdater shim ─────────────────────────────────────────────────
//
// Implements the same interface as electron-updater's autoUpdater. Instead of
// talking to GitHub (or any provider) via native Electron code, it makes plain
// fetch() calls against whatever URL was set via setFeedURL(). Events are fired
// in the same sequence as electron-updater would fire them, so the service's
// event-forwarding logic is exercised end-to-end.

type EventHandler = (...args: unknown[]) => void

class RealHttpAutoUpdater {
  autoDownload = false
  autoInstallOnAppQuit = false
  logger: unknown = null

  private feedUrl = ''
  private handlers: Record<string, EventHandler[]> = {}

  on(event: string, handler: EventHandler): void {
    (this.handlers[event] ??= []).push(handler)
  }

  setFeedURL(opts: Record<string, unknown>): void {
    if (typeof opts.url === 'string') {
      this.feedUrl = opts.url.replace(/\/$/, '')
    } else if (opts.provider === 'github') {
      // GitHub provider — mark as such; real download path not tested here
      this.feedUrl = '__github__'
    }
  }

  getConfiguredUrl(): string {
    return this.feedUrl
  }

  async checkForUpdates(): Promise<void> {
    // 'checking-for-update' fires before the HTTP round-trip (mirrors real behaviour)
    this._emit('checking-for-update')

    if (!this.feedUrl || this.feedUrl === '__github__') {
      this._emit('update-not-available', { version: CURRENT_VERSION })
      return
    }

    let res: Response
    try {
      res = await fetch(`${this.feedUrl}/latest.yml`, { signal: AbortSignal.timeout(5000) })
    } catch (err) {
      this._emit('error', err instanceof Error ? err : new Error(String(err)))
      return
    }

    if (!res.ok) {
      this._emit('error', new Error(`Update server returned HTTP ${res.status}`))
      return
    }

    try {
      const text = await res.text()
      const version = (text.match(/^version:\s*(.+)/m)?.[1] ?? '').trim()

      if (version && version !== CURRENT_VERSION) {
        this._emit('update-available', { version })
      } else {
        this._emit('update-not-available', { version })
      }
    } catch (err) {
      this._emit('error', err instanceof Error ? err : new Error(String(err)))
    }
  }

  async downloadUpdate(): Promise<void> {
    if (!this.feedUrl || this.feedUrl === '__github__') return

    let res: Response
    try {
      res = await fetch(`${this.feedUrl}/latest.yml`)
    } catch (err) {
      this._emit('error', err instanceof Error ? err : new Error(String(err)))
      return
    }

    if (!res.ok) {
      this._emit('error', new Error(`Manifest fetch failed: HTTP ${res.status}`))
      return
    }

    const text = await res.text()
    const filename = (text.match(/^path:\s*(.+)/m)?.[1] ?? '').trim()
    const version = (text.match(/^version:\s*(.+)/m)?.[1] ?? '').trim()

    if (!filename) {
      this._emit('error', new Error('No path field in update manifest'))
      return
    }

    this._emit('download-progress', { percent: 50 })

    let fileRes: Response
    try {
      fileRes = await fetch(`${this.feedUrl}/${filename}`)
    } catch (err) {
      this._emit('error', err instanceof Error ? err : new Error(String(err)))
      return
    }

    if (!fileRes.ok) {
      this._emit('error', new Error(`Binary download failed: HTTP ${fileRes.status}`))
      return
    }

    this._emit('update-downloaded', { version })
  }

  quitAndInstall(_isSilent: boolean, _isForceRunAfter: boolean): void {
    /* no-op in tests */
  }

  private _emit(event: string, ...args: unknown[]): void {
    this.handlers[event]?.forEach((h) => h(...args))
  }
}

// ─── Event capture ─────────────────────────────────────────────────────────────
//
// Events emitted via win.webContents.send('postly:updater:event', payload) are
// buffered. waitForEvent() dequeues the first matching event or waits for one
// to arrive, whichever comes first.

const eventQueue: UpdaterEvent[] = []
const eventWaiters: Array<{
  type: UpdaterEvent['type']
  resolve: (e: UpdaterEvent) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}> = []

function captureEvent(event: UpdaterEvent): void {
  const idx = eventWaiters.findIndex((w) => w.type === event.type)
  if (idx >= 0) {
    const [waiter] = eventWaiters.splice(idx, 1)
    clearTimeout(waiter.timer)
    waiter.resolve(event)
  } else {
    eventQueue.push(event)
  }
}

function waitForEvent(type: UpdaterEvent['type'], timeoutMs = 5000): Promise<UpdaterEvent> {
  const existing = eventQueue.findIndex((e) => e.type === type)
  if (existing >= 0) {
    return Promise.resolve(eventQueue.splice(existing, 1)[0])
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const i = eventWaiters.findIndex((w) => w.resolve === resolve)
      if (i >= 0) eventWaiters.splice(i, 1)
      reject(new Error(`Timed out waiting for updater event: ${type}`))
    }, timeoutMs)
    eventWaiters.push({ type, resolve, reject, timer })
  })
}

// ─── Mock BrowserWindow ────────────────────────────────────────────────────────

const mockWebContentsSend = vi.fn().mockImplementation((channel: string, data: unknown) => {
  if (channel === 'postly:updater:event') captureEvent(data as UpdaterEvent)
})

const mockWin = {
  webContents: { send: mockWebContentsSend },
  isDestroyed: vi.fn().mockReturnValue(false),
} as unknown as BrowserWindow

// ─── latest.yml builder ─────────────────────────────────────────────────────────

function makeLatestYml(version: string, filename = `postly-${version}.zip`): string {
  return [
    `version: ${version}`,
    `files:`,
    `  - url: ${filename}`,
    `    sha512: abc123def456abc123def456`,
    `    size: 104857600`,
    `path: ${filename}`,
    `sha512: abc123def456abc123def456`,
    `releaseDate: '2025-01-01T00:00:00.000Z'`,
  ].join('\n')
}

// ─── Module references (populated in beforeAll) ────────────────────────────────

let applyFeedUrl: (url: string | undefined) => void
let checkForUpdates: () => void
let downloadUpdate: () => void
let getEnterpriseConfig: () => { updateUrl?: string }
let shim: RealHttpAutoUpdater
let server: MocklyServer

// ─── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  server = await MocklyServer.create({
    scenarios: [
      {
        id: 'server-down',
        name: 'Update server returns 503',
        patches: [{ mock_id: 'latest-yml', status: 503, body: 'Service Unavailable' }],
      },
    ],
  })

  shim = new RealHttpAutoUpdater()

  // Dynamic import ensures the electron mock is active before the module loads
  const mod = await import('../updater')
  mod.__setAutoUpdaterForTesting(shim as never)
  mod.initUpdater(mockWin)

  applyFeedUrl = mod.applyFeedUrl
  checkForUpdates = mod.checkForUpdates
  downloadUpdate = mod.downloadUpdate
  getEnterpriseConfig = mod.getEnterpriseConfig
}, 30_000)

afterAll(() => server?.stop())

beforeEach(async () => {
  eventQueue.length = 0
  eventWaiters.length = 0
  mockWebContentsSend.mockClear()
  await server.reset()
})

// ─── Update availability ────────────────────────────────────────────────────────

describe('update available', () => {
  it('fires checking then available when server returns newer version', async () => {
    await server.addMock({
      id: 'latest-yml',
      request: { method: 'GET', path: '/latest.yml' },
      response: {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
        body: makeLatestYml('2.0.0'),
      },
    })

    applyFeedUrl(server.httpBase)
    checkForUpdates()

    const checking = await waitForEvent('checking')
    expect(checking.type).toBe('checking')

    const available = await waitForEvent('available')
    expect(available.type).toBe('available')
    expect(available.version).toBe('2.0.0')
  })

  it('includes the version from the manifest in the available event', async () => {
    await server.addMock({
      id: 'latest-yml',
      request: { method: 'GET', path: '/latest.yml' },
      response: {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
        body: makeLatestYml('3.1.4'),
      },
    })

    applyFeedUrl(server.httpBase)
    checkForUpdates()

    const available = await waitForEvent('available')
    expect(available.version).toBe('3.1.4')
  })
})

// ─── No update available ────────────────────────────────────────────────────────

describe('no update available', () => {
  it('fires checking then not-available when server returns current version', async () => {
    await server.addMock({
      id: 'latest-yml',
      request: { method: 'GET', path: '/latest.yml' },
      response: {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
        body: makeLatestYml(CURRENT_VERSION),
      },
    })

    applyFeedUrl(server.httpBase)
    checkForUpdates()

    const checking = await waitForEvent('checking')
    expect(checking.type).toBe('checking')

    const notAvailable = await waitForEvent('not-available')
    expect(notAvailable.type).toBe('not-available')
  })
})

// ─── Server error handling ──────────────────────────────────────────────────────

describe('server error handling', () => {
  it('fires error event when latest.yml returns 404', async () => {
    await server.addMock({
      id: 'latest-yml-404',
      request: { method: 'GET', path: '/404/latest.yml' },
      response: { status: 404, body: 'Not Found' },
    })

    applyFeedUrl(`${server.httpBase}/404`)
    checkForUpdates()

    const error = await waitForEvent('error')
    expect(error.type).toBe('error')
    expect(error.error).toMatch(/404/)
  })

  it('fires error event when server returns 503', async () => {
    await server.addMock({
      id: 'latest-yml',
      request: { method: 'GET', path: '/latest.yml' },
      response: { status: 503, body: 'Service Unavailable' },
    })

    applyFeedUrl(server.httpBase)
    checkForUpdates()

    const error = await waitForEvent('error')
    expect(error.type).toBe('error')
    expect(error.error).toMatch(/503/)
  })

  it('fires error event when server is unreachable (connection refused)', async () => {
    const deadPort = await getFreePort()

    applyFeedUrl(`http://127.0.0.1:${deadPort}`)
    checkForUpdates()

    const error = await waitForEvent('error')
    expect(error.type).toBe('error')
    expect(error.error).toBeTruthy()
  })
})

// ─── Fault injection ───────────────────────────────────────────────────────────

describe('fault injection', () => {
  it('fires error event when scenario activates 503 on the update endpoint', async () => {
    // 'latest-yml' mock must exist for the scenario patch to apply
    await server.addMock({
      id: 'latest-yml',
      request: { method: 'GET', path: '/latest.yml' },
      response: {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
        body: makeLatestYml('2.0.0'),
      },
    })

    // Without scenario: update is available
    applyFeedUrl(server.httpBase)
    checkForUpdates()
    const first = await waitForEvent('available')
    expect(first.version).toBe('2.0.0')

    // Activate the server-down scenario
    await server.activateScenario('server-down')

    checkForUpdates()
    const error = await waitForEvent('error')
    expect(error.type).toBe('error')
    expect(error.error).toMatch(/503/)
  })

  it('still returns update event when server adds a small delay', async () => {
    await server.addMock({
      id: 'latest-yml',
      request: { method: 'GET', path: '/latest.yml' },
      response: {
        status: 200,
        delay: '100ms',
        headers: { 'Content-Type': 'text/plain' },
        body: makeLatestYml('2.0.0'),
      },
    })

    applyFeedUrl(server.httpBase)
    checkForUpdates()

    const available = await waitForEvent('available', 6000)
    expect(available.version).toBe('2.0.0')
  })
})

// ─── Update download flow ───────────────────────────────────────────────────────

describe('downloadUpdate', () => {
  it('fetches binary from update server and fires downloaded event', async () => {
    const version = '2.0.0'
    const filename = `postly-${version}.zip`

    await server.addMock({
      id: 'latest-yml',
      request: { method: 'GET', path: '/latest.yml' },
      response: {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
        body: makeLatestYml(version, filename),
      },
    })

    await server.addMock({
      id: 'binary',
      request: { method: 'GET', path: `/${filename}` },
      response: {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
        body: 'binary-content',
      },
    })

    applyFeedUrl(server.httpBase)
    downloadUpdate()

    const progress = await waitForEvent('progress')
    expect(progress.type).toBe('progress')
    expect(progress.percent).toBe(50)

    const downloaded = await waitForEvent('downloaded')
    expect(downloaded.type).toBe('downloaded')
    expect(downloaded.version).toBe(version)
  })

  it('fires error event when binary is not found on server', async () => {
    const version = '2.0.0'
    const filename = `postly-${version}.zip`

    await server.addMock({
      id: 'latest-yml',
      request: { method: 'GET', path: '/latest.yml' },
      response: {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
        body: makeLatestYml(version, filename),
      },
    })

    await server.addMock({
      id: 'binary-missing',
      request: { method: 'GET', path: `/${filename}` },
      response: { status: 404, body: 'Not Found' },
    })

    applyFeedUrl(server.httpBase)
    downloadUpdate()

    const error = await waitForEvent('error')
    expect(error.type).toBe('error')
    expect(error.error).toMatch(/404/)
  })

  it('fires error event when manifest returns 404 during download', async () => {
    await server.addMock({
      id: 'latest-yml-missing',
      request: { method: 'GET', path: '/missing/latest.yml' },
      response: { status: 404, body: 'Not Found' },
    })

    applyFeedUrl(`${server.httpBase}/missing`)
    downloadUpdate()

    const error = await waitForEvent('error')
    expect(error.type).toBe('error')
    expect(error.error).toMatch(/404/)
  })

  it('verifies update server received the manifest and binary requests', async () => {
    const version = '2.1.0'
    const filename = `postly-${version}.zip`

    await server.addMock({
      id: 'latest-yml',
      request: { method: 'GET', path: '/latest.yml' },
      response: {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
        body: makeLatestYml(version, filename),
      },
    })
    await server.addMock({
      id: 'binary',
      request: { method: 'GET', path: `/${filename}` },
      response: {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
        body: 'fake-binary',
      },
    })

    applyFeedUrl(server.httpBase)
    downloadUpdate()
    await waitForEvent('downloaded')

    const manifestCalls = await server.getCalls('latest-yml')
    expect(manifestCalls.count).toBeGreaterThanOrEqual(1)

    const binaryCalls = await server.getCalls('binary')
    expect(binaryCalls.count).toBe(1)
    expect(binaryCalls.calls[0].path).toBe(`/${filename}`)
  })
})

// ─── Enterprise URL routing ─────────────────────────────────────────────────────

describe('enterprise URL routing', () => {
  it('routes update checks to the configured enterprise server URL', async () => {
    await server.addMock({
      id: 'latest-yml',
      request: { method: 'GET', path: '/latest.yml' },
      response: {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
        body: makeLatestYml('2.0.0'),
      },
    })

    applyFeedUrl(server.httpBase)
    checkForUpdates()
    await waitForEvent('available')

    const calls = await server.getCalls('latest-yml')
    expect(calls.count).toBeGreaterThanOrEqual(1)
  })

  it('reverts to GitHub provider (not the enterprise server) when URL is cleared', () => {
    applyFeedUrl(undefined)

    // Shim records provider=github as '__github__' — no requests to our server
    expect(shim.getConfiguredUrl()).toBe('__github__')
  })

  it('updates the feed URL when applyFeedUrl is called again', async () => {
    // First URL
    await server.addMock({
      id: 'latest-yml',
      request: { method: 'GET', path: '/latest.yml' },
      response: {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
        body: makeLatestYml('2.0.0'),
      },
    })

    applyFeedUrl(server.httpBase)
    expect(shim.getConfiguredUrl()).toBe(server.httpBase)

    // Switch to a dead URL
    applyFeedUrl('http://127.0.0.1:1')
    expect(shim.getConfiguredUrl()).toBe('http://127.0.0.1:1')
  })

  it('enterprise mirror request includes the correct path (latest.yml)', async () => {
    await server.addMock({
      id: 'latest-yml',
      request: { method: 'GET', path: '/latest.yml' },
      response: {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
        body: makeLatestYml('2.0.0'),
      },
    })

    applyFeedUrl(server.httpBase)
    checkForUpdates()
    await waitForEvent('available')

    const calls = await server.getCalls('latest-yml')
    const call = calls.calls[0]
    expect(call.path).toBe('/latest.yml')
    expect(call.method).toBe('GET')
  })
})

// ─── getEnterpriseConfig file reading ──────────────────────────────────────────

describe('getEnterpriseConfig — real filesystem', () => {
  let tmpDir: string
  let originalResourcesPath: string | undefined

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'postly-enterprise-test-'))
    originalResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  })

  afterEach(() => {
    ;(process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = originalResourcesPath
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns the updateUrl from enterprise.json when resourcesPath is set', () => {
    const config = { updateUrl: 'https://updates.internal.corp/postly/' }
    fs.writeFileSync(path.join(tmpDir, 'enterprise.json'), JSON.stringify(config))
    ;(process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = tmpDir

    const result = getEnterpriseConfig()

    expect(result.updateUrl).toBe('https://updates.internal.corp/postly/')
  })

  it('returns empty config when enterprise.json does not exist', () => {
    ;(process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = tmpDir
    // No enterprise.json written

    const result = getEnterpriseConfig()

    expect(result).toEqual({})
  })

  it('returns empty config when enterprise.json contains malformed JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'enterprise.json'), '{ invalid json }')
    ;(process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = tmpDir

    const result = getEnterpriseConfig()

    expect(result).toEqual({})
  })

  it('returns empty config when resourcesPath is not set', () => {
    ;(process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = undefined

    const result = getEnterpriseConfig()

    expect(result).toEqual({})
  })

  it('applies the enterprise URL to the update feed when config is present', async () => {
    await server.addMock({
      id: 'latest-yml',
      request: { method: 'GET', path: '/latest.yml' },
      response: {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
        body: makeLatestYml('2.0.0'),
      },
    })

    // Write enterprise config pointing to our mockly server
    const config = { updateUrl: server.httpBase }
    fs.writeFileSync(path.join(tmpDir, 'enterprise.json'), JSON.stringify(config))
    ;(process as NodeJS.Process & { resourcesPath?: string }).resourcesPath = tmpDir

    const enterprise = getEnterpriseConfig()
    applyFeedUrl(enterprise.updateUrl)
    checkForUpdates()

    const available = await waitForEvent('available')
    expect(available.version).toBe('2.0.0')

    // The mockly server was hit via the enterprise URL
    const calls = await server.getCalls('latest-yml')
    expect(calls.count).toBeGreaterThanOrEqual(1)
  })
})
