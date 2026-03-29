import { Check, Plus, Trash2, X } from 'lucide-react'
import React, { useRef, useState } from 'react'
import { useEnvironmentsStore } from '@/store/environments'
import { useUIStore } from '@/store/ui'
import { cn } from '@/lib/utils'

function InlineInput({ onConfirm, onCancel }: { onConfirm: (v: string) => void; onCancel: () => void }) {
  const [val, setVal] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  React.useEffect(() => { ref.current?.focus() }, [])
  return (
    <div className="flex items-center gap-1 px-2 py-1.5">
      <input
        ref={ref}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { if (val.trim()) onConfirm(val.trim()); else onCancel() }
          if (e.key === 'Escape') onCancel()
        }}
        placeholder="Environment name…"
        className="flex-1 rounded bg-th-surface-raised px-2 py-1 text-sm text-th-text-primary placeholder-th-text-subtle outline-none ring-1 ring-blue-500/50"
      />
      <button onClick={() => { if (val.trim()) onConfirm(val.trim()); else onCancel() }} className="text-green-400 hover:text-green-300">
        <Check className="h-3.5 w-3.5" />
      </button>
      <button onClick={onCancel} className="text-th-text-subtle hover:text-th-text-secondary">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function EnvironmentsPanel() {
  const { environments, activeEnv, createEnvironment, deleteEnvironment, setActive } = useEnvironmentsStore()
  const { selectedEnvId, setSelectedEnvId } = useUIStore()
  const [creating, setCreating] = useState(false)

  const handleCreate = async (name: string) => {
    await createEnvironment(name)
    setCreating(false)
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto py-1">
        {environments.length === 0 && !creating && (
          <p className="px-4 py-3 text-xs italic text-th-text-faint">No environments yet</p>
        )}

        {environments.map((env) => {
          const isActive = activeEnv?.id === env.id
          const isSelected = selectedEnvId === env.id

          return (
            <div
              key={env.id}
              className={cn(
                'group/env mx-1 flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm transition-colors',
                isSelected ? 'bg-th-surface-raised text-th-text-primary' : 'text-th-text-muted hover:bg-th-surface-raised/50 hover:text-th-text-primary'
              )}
              onClick={() => setSelectedEnvId(env.id)}
              onDoubleClick={() => setActive(env.id)}
              title={isActive ? 'Active environment' : 'Click to select · Double-click to activate'}
            >
              {/* Active dot */}
              <button
                onClick={(e) => { e.stopPropagation(); setActive(env.id) }}
                title={isActive ? 'Active' : 'Set as active'}
                className="shrink-0 focus:outline-none"
              >
                <div className={cn(
                  'h-2 w-2 rounded-full border transition-colors',
                  isActive ? 'border-emerald-400 bg-emerald-400' : 'border-th-border-strong hover:border-th-text-muted'
                )} />
              </button>

              <span className="flex-1 truncate">{env.name}</span>

              <button
                onClick={(e) => { e.stopPropagation(); if (isSelected) setSelectedEnvId(null); deleteEnvironment(env.id) }}
                className="shrink-0 rounded p-0.5 text-th-text-faint opacity-0 hover:text-rose-400 focus:outline-none group-hover/env:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )
        })}

        {creating && (
          <InlineInput onConfirm={handleCreate} onCancel={() => setCreating(false)} />
        )}
      </div>

      <div className="shrink-0 border-t border-th-border px-2 py-2">
        <button
          onClick={() => setCreating(true)}
          className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-sm text-th-text-muted hover:bg-th-surface-raised hover:text-th-text-primary focus:outline-none"
        >
          <Plus className="h-3.5 w-3.5" /> New Environment
        </button>
      </div>
    </div>
  )
}
