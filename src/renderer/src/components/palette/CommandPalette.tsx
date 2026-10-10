import { ChevronRight, Command, Keyboard, Globe, Settings, RefreshCw, Plus, Check } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { useCollectionsStore } from '@/store/collections'
import { useEnvironmentsStore } from '@/store/environments'
import { useIntegrationsStore } from '@/store/integrations'
import { usePaletteStore } from '@/store/palette'
import { useRequestsStore } from '@/store/requests'
import { useShortcutHelpStore } from '@/store/shortcutHelp'
import { useUIStore } from '@/store/ui'
import { useWorkingSetStore } from '@/store/workingSet'
import { useShortcut } from '@/hooks/useShortcuts'
import { createRequestInContext } from '@/lib/requestActions'
import { buildItems, searchItems, ACTIONS, type PaletteItem } from '@/lib/palette'
import { shortcutLabels, type ShortcutId } from '@/lib/shortcuts'
import { cn } from '@/lib/utils'

const ACTION_SHORTCUTS: Record<string, ShortcutId> = { 'open-settings': 'settings', 'new-request': 'new-request', 'show-shortcuts': 'help' }

const METHOD_COLORS: Record<string, 'green' | 'yellow' | 'blue' | 'red' | 'orange' | 'purple' | 'grey'> = {
  GET: 'green', POST: 'yellow', PUT: 'blue', DELETE: 'red', PATCH: 'orange', HEAD: 'purple', OPTIONS: 'grey',
}

function ItemIcon({ item }: { item: PaletteItem }) {
  if (item.kind === 'request') {
    return <Badge variant={METHOD_COLORS[item.method ?? ''] ?? 'grey'} className="w-14 shrink-0 justify-center font-mono text-[10px]">{item.method ?? 'GET'}</Badge>
  }
  const Icon = item.id === 'open-settings' ? Settings : item.id === 'show-shortcuts' ? Keyboard : item.id === 'check-updates' ? RefreshCw : item.kind === 'environment' ? Globe : Plus
  return <span className="flex w-14 shrink-0 justify-center text-th-text-subtle"><Icon className="h-3.5 w-3.5" /></span>
}

export function CommandPalette() {
  const open = usePaletteStore((s) => s.open)
  const toggle = usePaletteStore((s) => s.toggle)
  const hide = usePaletteStore((s) => s.hide)

  // The key is bound in lib/shortcuts.ts and dispatched centrally (captured, so it also works inside Monaco)
  useShortcut('palette', () => { toggle(); return true })

  if (!open) return null
  return <PaletteDialog onClose={hide} />
}

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<Element | null>(document.activeElement)

  // The index is built here, so nothing is computed until the palette is first opened.
  const items = useMemo(() => {
    const { folders, requests } = useCollectionsStore.getState()
    return buildItems(folders, requests, useIntegrationsStore.getState().integrations, useEnvironmentsStore.getState().environments)
  }, [])

  const results = useMemo(() => {
    if (query.trim()) return searchItems(items, query)
    const byId = new Map(items.filter((i) => i.kind === 'request').map((i) => [i.id, i]))
    const recent = useWorkingSetStore.getState().recent.map((id) => byId.get(id)).filter((i): i is PaletteItem => !!i)
    return [...ACTIONS, ...recent, ...items.filter((i) => i.kind === 'environment')]
  }, [items, query])

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => () => { if (previouslyFocused.current instanceof HTMLElement) previouslyFocused.current.focus() }, [])
  useEffect(() => { setIndex(0) }, [query])
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) }, [index, results])

  const run = async (item: PaletteItem) => {
    onClose()
    const ui = useUIStore.getState()
    if (item.kind === 'request') {
      const request = useCollectionsStore.getState().requests.find((r) => r.id === item.id)
      if (!request) return
      ui.setSidebarTab('apis')
      ui.clearSelectedItem()
      useRequestsStore.getState().setActiveRequest(request)
    } else if (item.kind === 'environment') {
      await useEnvironmentsStore.getState().setActive(item.id)
      ui.addToast(`Environment: ${item.title.replace('Switch environment: ', '')}`, 'success')
    } else if (item.id === 'open-settings') {
      ui.openSettings()
    } else if (item.id === 'check-updates') {
      ui.addToast('Checking for updates…', 'info')
      await window.api.updater.check()
    } else if (item.id === 'new-request') {
      await createRequestInContext()
    } else if (item.id === 'show-shortcuts') {
      useShortcutHelpStore.getState().show()
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(i + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const item = results[index]; if (item) void run(item) }
  }

  return (
    <div
      className="fixed inset-0 z-[300] flex items-start justify-center bg-black/50 pt-[12vh] backdrop-blur-xs"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        data-testid="command-palette"
        className="w-[600px] max-w-[90vw] overflow-hidden rounded-lg border border-th-border-strong bg-th-surface shadow-2xl"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 border-b border-th-border px-3 py-2.5">
          <Command className="h-4 w-4 shrink-0 text-th-text-subtle" />
          <input
            ref={inputRef}
            data-testid="palette-input"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={results[index] ? `palette-opt-${index}` : undefined}
            aria-label="Search requests, environments and actions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search requests, environments and actions…"
            className="flex-1 bg-transparent text-sm text-th-text-primary placeholder-th-text-subtle outline-hidden"
          />
          <kbd className="rounded-sm border border-th-border px-1.5 py-0.5 text-[10px] text-th-text-subtle">Esc</kbd>
        </div>
        <div ref={listRef} id="palette-list" role="listbox" aria-label="Results" className="max-h-[50vh] overflow-y-auto py-1">
          {results.length === 0 && <p className="px-4 py-6 text-center text-xs text-th-text-subtle">No matches.</p>}
          {results.map((item, i) => (
            <div
              key={item.key}
              id={`palette-opt-${i}`}
              role="option"
              aria-selected={i === index}
              data-testid="palette-item"
              onMouseMove={() => setIndex(i)}
              onClick={() => void run(item)}
              className={cn('flex cursor-pointer items-center gap-3 px-3 py-1.5', i === index && 'bg-th-surface-raised')}
            >
              <ItemIcon item={item} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm text-th-text-primary">
                  <span className="truncate">{item.title}</span>
                  {item.active && <Check className="h-3 w-3 shrink-0 text-green-400" aria-label="Active" />}
                </div>
                {item.kind === 'request' && (
                  <div className="flex items-center gap-1 truncate text-[11px] text-th-text-subtle">
                    {item.path.map((p, n) => (
                      <span key={n} className="flex shrink-0 items-center gap-1">
                        {n > 0 && <ChevronRight className="h-2.5 w-2.5" />}{p}
                      </span>
                    ))}
                    {item.url && <span className="ml-2 truncate text-th-text-faint">{item.url}</span>}
                  </div>
                )}
              </div>
              {item.kind === 'action' && ACTION_SHORTCUTS[item.id] && (
                <kbd className="shrink-0 rounded-sm border border-th-border px-1.5 py-0.5 font-mono text-[10px] text-th-text-subtle">
                  {shortcutLabels(ACTION_SHORTCUTS[item.id], window.api.platform === 'darwin')[0]}
                </kbd>
              )}
            </div>
          ))}
        </div>
        <div aria-hidden="true" className="flex gap-4 border-t border-th-border px-3 py-1.5 text-[10px] text-th-text-subtle">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  )
}
