import { X } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { cheatSheet } from '@/lib/shortcuts'
import { useShortcutHelpStore } from '@/store/shortcutHelp'

export function ShortcutCheatSheet() {
  const open = useShortcutHelpStore((s) => s.open)
  return open ? <Sheet /> : null
}

function Sheet() {
  const hide = useShortcutHelpStore((s) => s.hide)
  const closeRef = useRef<HTMLButtonElement>(null)
  const previouslyFocused = useRef<Element | null>(document.activeElement)
  const groups = useMemo(() => cheatSheet(window.api.platform === 'darwin'), [])

  useEffect(() => { closeRef.current?.focus() }, [])
  useEffect(() => () => { if (previouslyFocused.current instanceof HTMLElement) previouslyFocused.current.focus() }, [])

  return (
    <div
      className="fixed inset-0 z-[300] flex items-start justify-center bg-black/50 pt-[10vh] backdrop-blur-xs"
      onMouseDown={(e) => { if (e.target === e.currentTarget) hide() }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); hide() } }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        data-testid="shortcut-sheet"
        className="w-[480px] max-w-[90vw] overflow-hidden rounded-lg border border-th-border-strong bg-th-surface shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-th-border px-4 py-3">
          <h2 className="text-sm font-semibold text-th-text-primary">Keyboard shortcuts</h2>
          <button ref={closeRef} onClick={hide} aria-label="Close" className="rounded-sm p-1 text-th-text-subtle hover:bg-th-surface-raised hover:text-th-text-primary">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-4 py-2">
          {groups.map((g) => (
            <section key={g.group} className="py-2">
              <h3 className="pb-1 text-[10px] font-semibold uppercase tracking-wide text-th-text-subtle">{g.group}</h3>
              {g.rows.map((r) => (
                <div key={r.id} data-testid="shortcut-row" className="flex items-center justify-between py-1 text-sm text-th-text-secondary">
                  <span>{r.label}</span>
                  <span className="flex gap-1.5">
                    {r.keys.map((k) => (
                      <kbd key={k} className="rounded-sm border border-th-border bg-th-surface-raised px-1.5 py-0.5 font-mono text-[11px] text-th-text-primary">{k}</kbd>
                    ))}
                  </span>
                </div>
              ))}
            </section>
          ))}
          <p className="border-t border-th-border py-2 text-[11px] text-th-text-subtle">
            Inside the code editor, its own keys win (for example Ctrl+Enter and Ctrl+/); only Save and the command palette work there.
          </p>
        </div>
      </div>
    </div>
  )
}
