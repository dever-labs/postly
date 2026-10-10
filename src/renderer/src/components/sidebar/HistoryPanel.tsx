import { Search, Trash2 } from 'lucide-react'
import { useEffect } from 'react'
import { Badge } from '@/components/ui/Badge'
import { useHistoryStore } from '@/store/history'
import { useRequestsStore } from '@/store/requests'
import { useUIStore } from '@/store/ui'
import { cn } from '@/lib/utils'
import type { HistoryEntrySummary } from '@/types'

const METHOD_COLORS: Record<string, 'green' | 'yellow' | 'blue' | 'red' | 'orange' | 'purple' | 'grey'> = {
  GET: 'green', POST: 'yellow', PUT: 'blue', DELETE: 'red', PATCH: 'orange', HEAD: 'purple', OPTIONS: 'grey',
}

function dayLabel(ts: number): string {
  const d = new Date(ts)
  const today = new Date()
  const yesterday = new Date(today.getTime() - 86_400_000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function statusClass(status: number): string {
  if (status >= 200 && status < 300) return 'text-green-400'
  if (status >= 300 && status < 400) return 'text-blue-400'
  if (status >= 400) return 'text-red-400'
  return 'text-th-text-subtle'
}

export function HistoryPanel() {
  const { entries, search, setSearch, load, open, remove, clear } = useHistoryStore()
  const clearSelectedItem = useUIStore((s) => s.clearSelectedItem)
  const openHistoryEntry = useRequestsStore((s) => s.openHistoryEntry)
  const activeRequestId = useRequestsStore((s) => s.activeRequestId)
  const response = useRequestsStore((s) => s.response)

  useEffect(() => {
    const t = setTimeout(() => { void load() }, search ? 150 : 0)
    return () => clearTimeout(t)
  }, [search, load, response])

  const handleOpen = async (entry: HistoryEntrySummary) => {
    const detail = await open(entry.id)
    if (!detail) return
    clearSelectedItem()
    openHistoryEntry(detail)
  }

  const groups: { label: string; items: HistoryEntrySummary[] }[] = []
  for (const e of entries) {
    const label = dayLabel(e.createdAt)
    const last = groups[groups.length - 1]
    if (last?.label === label) last.items.push(e)
    else groups.push({ label, items: [e] })
  }

  return (
    <div data-testid="history-panel" className="flex flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-th-border px-2 py-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-th-text-subtle" />
          <input
            data-testid="history-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search history…"
            aria-label="Search history"
            className="w-full rounded-sm bg-th-surface-raised py-1 pl-7 pr-2 text-sm text-th-text-primary placeholder-th-text-subtle outline-hidden focus:ring-1 focus:ring-blue-500/50"
          />
        </div>
        <button
          data-testid="history-clear"
          onClick={() => { if (window.confirm('Clear all request history?')) void clear() }}
          disabled={entries.length === 0}
          title="Clear history"
          aria-label="Clear history"
          className="rounded-sm p-1.5 text-th-text-subtle hover:bg-th-surface-raised hover:text-red-400 disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 && (
          <p data-testid="history-empty" className="px-4 py-6 text-center text-xs text-th-text-subtle">
            {search ? 'No matching requests.' : 'Requests you send will appear here.'}
          </p>
        )}
        {groups.map((g) => (
          <div key={g.label}>
            <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-th-text-subtle">{g.label}</div>
            {g.items.map((e) => (
              <div
                key={e.id}
                data-testid="history-item"
                className={cn(
                  'group flex items-center gap-2 px-3 py-1.5 hover:bg-th-surface-raised',
                  activeRequestId === `scratch:${e.id}` && 'bg-th-surface-raised'
                )}
              >
                <button
                  onClick={() => void handleOpen(e)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left focus:outline-hidden"
                  title={e.url}
                >
                  <Badge variant={METHOD_COLORS[e.method] ?? 'grey'} className="shrink-0 font-mono text-[10px]">{e.method}</Badge>
                  <span className="min-w-0 flex-1 truncate text-xs text-th-text-secondary">{e.url}</span>
                  <span className={cn('shrink-0 font-mono text-[10px]', statusClass(e.status))}>{e.status || '—'}</span>
                </button>
                <button
                  onClick={() => void remove(e.id)}
                  title="Delete entry"
                  aria-label="Delete entry"
                  className="shrink-0 text-th-text-subtle opacity-0 hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
