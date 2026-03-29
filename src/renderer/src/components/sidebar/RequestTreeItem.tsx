import React, { useState } from 'react'
import { GripVertical, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Request } from '@/types'
import { Badge } from '@/components/ui/Badge'
import { useUIStore } from '@/store/ui'
import { AiActionButton } from '@/components/ai/AiActionButton'
import { cn } from '@/lib/utils'

const METHOD_COLORS: Record<string, 'green' | 'yellow' | 'blue' | 'red' | 'orange' | 'purple' | 'grey'> = {
  GET: 'green',
  POST: 'yellow',
  PUT: 'blue',
  DELETE: 'red',
  PATCH: 'orange',
  HEAD: 'purple',
  OPTIONS: 'grey',
}

const PROTOCOL_BADGE: Record<string, { label: string; variant: 'green' | 'yellow' | 'blue' | 'red' | 'orange' | 'purple' | 'grey' }> = {
  websocket: { label: 'WS',   variant: 'blue' },
  grpc:      { label: 'gRPC', variant: 'purple' },
  mqtt:      { label: 'MQTT', variant: 'orange' },
  graphql:   { label: 'GQL',  variant: 'grey' },
}

interface RequestTreeItemProps {
  request: Request
  isActive: boolean
  onClick: () => void
  onDelete: () => void
  dndId: string
  insertLine?: 'above' | 'below' | null
}

export function RequestTreeItem({ request, isActive, onClick, onDelete, dndId, insertLine }: RequestTreeItemProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [nameValue, setNameValue] = useState(request.name)
  const selectItem = useUIStore((s) => s.selectItem)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: dndId })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }

  const handleRename = async () => {
    if (nameValue.trim()) {
      await window.api.requests.update({ id: request.id, name: nameValue.trim() })
    }
    setRenaming(false)
  }

  return (
    <div className="relative">
      {insertLine === 'above' && <div className="mx-1 h-0.5 rounded bg-blue-500" />}
      <div
        ref={setNodeRef}
        style={style}
      className={cn(
        'group relative flex items-center gap-1 px-2 py-0.5 text-sm cursor-pointer rounded',
        isActive ? 'bg-th-surface-raised text-th-text-primary' : 'text-th-text-muted hover:bg-th-surface-raised/60 hover:text-th-text-primary'
      )}
      onClick={() => !renaming && onClick()}
    >
      <button
        {...listeners}
        {...attributes}
        className="cursor-grab shrink-0 rounded p-0.5 text-th-text-faint opacity-0 hover:text-th-text-muted focus:outline-none group-hover:opacity-100 active:cursor-grabbing"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      {(() => {
        const pb = request.protocol ? PROTOCOL_BADGE[request.protocol] : null
        return pb
          ? <Badge variant={pb.variant} className="shrink-0 font-mono text-[10px]">{pb.label}</Badge>
          : <Badge variant={METHOD_COLORS[request.method] ?? 'grey'} className="shrink-0 font-mono text-[10px]">{request.method}</Badge>
      })()}

      {renaming ? (
        <input
          autoFocus
          className="flex-1 rounded bg-th-surface-hover px-1.5 py-0.5 text-sm text-th-text-primary focus:outline-none"
          value={nameValue}
          onChange={(e) => setNameValue(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRename()
            if (e.key === 'Escape') setRenaming(false)
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="flex-1 truncate py-1">{request.name}</span>
      )}

      {request.isDirty && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" title="Unsaved changes" />
      )}

      <button
        className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-th-surface-hover focus:outline-none"
        onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen) }}
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded border border-th-border-strong bg-th-surface-raised shadow-lg">
            <AiActionButton
              variant="menu-item"
              label="Review with AI"
              onClick={() => { setMenuOpen(false); selectItem('ai-request', request.id) }}
            />
            <div className="border-t border-th-border mx-2" />
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-th-text-primary hover:bg-th-surface-hover"
              onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setRenaming(true) }}
            >
              <Pencil className="h-3.5 w-3.5" /> Rename
            </button>
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-rose-400 hover:bg-th-surface-hover"
              onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete() }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </div>
        </>
      )}
      </div>
      {insertLine === 'below' && <div className="mx-1 h-0.5 rounded bg-blue-500" />}
    </div>
  )
}
