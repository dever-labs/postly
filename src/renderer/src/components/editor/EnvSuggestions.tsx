import React from 'react'
import { cn } from '@/lib/utils'
import type { EnvVar } from '@/types'

interface EnvSuggestionsProps {
  filtered: EnvVar[]
  selectedIndex: number
  onSelect: (key: string) => void
  onHover: (i: number) => void
}

export function EnvSuggestions({ filtered, selectedIndex, onSelect, onHover }: EnvSuggestionsProps) {
  if (filtered.length === 0) return null

  return (
    <div className="absolute top-full left-0 z-50 mt-1 min-w-[200px] max-w-xs overflow-hidden rounded-md border border-th-border-strong bg-th-surface-raised shadow-xl">
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-th-text-faint">
        Environment variables
      </div>
      {filtered.map((v, i) => (
        <button
          key={v.id}
          onMouseDown={(e) => { e.preventDefault(); onSelect(v.key) }}
          onMouseEnter={() => onHover(i)}
          className={cn(
            'flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm focus:outline-none',
            i === selectedIndex
              ? 'bg-blue-600/20 text-th-text-primary'
              : 'text-th-text-secondary hover:bg-th-surface-hover'
          )}
        >
          <span className="font-mono text-xs text-amber-400 shrink-0">{`{{`}</span>
          <span className="flex-1 truncate font-mono text-xs font-medium text-th-text-primary">{v.key}</span>
          <span className="shrink-0 truncate max-w-[80px] font-mono text-[11px] text-th-text-faint">
            {v.isSecret ? '••••••' : v.value}
          </span>
          <span className="font-mono text-xs text-amber-400 shrink-0">{`}}`}</span>
        </button>
      ))}
    </div>
  )
}
