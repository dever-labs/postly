import { describe, it, expect, vi, beforeEach } from 'vitest'

const openExternal = vi.fn()
vi.mock('electron', () => ({ shell: { openExternal: (...a: unknown[]) => openExternal(...a) } }))

import { isSafeExternalUrl, isAppNavigation, openExternalSafe, lockDownWindow, SECURE_WEB_PREFERENCES } from '../security'

beforeEach(() => {
  openExternal.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('isSafeExternalUrl', () => {
  it.each(['https://example.com/a?b=1', 'http://localhost:3000'])('allows %s', (url) => {
    expect(isSafeExternalUrl(url)).toBe(true)
  })
  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'ms-msdt:/id', 'smb://host/share', 'not a url', ''])('refuses %s', (url) => {
    expect(isSafeExternalUrl(url)).toBe(false)
  })
})

describe('openExternalSafe', () => {
  it('opens http(s) URLs', () => {
    openExternalSafe('https://example.com')
    expect(openExternal).toHaveBeenCalledWith('https://example.com')
  })
  it('refuses other schemes', () => {
    openExternalSafe('file:///C:/Windows/System32/calc.exe')
    expect(openExternal).not.toHaveBeenCalled()
  })
})

describe('isAppNavigation', () => {
  it('matches the dev-server origin', () => {
    expect(isAppNavigation('http://localhost:5173/some/path', 'http://localhost:5173')).toBe(true)
    expect(isAppNavigation('http://localhost:5174/', 'http://localhost:5173')).toBe(false)
    expect(isAppNavigation('https://evil.example', 'http://localhost:5173')).toBe(false)
  })
  it('matches only the packaged index.html for file: URLs', () => {
    const app = 'file:///opt/postly/renderer/index.html'
    expect(isAppNavigation('file:///opt/postly/renderer/index.html', app)).toBe(true)
    expect(isAppNavigation('file:///etc/passwd', app)).toBe(false)
    expect(isAppNavigation('https://evil.example', app)).toBe(false)
  })
  it('treats malformed URLs as external', () => {
    expect(isAppNavigation('nope', 'http://localhost:5173')).toBe(false)
  })
})

describe('lockDownWindow', () => {
  function setup() {
    let openHandler!: (d: { url: string }) => { action: string }
    let navHandler!: (e: { preventDefault: () => void }, url: string) => void
    const win = {
      webContents: {
        setWindowOpenHandler: (h: typeof openHandler) => { openHandler = h },
        on: (ev: string, h: typeof navHandler) => { if (ev === 'will-navigate') navHandler = h },
      },
    }
    lockDownWindow(win as never, 'http://localhost:5173')
    return { openHandler, navHandler }
  }

  it('denies new windows and opens only safe URLs externally', () => {
    const { openHandler } = setup()
    expect(openHandler({ url: 'https://example.com' })).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledWith('https://example.com')
    openExternal.mockReset()
    expect(openHandler({ url: 'file:///etc/passwd' })).toEqual({ action: 'deny' })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('blocks navigation away from the app and lets app navigation through', () => {
    const { navHandler } = setup()
    const blocked = { preventDefault: vi.fn() }
    navHandler(blocked, 'https://example.com')
    expect(blocked.preventDefault).toHaveBeenCalled()
    expect(openExternal).toHaveBeenCalledWith('https://example.com')

    const allowed = { preventDefault: vi.fn() }
    navHandler(allowed, 'http://localhost:5173/')
    expect(allowed.preventDefault).not.toHaveBeenCalled()
  })
})

describe('SECURE_WEB_PREFERENCES', () => {
  it('enforces sandbox + context isolation without node integration', () => {
    expect(SECURE_WEB_PREFERENCES).toEqual({ nodeIntegration: false, contextIsolation: true, sandbox: true })
  })
})
