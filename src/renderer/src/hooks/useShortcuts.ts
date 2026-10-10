import { useEffect, useRef } from 'react'
import { findShortcut, focusKind, scopeAllows, type ShortcutId } from '@/lib/shortcuts'
import { useUIStore } from '@/store/ui'

/** Return true when handled; false leaves the key to its normal behaviour. */
export type ShortcutHandler = (e: KeyboardEvent) => boolean

const handlers = new Map<ShortcutId, ShortcutHandler>()

/** Toggles stay reachable while a dialog is open so the same key can close it. */
const ALWAYS_ACTIVE: ShortcutId[] = ['palette', 'help']

export function isModalOpen(): boolean {
  const ui = useUIStore.getState()
  return ui.settingsOpen || !!ui.pendingGitAction || !!ui.deletingCollectionId || !!document.querySelector('[aria-modal="true"]')
}

/** The single keydown listener for the whole app. Mount once (AppShell). */
export function useShortcutDispatcher(): void {
  useEffect(() => {
    const isMac = window.api.platform === 'darwin'
    const onKeyDown = (e: KeyboardEvent) => {
      const def = findShortcut(e, isMac)
      if (!def || !scopeAllows(def.scope, focusKind(e.target))) return
      if (isModalOpen() && !ALWAYS_ACTIVE.includes(def.id)) return
      const handler = handlers.get(def.id)
      if (!handler) return
      if (!handler(e)) return
      e.preventDefault()
      e.stopPropagation()
    }
    // Capture phase so shortcuts win over Monaco's chords (Ctrl+K) and stopPropagation keeps them out of the editor
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
}

/** Attach behaviour to a registered shortcut. The latest handler is always used. */
export function useShortcut(id: ShortcutId, handler: ShortcutHandler): void {
  const ref = useRef(handler)
  ref.current = handler
  useEffect(() => {
    const stable: ShortcutHandler = (e) => ref.current(e)
    handlers.set(id, stable)
    return () => { if (handlers.get(id) === stable) handlers.delete(id) }
  }, [id])
}
