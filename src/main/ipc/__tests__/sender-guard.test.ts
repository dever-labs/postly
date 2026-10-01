import { describe, it, expect, vi, beforeEach } from 'vitest'

const state: { registered: Record<string, (ev: unknown, ...a: unknown[]) => unknown>; handle: unknown } = {
  registered: {},
  handle: null
}

vi.mock('electron', () => {
  const ipcMain = {
    handle: (ch: string, fn: (ev: unknown, ...a: unknown[]) => unknown) => {
      state.registered[ch] = fn
    }
  }
  return { ipcMain }
})

import { ipcMain } from 'electron'
import { isTrustedSenderUrl, installIpcSenderGuard } from '../sender-guard'

describe('isTrustedSenderUrl', () => {
  it('accepts packaged file:// pages', () => {
    expect(isTrustedSenderUrl('file:///app/out/renderer/index.html', undefined)).toBe(true)
  })
  it('accepts only the dev server origin', () => {
    expect(isTrustedSenderUrl('http://localhost:5173/', 'http://localhost:5173')).toBe(true)
    expect(isTrustedSenderUrl('http://localhost:5174/', 'http://localhost:5173')).toBe(false)
  })
  it('rejects remote and malformed URLs', () => {
    expect(isTrustedSenderUrl('https://evil.example.com/', undefined)).toBe(false)
    expect(isTrustedSenderUrl('', undefined)).toBe(false)
    expect(isTrustedSenderUrl('not a url', 'http://localhost:5173')).toBe(false)
  })
})

describe('installIpcSenderGuard', () => {
  beforeEach(() => {
    state.registered = {}
    installIpcSenderGuard()
  })

  it('passes calls from trusted frames to the handler', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    ipcMain.handle('x', fn)
    const ev = { senderFrame: { url: 'file:///app/index.html' } }
    await expect(state.registered['x'](ev, 1, 2)).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledWith(ev, 1, 2)
  })

  it('blocks calls from untrusted frames', () => {
    const fn = vi.fn()
    ipcMain.handle('y', fn)
    expect(() => state.registered['y']({ senderFrame: { url: 'https://evil.example.com' } })).toThrow(/untrusted/)
    expect(() => state.registered['y']({ senderFrame: null })).toThrow(/untrusted/)
    expect(fn).not.toHaveBeenCalled()
  })
})
