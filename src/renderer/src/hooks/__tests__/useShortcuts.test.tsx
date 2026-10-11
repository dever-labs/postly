// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { useShortcutDispatcher, useShortcut } from '../useShortcuts'
import { useUIStore } from '@/store/ui'

function fire(key: string, init: KeyboardEventInit = {}, target: Element = document.body): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(e)
  return e
}

describe('shortcut dispatcher', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', { value: { platform: 'linux' }, configurable: true })
    useUIStore.setState({ settingsOpen: false, pendingGitAction: null, deletingCollectionId: null })
  })
  afterEach(() => { cleanup(); document.body.innerHTML = '' })

  function mount(id: 'send' | 'palette', handler: () => boolean) {
    return renderHook(() => { useShortcutDispatcher(); useShortcut(id, handler) })
  }

  it('runs the handler and swallows the key when handled', () => {
    const handler = vi.fn(() => true)
    mount('send', handler)
    const e = fire('Enter', { ctrlKey: true })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(e.defaultPrevented).toBe(true)
  })

  it('leaves the key alone when the handler returns false', () => {
    mount('send', () => false)
    expect(fire('Enter', { ctrlKey: true }).defaultPrevented).toBe(false)
  })

  it('does not fire app-scope shortcuts inside Monaco', () => {
    const handler = vi.fn(() => true)
    mount('send', handler)
    const monaco = document.createElement('div')
    monaco.className = 'monaco-editor'
    const area = document.createElement('textarea')
    monaco.appendChild(area)
    document.body.appendChild(monaco)
    fire('Enter', { ctrlKey: true }, area)
    expect(handler).not.toHaveBeenCalled()
  })

  it('blocks everything but the palette while a modal is open', () => {
    const send = vi.fn(() => true)
    const palette = vi.fn(() => true)
    renderHook(() => { useShortcutDispatcher(); useShortcut('send', send); useShortcut('palette', palette) })
    useUIStore.setState({ settingsOpen: true })
    fire('Enter', { ctrlKey: true })
    fire('k', { ctrlKey: true })
    expect(send).not.toHaveBeenCalled()
    expect(palette).toHaveBeenCalledTimes(1)
  })

  it('treats an aria-modal dialog as a modal', () => {
    const send = vi.fn(() => true)
    mount('send', send)
    const dlg = document.createElement('div')
    dlg.setAttribute('aria-modal', 'true')
    document.body.appendChild(dlg)
    fire('Enter', { ctrlKey: true })
    expect(send).not.toHaveBeenCalled()
  })

  it('stops dispatching after unmount', () => {
    const handler = vi.fn(() => true)
    const { unmount } = mount('send', handler)
    unmount()
    fire('Enter', { ctrlKey: true })
    expect(handler).not.toHaveBeenCalled()
  })
})
