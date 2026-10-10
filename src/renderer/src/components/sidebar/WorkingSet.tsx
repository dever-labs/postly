import { Pin, X } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { useCollectionsStore } from '@/store/collections'
import { useRequestsStore } from '@/store/requests'
import { useUIStore } from '@/store/ui'
import { buildWorkingSet, useWorkingSetStore } from '@/store/workingSet'
import { cn } from '@/lib/utils'

const METHOD_COLORS: Record<string, 'green' | 'yellow' | 'blue' | 'red' | 'orange' | 'purple' | 'grey'> = {
  GET: 'green', POST: 'yellow', PUT: 'blue', DELETE: 'red', PATCH: 'orange', HEAD: 'purple', OPTIONS: 'grey',
}

export function WorkingSet() {
  const requests = useCollectionsStore((s) => s.requests)
  const { recent, pinned, dismiss, togglePin } = useWorkingSetStore()
  const activeRequestId = useRequestsStore((s) => s.activeRequestId)
  const setActiveRequest = useRequestsStore((s) => s.setActiveRequest)
  const clearSelectedItem = useUIStore((s) => s.clearSelectedItem)

  const byId = new Map(requests.map((r) => [r.id, r]))
  const dirty = requests.filter((r) => r.isDirty).map((r) => r.id)
  const ids = buildWorkingSet(pinned, dirty, recent, (id) => byId.has(id))
  if (ids.length === 0) return null

  return (
    <div data-testid="working-set" className="shrink-0 border-b border-th-border pb-1">
      <div className="flex items-center justify-between px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-th-text-subtle">
        <span>Working set</span>
        {dirty.length > 0 && <span data-testid="working-set-unsaved" className="text-amber-400">{dirty.length} unsaved</span>}
      </div>
      <div className="max-h-44 overflow-y-auto">
        {ids.map((id) => {
          const r = byId.get(id)
          if (!r) return null
          const isPinned = pinned.includes(id)
          return (
            <div
              key={id}
              data-testid="working-set-item"
              className={cn('group flex items-center gap-2 px-3 py-1 hover:bg-th-surface-raised', activeRequestId === id && 'bg-th-surface-raised')}
            >
              <button
                onClick={() => { clearSelectedItem(); setActiveRequest(r) }}
                title={r.url || r.name}
                className="flex min-w-0 flex-1 items-center gap-2 text-left focus:outline-hidden"
              >
                <Badge variant={METHOD_COLORS[r.method] ?? 'grey'} className="shrink-0 font-mono text-[10px]">{r.method}</Badge>
                <span className="min-w-0 flex-1 truncate text-xs text-th-text-secondary">{r.name || 'Untitled'}</span>
                {r.isDirty && <span data-testid="working-set-dirty" title="Unsaved changes" className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />}
              </button>
              <button
                onClick={() => togglePin(id)}
                title={isPinned ? 'Unpin' : 'Pin'}
                aria-label={isPinned ? 'Unpin' : 'Pin'}
                className={cn('shrink-0 hover:text-th-text-primary', isPinned ? 'text-blue-400' : 'text-th-text-subtle opacity-0 group-hover:opacity-100 focus:opacity-100')}
              >
                <Pin className="h-3 w-3" />
              </button>
              <span className="flex h-3 w-3 shrink-0 items-center justify-center">
                {!isPinned && !r.isDirty && (
                  <button
                    onClick={() => dismiss(id)}
                    title="Remove from working set"
                    aria-label="Remove from working set"
                    className="text-th-text-subtle opacity-0 hover:text-th-text-primary focus:opacity-100 group-hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
