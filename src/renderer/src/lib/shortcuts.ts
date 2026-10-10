/**
 * Central shortcut registry. Every shortcut is defined here; components attach behaviour
 * with `useShortcut(id, handler)` and a single window listener dispatches (see hooks/useShortcuts.ts).
 *
 * Scopes decide where a shortcut may fire so it never shadows editing:
 *  - global: everywhere, including inside Monaco (Save, Command palette — Monaco's Ctrl+K is a chord prefix)
 *  - app:    in the app and in plain text inputs, but not inside Monaco, whose own bindings win
 *            (e.g. Ctrl+Enter inserts a line, Ctrl+/ toggles a comment)
 *  - idle:   only when no text field or editor has focus (Undo, Back/Forward, "?")
 */
export type ShortcutScope = 'global' | 'app' | 'idle'
export type ShortcutGroup = 'Requests' | 'Navigation' | 'General'

export interface Combo {
  key: string
  /** Cmd on macOS, Ctrl elsewhere */
  mod?: boolean
  shift?: boolean
  alt?: boolean
}

export interface ShortcutDef {
  id: ShortcutId
  label: string
  group: ShortcutGroup
  scope: ShortcutScope
  combos: Combo[]
}

export type ShortcutId =
  | 'send' | 'cancel' | 'new-request' | 'save' | 'undo' | 'focus-url'
  | 'palette' | 'back' | 'forward' | 'help' | 'settings' | 'focus-search'
  | 'prev-request' | 'next-request' | 'toggle-sidebar'

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'send', label: 'Send request', group: 'Requests', scope: 'app', combos: [{ key: 'Enter', mod: true }] },
  { id: 'cancel', label: 'Cancel in-flight request', group: 'Requests', scope: 'app', combos: [{ key: 'Escape' }] },
  { id: 'new-request', label: 'New request', group: 'Requests', scope: 'app', combos: [{ key: 'n', mod: true }] },
  { id: 'save', label: 'Save request', group: 'Requests', scope: 'global', combos: [{ key: 's', mod: true }] },
  { id: 'undo', label: 'Undo unsaved edit', group: 'Requests', scope: 'idle', combos: [{ key: 'z', mod: true }] },
  { id: 'focus-url', label: 'Focus URL bar', group: 'Requests', scope: 'app', combos: [{ key: 'l', mod: true }] },
  { id: 'focus-search', label: 'Search the sidebar', group: 'Navigation', scope: 'app', combos: [{ key: 'f', mod: true, shift: true }] },
  { id: 'prev-request', label: 'Previous request in working set', group: 'Navigation', scope: 'idle', combos: [{ key: 'ArrowUp', alt: true }] },
  { id: 'next-request', label: 'Next request in working set', group: 'Navigation', scope: 'idle', combos: [{ key: 'ArrowDown', alt: true }] },
  { id: 'toggle-sidebar', label: 'Toggle sidebar', group: 'Navigation', scope: 'app', combos: [{ key: 'b', mod: true }] },
  { id: 'palette', label: 'Command palette', group: 'Navigation', scope: 'global', combos: [{ key: 'k', mod: true }] },
  { id: 'back', label: 'Back', group: 'Navigation', scope: 'idle', combos: [{ key: 'ArrowLeft', alt: true }] },
  { id: 'forward', label: 'Forward', group: 'Navigation', scope: 'idle', combos: [{ key: 'ArrowRight', alt: true }] },
  { id: 'settings', label: 'Open settings', group: 'General', scope: 'app', combos: [{ key: ',', mod: true }] },
  { id: 'help', label: 'Keyboard shortcuts', group: 'General', scope: 'app', combos: [{ key: '/', mod: true }] },
  // `?` is a typed character, so it only works when nothing is focused for typing
  { id: 'help', label: 'Keyboard shortcuts', group: 'General', scope: 'idle', combos: [{ key: '?', shift: true }] },
]

type KeyEventLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>

export function comboMatches(e: KeyEventLike, combo: Combo, isMac: boolean): boolean {
  if (e.key.toLowerCase() !== combo.key.toLowerCase()) return false
  const modDown = isMac ? e.metaKey : e.ctrlKey
  const otherMod = isMac ? e.ctrlKey : e.metaKey
  if (!!combo.mod !== modDown || otherMod) return false
  if (!!combo.alt !== e.altKey) return false
  // Shift is only significant for combos that name it; characters like "?" imply it
  return !!combo.shift === e.shiftKey
}

export function findShortcut(e: KeyEventLike, isMac: boolean): ShortcutDef | undefined {
  return SHORTCUTS.find((s) => s.combos.some((c) => comboMatches(e, c, isMac)))
}

export type FocusKind = 'editor' | 'text' | 'other'

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'])

export function focusKind(target: EventTarget | null): FocusKind {
  const el = target as Partial<HTMLElement> | null
  if (!el || typeof el.closest !== 'function') return 'other'
  if (el.closest('.monaco-editor')) return 'editor'
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) return 'text'
  if (el.tagName === 'INPUT') return NON_TEXT_INPUTS.has((el as HTMLInputElement).type) ? 'other' : 'text'
  return 'other'
}

export function scopeAllows(scope: ShortcutScope, kind: FocusKind): boolean {
  if (scope === 'global') return true
  if (scope === 'app') return kind !== 'editor'
  return kind === 'other'
}

const KEY_LABELS: Record<string, string> = { Escape: 'Esc', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' }

export function formatCombo(combo: Combo, isMac: boolean): string {
  // Shift is implied by typed symbols like "?", so only name it for letters, digits and named keys
  const showShift = !!combo.shift && (combo.key.length > 1 || /^[a-z0-9]$/i.test(combo.key))
  const key = KEY_LABELS[combo.key] ?? (combo.key.length === 1 ? combo.key.toUpperCase() : combo.key)
  if (isMac) return `${combo.alt ? '⌥' : ''}${showShift ? '⇧' : ''}${combo.mod ? '⌘' : ''}${key}`
  return [combo.mod && 'Ctrl', combo.alt && 'Alt', showShift && 'Shift', key].filter(Boolean).join('+')
}

/** Display strings for a shortcut, one per combo. */
export function shortcutLabels(id: ShortcutId, isMac: boolean): string[] {
  return SHORTCUTS.filter((s) => s.id === id).flatMap((s) => s.combos.map((c) => formatCombo(c, isMac)))
}

/** One row per shortcut id (alternative combos are merged), grouped for the cheat-sheet. */
export function cheatSheet(isMac: boolean): { group: ShortcutGroup; rows: { id: ShortcutId; label: string; keys: string[] }[] }[] {
  const order: ShortcutGroup[] = ['Requests', 'Navigation', 'General']
  const seen = new Set<ShortcutId>()
  const rows: { id: ShortcutId; label: string; group: ShortcutGroup; keys: string[] }[] = []
  for (const s of SHORTCUTS) {
    if (seen.has(s.id)) continue
    seen.add(s.id)
    rows.push({ id: s.id, label: s.label, group: s.group, keys: shortcutLabels(s.id, isMac) })
  }
  return order.map((group) => ({ group, rows: rows.filter((r) => r.group === group) }))
}
