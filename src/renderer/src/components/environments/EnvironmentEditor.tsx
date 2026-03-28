import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import { useEnvironmentsStore } from '@/store/environments'
import { useUIStore } from '@/store/ui'
import { cn } from '@/lib/utils'

// ─── Variable row ─────────────────────────────────────────────────────────────

function VarRow({
  varItem,
  onChangeKey,
  onChangeValue,
  onToggleSecret,
  onDelete,
}: {
  varItem: { id: string; key: string; value: string; isSecret: boolean }
  onChangeKey: (v: string) => void
  onChangeValue: (v: string) => void
  onToggleSecret: () => void
  onDelete: () => void
}) {
  const [reveal, setReveal] = useState(false)

  return (
    <div className="group/row grid grid-cols-[1fr_1fr_36px_36px] items-center gap-2">
      <input
        value={varItem.key}
        onChange={(e) => onChangeKey(e.target.value)}
        placeholder="VARIABLE_NAME"
        className="rounded-md border border-neutral-700 bg-neutral-800/50 px-3 py-2 font-mono text-sm text-neutral-200 placeholder-neutral-600 outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/20"
      />
      <input
        type={varItem.isSecret && !reveal ? 'password' : 'text'}
        value={varItem.value}
        onChange={(e) => onChangeValue(e.target.value)}
        placeholder="value"
        className="rounded-md border border-neutral-700 bg-neutral-800/50 px-3 py-2 font-mono text-sm text-neutral-200 placeholder-neutral-600 outline-none focus:border-blue-500/60 focus:ring-1 focus:ring-blue-500/20"
      />
      <button
        onClick={() => varItem.isSecret ? setReveal((r) => !r) : onToggleSecret()}
        title={varItem.isSecret ? (reveal ? 'Hide value' : 'Reveal value') : 'Mark as secret'}
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-md border transition-colors focus:outline-none',
          varItem.isSecret
            ? 'border-amber-700/50 bg-amber-900/20 text-amber-400 hover:bg-amber-900/40'
            : 'border-neutral-700 bg-neutral-800/50 text-neutral-600 opacity-0 hover:text-neutral-400 group-hover/row:opacity-100'
        )}
      >
        {varItem.isSecret && !reveal
          ? <EyeOff className="h-4 w-4" />
          : <Eye className="h-4 w-4" />}
      </button>
      <button
        onClick={onDelete}
        className="flex h-9 w-9 items-center justify-center rounded-md border border-neutral-700 bg-neutral-800/50 text-neutral-600 opacity-0 transition-colors hover:border-rose-700/50 hover:bg-rose-900/20 hover:text-rose-400 focus:outline-none group-hover/row:opacity-100"
        title="Delete variable"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}

// ─── Main editor ──────────────────────────────────────────────────────────────

export function EnvironmentEditor() {
  const { environments, vars, deleteEnvironment, setActive, upsertVar, deleteVar } = useEnvironmentsStore()
  const { selectedEnvId, setSelectedEnvId } = useUIStore()

  const env = environments.find((e) => e.id === selectedEnvId) ?? null
  const envVars = vars.filter((v) => v.envId === selectedEnvId)

  // Local name state for rename
  const [name, setName] = useState(env?.name ?? '')
  useEffect(() => { setName(env?.name ?? '') }, [env?.id])

  const handleNameBlur = async () => {
    if (!env || !name.trim() || name.trim() === env.name) return
    await (window as any).api.environments.rename({ id: env.id, name: name.trim() })
    // reload via store
    useEnvironmentsStore.getState().load()
  }

  const handleAddVar = () => {
    if (!env) return
    upsertVar(env.id, '', '', false, crypto.randomUUID())
  }

  const handleDelete = async () => {
    if (!env) return
    await deleteEnvironment(env.id)
    setSelectedEnvId(null)
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!env) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 text-neutral-600">
        <div className="rounded-full border border-neutral-800 p-6">
          <svg className="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.2}
              d="M3.75 9h16.5m-16.5 6.75h16.5M3 4.5h18M3 19.5h18" />
          </svg>
        </div>
        <p className="text-sm">Select an environment to edit</p>
        <p className="text-xs text-neutral-700">or create one from the sidebar</p>
      </div>
    )
  }

  // ── Editor ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-neutral-950">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-800 px-6 py-4">
        <div className="flex items-center gap-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={handleNameBlur}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            className="bg-transparent text-lg font-semibold text-neutral-100 outline-none placeholder-neutral-600 focus:border-b focus:border-blue-500"
          />
        </div>

        <div className="flex items-center gap-2">
          {!env.isActive && (
            <button
              onClick={() => setActive(env.id)}
              className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-400 transition-colors hover:border-emerald-700/60 hover:bg-emerald-900/20 hover:text-emerald-400 focus:outline-none"
            >
              Set as active
            </button>
          )}
          <button
            onClick={handleDelete}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-500 transition-colors hover:border-rose-700/50 hover:bg-rose-900/20 hover:text-rose-400 focus:outline-none"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Variables */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium text-neutral-400">Variables</h3>
          <span className="text-xs text-neutral-600">{envVars.length} variable{envVars.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Column headers */}
        {envVars.length > 0 && (
          <div className="mb-2 grid grid-cols-[1fr_1fr_36px_36px] gap-2 px-0.5">
            <span className="text-xs font-medium uppercase tracking-wide text-neutral-600">Key</span>
            <span className="text-xs font-medium uppercase tracking-wide text-neutral-600">Value</span>
            <span />
            <span />
          </div>
        )}

        <div className="flex flex-col gap-2">
          {envVars.map((v) => (
            <VarRow
              key={v.id}
              varItem={v}
              onChangeKey={(key) => upsertVar(env.id, key, v.value, v.isSecret, v.id)}
              onChangeValue={(value) => upsertVar(env.id, v.key, value, v.isSecret, v.id)}
              onToggleSecret={() => upsertVar(env.id, v.key, v.value, !v.isSecret, v.id)}
              onDelete={() => deleteVar(v.id)}
            />
          ))}

          {envVars.length === 0 && (
            <p className="py-4 text-sm italic text-neutral-600">No variables yet — add one below</p>
          )}
        </div>

        <button
          onClick={handleAddVar}
          className="mt-4 flex items-center gap-2 rounded-md border border-dashed border-neutral-700 px-4 py-2.5 text-sm text-neutral-500 transition-colors hover:border-neutral-500 hover:text-neutral-300 focus:outline-none"
        >
          <Plus className="h-4 w-4" /> Add variable
        </button>
      </div>
    </div>
  )
}
