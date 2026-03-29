import { Plus, Trash2 } from 'lucide-react'
import React from 'react'
import type { KeyValuePair } from '@/types'
import { Button } from '@/components/ui/Button'
import { EnvInput } from '@/components/editor/EnvInput'
import { cn } from '@/lib/utils'

const COMMON_HEADERS = [
  'Accept',
  'Authorization',
  'Content-Type',
  'X-API-Key',
  'X-Request-ID',
  'Cache-Control',
  'User-Agent',
  'Accept-Language',
  'Accept-Encoding',
  'Origin',
  'Referer',
]

interface HeadersTabProps {
  params: KeyValuePair[]
  onChange: (params: KeyValuePair[]) => void
}

export function HeadersTab({ params, onChange }: HeadersTabProps) {
  const addRow = () => {
    onChange([...params, { id: crypto.randomUUID(), key: '', value: '', enabled: true }])
  }

  const updateRow = (id: string, field: keyof KeyValuePair, value: unknown) => {
    onChange(params.map((p) => (p.id === id ? { ...p, [field]: value } : p)))
  }

  const deleteRow = (id: string) => {
    onChange(params.filter((p) => p.id !== id))
  }

  const listId = React.useId()

  return (
    <div className="flex flex-col gap-1 p-3">
      <datalist id={listId}>
        {COMMON_HEADERS.map((h) => (
          <option key={h} value={h} />
        ))}
      </datalist>

      {params.length > 0 && (
        <div className="mb-1 grid grid-cols-[24px_1fr_1fr_28px] gap-1 px-1 text-xs text-th-text-subtle">
          <span />
          <span>Key</span>
          <span>Value</span>
          <span />
        </div>
      )}

      {params.map((param) => (
        <div
          key={param.id}
          className={cn('grid grid-cols-[24px_1fr_1fr_28px] items-center gap-1', !param.enabled && 'opacity-50')}
        >
          <input
            type="checkbox"
            checked={param.enabled}
            onChange={(e) => updateRow(param.id, 'enabled', e.target.checked)}
            className="h-4 w-4 cursor-pointer accent-th-text-subtle"
          />
          <input
            list={listId}
            value={param.key}
            onChange={(e) => updateRow(param.id, 'key', e.target.value)}
            placeholder="Header name"
            className="w-full rounded border border-th-border-strong bg-th-surface px-3 py-1.5 text-sm text-th-text-primary placeholder:text-th-text-subtle focus:border-th-border-strong focus:outline-none focus:ring-1 focus:ring-th-border-strong"
          />
          <EnvInput
            value={param.value}
            onChange={(v) => updateRow(param.id, 'value', v)}
            placeholder="Value"
            className="w-full rounded border border-th-border-strong bg-th-surface px-3 py-1.5 text-sm text-th-text-primary placeholder:text-th-text-subtle focus:border-th-border-strong focus:outline-none focus:ring-1 focus:ring-th-border-strong"
          />
          <button
            onClick={() => deleteRow(param.id)}
            className="flex h-8 w-7 items-center justify-center rounded text-th-text-faint hover:bg-th-surface-raised hover:text-rose-400 focus:outline-none"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      <Button variant="ghost" size="sm" className="mt-1 w-fit gap-1.5 text-th-text-muted" onClick={addRow}>
        <Plus className="h-3.5 w-3.5" /> Add header
      </Button>
    </div>
  )
}
