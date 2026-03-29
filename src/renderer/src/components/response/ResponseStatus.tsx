import React from 'react'
import type { HttpResponse } from '@/types'
import { cn } from '@/lib/utils'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}

interface ResponseStatusProps {
  response: HttpResponse
}

export function ResponseStatus({ response }: ResponseStatusProps) {
  const status = response.status

  const statusVariant =
    status >= 200 && status < 300
      ? 'bg-emerald-900/50 text-emerald-400'
      : status >= 300 && status < 400
      ? 'bg-amber-900/50 text-amber-400'
      : status >= 400
      ? 'bg-rose-900/50 text-rose-400'
      : 'bg-th-surface-raised text-th-text-muted'

  return (
    <div className="flex items-center gap-3">
      <span className={cn('rounded px-2 py-0.5 text-xs font-medium', statusVariant)}>
        {status} {response.statusText}
      </span>
      <span className="text-xs text-th-text-subtle">{response.duration} ms</span>
      <span className="text-xs text-th-text-subtle">{formatSize(response.size)}</span>
    </div>
  )
}
