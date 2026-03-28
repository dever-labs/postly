import { Check, ChevronDown, ChevronRight, Eye, EyeOff, Plus, Trash2, X } from 'lucide-react'
import React, { useRef, useState } from 'react'
import { useEnvironmentsStore } from '@/store/environments'
import { cn } from '@/lib/utils'

// ─── Inline input ─────────────────────────────────────────────────────────────

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
        className="flex-1 rounded bg-neutral-800 px-2 py-1 text-sm text-neutral-200 placeholder-neutral-500 outline-none ring-1 ring-blue-500/50"
      />
      <button onClick={() => { if (val.trim()) onConfirm(val.trim()); else onCancel() }} className="text-green-400 hover:text-green-300">
        <Check className="h-3.5 w-3.5" />
      </button>
      <button onClick={onCancel} className="text-neutral-500 hover:text-neutral-300">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// ─── Variable row ─────────────────────────────────────────────────────────────

function VarRow({ envId, varItem, onUpsert, onDelete }: {
  envId: string
  varItem: { id: string; key: string; value: string; isSecret: boolean }
  onUpsert: (key: string, value: string, isSecret: boolean, id: string) => void
  onDelete: (id: string) => void
}) {
  const [showSecret, setShowSecret] = useState(false)
  return (
    <div className="group/var flex items-center gap-1 px-2 py-0.5">
      <input
        value={varItem.key}
        onChange={(e) => onUpsert(e.target.value, varItem.value, varItem.isSecret, varItem.id)}
        placeholder="KEY"
        className="w-[38%] rounded bg-neutral-800/60 px-1.5 py-0.5 font-mono text-xs text-neutral-300 placeholder-neutral-600 outline-none focus:ring-1 focus:ring-blue-500/40"
      />
      <input
        type={varItem.isSecret && !showSecret ? 'password' : 'text'}
        value={varItem.value}
        onChange={(e) => onUpsert(varItem.key, e.target.value, varItem.isSecret, varItem.id)}
        placeholder="value"
        className="flex-1 rounded bg-neutral-800/60 px-1.5 py-0.5 font-mono text-xs text-neutral-300 placeholder-neutral-600 outline-none focus:ring-1 focus:ring-blue-500/40"
      />
      <button
        onClick={() => varItem.isSecret ? setShowSecret((s) => !s) : onUpsert(varItem.key, varItem.value, true, varItem.id)}
        title={varItem.isSecret ? 'Secret — click to toggle visibility' : 'Click to mark as secret'}
        className={cn('shrink-0 rounded p-0.5 focus:outline-none', varItem.isSecret ? 'text-amber-400 hover:text-amber-300' : 'text-neutral-600 opacity-0 group-hover/var:opacity-100 hover:text-neutral-400')}
      >
        {varItem.isSecret && !showSecret ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
      </button>
      <button
        onClick={() => onDelete(varItem.id)}
        className="shrink-0 rounded p-0.5 text-neutral-600 opacity-0 hover:text-rose-400 focus:outline-none group-hover/var:opacity-100"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function EnvironmentsPanel({ onCreateNew }: { onCreateNew?: () => void }) {
  const { environments, activeEnv, vars, createEnvironment, deleteEnvironment, setActive, upsertVar, deleteVar } = useEnvironmentsStore()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const toggle = (id: string) => setExpandedId((prev) => (prev === id ? null : id))

  const handleCreate = async (name: string) => {
    await createEnvironment(name)
    setCreating(false)
  }

  const handleAddVar = (envId: string) => {
    upsertVar(envId, '', '', false, crypto.randomUUID())
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto py-1">
        {environments.length === 0 && !creating && (
          <p className="px-4 py-3 text-xs text-neutral-600 italic">No environments yet</p>
        )}

        {environments.map((env) => {
          const envVars = vars.filter((v) => v.envId === env.id)
          const isExpanded = expandedId === env.id
          const isActive = activeEnv?.id === env.id

          return (
            <div key={env.id} className="group/env mb-0.5">
              {/* Row */}
              <div className={cn(
                'flex items-center gap-1 rounded px-2 py-1.5 mx-1',
                isExpanded ? 'bg-neutral-800/60' : 'hover:bg-neutral-800/40'
              )}>
                {/* Active indicator / radio */}
                <button
                  onClick={() => setActive(env.id)}
                  title={isActive ? 'Active environment' : 'Set as active'}
                  className="shrink-0 focus:outline-none"
                >
                  <div className={cn(
                    'h-2 w-2 rounded-full border transition-colors',
                    isActive ? 'border-emerald-400 bg-emerald-400' : 'border-neutral-600 hover:border-neutral-400'
                  )} />
                </button>

                {/* Name */}
                <button
                  onClick={() => toggle(env.id)}
                  className="flex flex-1 items-center gap-1.5 text-left focus:outline-none"
                >
                  {isExpanded
                    ? <ChevronDown className="h-3 w-3 shrink-0 text-neutral-500" />
                    : <ChevronRight className="h-3 w-3 shrink-0 text-neutral-500" />}
                  <span className={cn('truncate text-sm', isActive ? 'text-neutral-100' : 'text-neutral-300')}>
                    {env.name}
                  </span>
                  {isActive && (
                    <span className="shrink-0 rounded bg-emerald-900/50 px-1 py-px text-[10px] font-medium text-emerald-400">active</span>
                  )}
                  <span className="shrink-0 text-xs text-neutral-600">{envVars.length}</span>
                </button>

                {/* Delete */}
                <button
                  onClick={() => deleteEnvironment(env.id)}
                  className="shrink-0 rounded p-0.5 text-neutral-600 opacity-0 hover:text-rose-400 focus:outline-none group-hover/env:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Variables (expanded) */}
              {isExpanded && (
                <div className="mx-1 mb-1 rounded-b border border-t-0 border-neutral-800 bg-neutral-900/50 py-1">
                  {envVars.length > 0 && (
                    <div className="mb-0.5 grid grid-cols-[38%_1fr_16px_16px] gap-1 px-2 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-600">
                      <span>Key</span><span>Value</span><span /><span />
                    </div>
                  )}
                  {envVars.map((v) => (
                    <VarRow
                      key={v.id}
                      envId={env.id}
                      varItem={v}
                      onUpsert={(key, value, isSecret, id) => upsertVar(env.id, key, value, isSecret, id)}
                      onDelete={deleteVar}
                    />
                  ))}
                  {envVars.length === 0 && (
                    <p className="px-3 py-1 text-xs text-neutral-600 italic">No variables</p>
                  )}
                  <button
                    onClick={() => handleAddVar(env.id)}
                    className="mt-0.5 flex w-full items-center gap-1 px-3 py-1 text-xs text-neutral-600 hover:text-neutral-400 focus:outline-none"
                  >
                    <Plus className="h-3 w-3" /> Add variable
                  </button>
                </div>
              )}
            </div>
          )
        })}

        {/* Inline create input */}
        {creating && (
          <InlineInput
            onConfirm={handleCreate}
            onCancel={() => setCreating(false)}
          />
        )}
      </div>

      {/* Footer: New Environment button */}
      <div className="shrink-0 border-t border-neutral-800 px-2 py-2">
        <button
          onClick={() => setCreating(true)}
          className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 focus:outline-none"
        >
          <Plus className="h-3.5 w-3.5" /> New Environment
        </button>
      </div>
    </div>
  )
}
