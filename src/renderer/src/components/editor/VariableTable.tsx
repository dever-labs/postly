import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import React from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import type { VariableRow } from '@/store/variables'

interface Props {
  rows: VariableRow[]
  onChange: (rows: VariableRow[]) => void
  testId: string
}

/** Key / value / secret rows, used for global and collection variables. */
export function VariableTable({ rows, onChange, testId }: Props) {
  const update = (i: number, patch: Partial<VariableRow>) => onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  const duplicates = new Set(rows.map((r) => r.key.trim()).filter((k, i, all) => k && all.indexOf(k) !== i))

  return (
    <div data-testid={testId} className="flex flex-col gap-1">
      {rows.length > 0 && (
        <div className="mb-1 grid grid-cols-[1fr_1fr_32px_28px] gap-1 px-1 text-xs text-th-text-faint">
          <span>Key</span><span>Value</span><span>Secret</span><span />
        </div>
      )}
      {rows.map((r, i) => (
        <div key={i} data-testid={`${testId}-row`} className="grid grid-cols-[1fr_1fr_32px_28px] items-center gap-1">
          <Input
            aria-label="Variable name"
            value={r.key}
            onChange={(e) => update(i, { key: e.target.value })}
            placeholder="KEY"
            className={duplicates.has(r.key.trim()) ? 'border-amber-500' : undefined}
            title={duplicates.has(r.key.trim()) ? 'Duplicate name: the last one is used' : undefined}
          />
          <Input aria-label="Variable value" type={r.isSecret ? 'password' : 'text'} value={r.value} onChange={(e) => update(i, { value: e.target.value })} placeholder="value" />
          <button
            type="button"
            aria-label={r.isSecret ? 'Secret variable' : 'Not secret'}
            onClick={() => update(i, { isSecret: !r.isSecret })}
            className={`flex h-8 w-8 items-center justify-center rounded-sm hover:bg-th-surface-raised focus:outline-hidden ${r.isSecret ? 'text-amber-400' : 'text-th-text-faint'}`}
            title={r.isSecret ? 'Secret (masked, never exported)' : 'Not secret'}
          >
            {r.isSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            aria-label="Delete variable"
            onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
            className="flex h-8 w-7 items-center justify-center rounded-sm text-th-text-faint hover:bg-th-surface-raised hover:text-rose-400 focus:outline-hidden"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <div>
        <Button size="sm" variant="outline" data-testid={`${testId}-add`} onClick={() => onChange([...rows, { key: '', value: '', isSecret: false }])}>
          <Plus className="mr-1 h-3.5 w-3.5" />Add variable
        </Button>
      </div>
    </div>
  )
}
