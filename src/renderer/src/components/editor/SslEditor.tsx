import React from 'react'
import type { SslVerification } from '@/types'
import { cn } from '@/lib/utils'

interface SslEditorProps {
  value: SslVerification
  onChange: (value: SslVerification) => void
  canInherit?: boolean
  inheritedFrom?: string
}

const OPTIONS: { value: SslVerification; label: string }[] = [
  { value: 'inherit', label: 'Inherit' },
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabled', label: 'Disabled' },
]

export function SslEditor({ value, onChange, canInherit = true, inheritedFrom }: SslEditorProps) {
  const options = canInherit ? OPTIONS : OPTIONS.filter((o) => o.value !== 'inherit')

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-sm px-3 py-1.5 text-xs transition-colors focus:outline-hidden',
              value === opt.value
                ? 'bg-th-surface-hover text-th-text-primary'
                : 'text-th-text-subtle hover:bg-th-surface-raised hover:text-th-text-secondary'
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {value === 'inherit' && canInherit && (
        <p className="text-xs text-th-text-faint">
          {inheritedFrom
            ? `SSL setting inherited from "${inheritedFrom}"`
            : 'SSL setting inherited from parent (or global default)'}
        </p>
      )}
      {value === 'disabled' && (
        <p className="text-xs text-amber-400">
          SSL verification is disabled — use only for development/testing.
        </p>
      )}
    </div>
  )
}
