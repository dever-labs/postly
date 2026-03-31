import React from 'react'
import type { LogEntry } from '@/types'
import { cn } from '@/lib/utils'

interface ConsoleTabProps {
  logs: LogEntry[]
}

const levelStyles: Record<LogEntry['level'], { badge: string; text: string; row: string }> = {
  info:  { badge: 'bg-th-surface text-th-text-muted',          text: 'text-th-text-secondary', row: '' },
  warn:  { badge: 'bg-amber-900/40 text-amber-400',            text: 'text-amber-300',         row: 'bg-amber-900/5' },
  error: { badge: 'bg-rose-900/40 text-rose-400',              text: 'text-rose-300',          row: 'bg-rose-900/10' },
}

export function ConsoleTab({ logs }: ConsoleTabProps) {
  if (logs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-th-text-faint">
        No console output
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto">
      {logs.map((entry, i) => {
        const s = levelStyles[entry.level]
        return (
          <div
            key={i}
            className={cn(
              'flex items-start gap-2.5 border-b border-th-surface px-4 py-1.5 font-mono text-xs',
              s.row
            )}
          >
            <span className={cn('mt-px shrink-0 rounded-sm px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider', s.badge)}>
              {entry.level}
            </span>
            <div className="min-w-0 flex-1">
              <span className={s.text}>{entry.message}</span>
              {entry.detail && (
                <p className="mt-0.5 whitespace-pre-wrap text-[10px] text-th-text-subtle leading-relaxed">{entry.detail}</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
