import React, { useState } from 'react'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import type { Request } from '@/types'
import { Badge } from '@/components/ui/Badge'
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

interface RequestTreeItemProps {
  request: Request
  isActive: boolean
  onClick: () => void
  onDelete: () => void
}

export function RequestTreeItem({ request, isActive, onClick, onDelete }: RequestTreeItemProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [nameValue, setNameValue] = useState(request.name)

  const handleRename = async () => {
    if (nameValue.trim()) {
      await (window as any).api.requests.update({ id: request.id, name: nameValue.trim() })
    }
    setRenaming(false)
  }

  return (
    <div
      className={cn(
        'group relative flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer rounded',
        isActive ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200'
      )}
      onClick={() => !renaming && onClick()}
    >
      <Badge variant={METHOD_COLORS[request.method] ?? 'grey'} className="shrink-0 font-mono text-[10px]">
        {request.method}
      </Badge>

      {renaming ? (
        <input
          autoFocus
          className="flex-1 rounded bg-neutral-700 px-1.5 py-0.5 text-sm text-neutral-100 focus:outline-none"
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
        <span className="flex-1 truncate">{request.name}</span>
      )}

      {request.isDirty && (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" title="Unsaved changes" />
      )}

      <button
        className="shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-neutral-700 focus:outline-none"
        onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen) }}
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-36 overflow-hidden rounded border border-neutral-700 bg-neutral-800 shadow-lg">
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-neutral-200 hover:bg-neutral-700"
              onClick={(e) => { e.stopPropagation(); setMenuOpen(false); setRenaming(true) }}
            >
              <Pencil className="h-3.5 w-3.5" /> Rename
            </button>
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-rose-400 hover:bg-neutral-700"
              onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete() }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </div>
        </>
      )}
    </div>
  )
}
