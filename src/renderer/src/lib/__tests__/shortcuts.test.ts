import { describe, it, expect } from 'vitest'
import { SHORTCUTS, comboMatches, findShortcut, focusKind, scopeAllows, formatCombo, shortcutLabels, cheatSheet } from '../shortcuts'

const ev = (key: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {}) =>
  ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods })

describe('matching', () => {
  it('uses Ctrl on Windows/Linux and Cmd on macOS', () => {
    expect(findShortcut(ev('Enter', { ctrlKey: true }), false)?.id).toBe('send')
    expect(findShortcut(ev('Enter', { metaKey: true }), false)).toBeUndefined()
    expect(findShortcut(ev('Enter', { metaKey: true }), true)?.id).toBe('send')
    expect(findShortcut(ev('Enter', { ctrlKey: true }), true)).toBeUndefined()
  })

  it('is case-insensitive for letters and does not match with extra modifiers', () => {
    expect(findShortcut(ev('S', { ctrlKey: true }), false)?.id).toBe('save')
    expect(findShortcut(ev('s', { ctrlKey: true, shiftKey: true }), false)).toBeUndefined()
    expect(findShortcut(ev('s', { ctrlKey: true, altKey: true }), false)).toBeUndefined()
  })

  it('matches plain and Alt keys, and ? only with shift', () => {
    expect(findShortcut(ev('Escape'), false)?.id).toBe('cancel')
    expect(findShortcut(ev('ArrowLeft', { altKey: true }), false)?.id).toBe('back')
    expect(findShortcut(ev('?', { shiftKey: true }), false)?.id).toBe('help')
    expect(comboMatches(ev('Escape', { ctrlKey: true }), { key: 'Escape' }, false)).toBe(false)
  })
})

describe('registry integrity', () => {
  it('has no two shortcuts bound to the same combination', () => {
    const seen = new Map<string, string>()
    for (const s of SHORTCUTS) {
      for (const c of s.combos) {
        const sig = JSON.stringify([c.key.toLowerCase(), !!c.mod, !!c.shift, !!c.alt])
        expect(seen.get(sig), `${s.id} duplicates ${seen.get(sig)}`).toBeUndefined()
        seen.set(sig, s.id)
      }
    }
  })

  it('keeps typed characters and editing keys out of text fields and Monaco', () => {
    const scope = (id: string) => SHORTCUTS.find((s) => s.id === id)?.scope
    expect(scope('undo')).toBe('idle')
    expect(scope('back')).toBe('idle')
    expect(scope('send')).toBe('app') // Monaco's Ctrl+Enter wins
    expect(scope('palette')).toBe('global')
    expect(scope('save')).toBe('global')
    for (const s of SHORTCUTS.filter((x) => x.combos.some((c) => c.key === '?'))) expect(s.scope).toBe('idle')
  })
})

describe('scopes', () => {
  it('global fires everywhere, app skips Monaco, idle needs no text focus', () => {
    expect(scopeAllows('global', 'editor')).toBe(true)
    expect(scopeAllows('app', 'text')).toBe(true)
    expect(scopeAllows('app', 'editor')).toBe(false)
    expect(scopeAllows('idle', 'text')).toBe(false)
    expect(scopeAllows('idle', 'other')).toBe(true)
  })

  it('classifies focus targets', () => {
    const el = (props: Record<string, unknown>, inEditor = false) =>
      ({ closest: (sel: string) => (inEditor && sel === '.monaco-editor' ? {} : null), isContentEditable: false, ...props }) as unknown as EventTarget
    expect(focusKind(null)).toBe('other')
    expect(focusKind(el({ tagName: 'DIV' }))).toBe('other')
    expect(focusKind(el({ tagName: 'INPUT', type: 'text' }))).toBe('text')
    expect(focusKind(el({ tagName: 'INPUT', type: 'checkbox' }))).toBe('other')
    expect(focusKind(el({ tagName: 'TEXTAREA' }))).toBe('text')
    expect(focusKind(el({ tagName: 'DIV', isContentEditable: true }))).toBe('text')
    expect(focusKind(el({ tagName: 'TEXTAREA' }, true))).toBe('editor')
  })
})

describe('formatting and cheat-sheet', () => {
  it('formats per platform', () => {
    expect(formatCombo({ key: 'Enter', mod: true }, false)).toBe('Ctrl+Enter')
    expect(formatCombo({ key: 'Enter', mod: true }, true)).toBe('⌘Enter')
    expect(formatCombo({ key: 'ArrowLeft', alt: true }, false)).toBe('Alt+←')
    expect(formatCombo({ key: '?', shift: true }, false)).toBe('?')
    expect(formatCombo({ key: 'k', mod: true }, true)).toBe('⌘K')
  })

  it('merges alternative combos into one row', () => {
    expect(shortcutLabels('help', false)).toEqual(['Ctrl+/', '?'])
  })

  it('lists every registered shortcut exactly once', () => {
    const ids = cheatSheet(false).flatMap((g) => g.rows.map((r) => r.id))
    expect(new Set(ids)).toEqual(new Set(SHORTCUTS.map((s) => s.id)))
    expect(ids).toHaveLength(new Set(ids).size)
  })
})

describe('settings and sidebar search', () => {
  it('match with the platform modifier', () => {
    expect(findShortcut(ev(',', { ctrlKey: true }), false)?.id).toBe('settings')
    expect(findShortcut(ev('F', { ctrlKey: true, shiftKey: true }), false)?.id).toBe('focus-search')
    expect(findShortcut(ev('f', { ctrlKey: true }), false)).toBeUndefined()
  })

  it('name Shift for letters but not for typed symbols', () => {
    expect(shortcutLabels('focus-search', false)).toEqual(['Ctrl+Shift+F'])
    expect(shortcutLabels('focus-search', true)).toEqual(['⇧⌘F'])
    expect(shortcutLabels('help', false)).toEqual(['Ctrl+/', '?'])
  })
})

describe('working-set and sidebar shortcuts', () => {
  it('match', () => {
    expect(findShortcut(ev('ArrowUp', { altKey: true }), false)?.id).toBe('prev-request')
    expect(findShortcut(ev('ArrowDown', { altKey: true }), false)?.id).toBe('next-request')
    expect(findShortcut(ev('b', { ctrlKey: true }), false)?.id).toBe('toggle-sidebar')
  })
})
