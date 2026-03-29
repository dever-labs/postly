import { Check, Eye, EyeOff, Plus, Save, Search, Trash2 } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import { useEnvironmentsStore } from '@/store/environments'
import { useUIStore } from '@/store/ui'
import { cn } from '@/lib/utils'
import type { EnvVar } from '@/types'

// ─── Variable row ─────────────────────────────────────────────────────────────

function VarRow({
  varItem,
  onChange,
  onDelete,
}: {
  varItem: EnvVar
  onChange: (updated: EnvVar) => void
  onDelete: () => void
}) {
  const [reveal, setReveal] = useState(false)

  return (
    <div className="group/row grid grid-cols-[1fr_1fr_36px_36px] items-center gap-2">
      <input
        value={varItem.key}
        onChange={(e) => onChange({ ...varItem, key: e.target.value })}
        placeholder="VARIABLE_NAME"
        className="rounded-md border border-th-border bg-th-surface px-3 py-2 font-mono text-sm text-th-text-primary placeholder-th-text-faint outline-none focus:border-th-border-strong focus:outline-none"
      />
      <input
        type={varItem.isSecret && !reveal ? 'password' : 'text'}
        value={varItem.value}
        onChange={(e) => onChange({ ...varItem, value: e.target.value })}
        placeholder="value"
        className="rounded-md border border-th-border bg-th-surface px-3 py-2 font-mono text-sm text-th-text-primary placeholder-th-text-faint outline-none focus:border-th-border-strong focus:outline-none"
      />
      <button
        onClick={() => varItem.isSecret ? setReveal((r) => !r) : onChange({ ...varItem, isSecret: true })}
        title={varItem.isSecret ? (reveal ? 'Hide value' : 'Reveal value') : 'Mark as secret'}
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-md border transition-colors focus:outline-none',
          varItem.isSecret
            ? 'border-amber-700/50 bg-amber-900/20 text-amber-400 hover:bg-amber-900/40'
            : 'border-th-border bg-th-surface text-th-text-faint hover:text-th-text-muted'
        )}
      >
        {varItem.isSecret && !reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
      <button
        onClick={onDelete}
        className="flex h-9 w-9 items-center justify-center rounded-md border border-th-border bg-th-surface text-th-text-faint transition-colors hover:border-rose-700/50 hover:bg-rose-900/20 hover:text-rose-400 focus:outline-none"
        title="Delete variable"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}

// ─── Main editor ──────────────────────────────────────────────────────────────

export function EnvironmentEditor() {
  const { environments, vars, deleteEnvironment, setActive, upsertVar, deleteVar, load } = useEnvironmentsStore()
  const { selectedEnvId, setSelectedEnvId } = useUIStore()

  const env = environments.find((e) => e.id === selectedEnvId) ?? null
  const envVars = vars.filter((v) => v.envId === selectedEnvId)

  const [name, setName] = useState(env?.name ?? '')
  const [localVars, setLocalVars] = useState<EnvVar[]>([])
  const [saved, setSaved] = useState(false)
  const [varSearch, setVarSearch] = useState('')

  useEffect(() => { setName(env?.name ?? '') }, [env?.id, env?.name])
  useEffect(() => { setLocalVars(envVars) }, [env?.id, vars.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleNameBlur = async () => {
    if (!env || !name.trim() || name.trim() === env.name) return
    await window.api.environments.rename({ id: env.id, name: name.trim() })
    load()
  }

  const handleSave = async () => {
    if (!env) return
    for (const v of localVars) {
      await upsertVar(env.id, v.key, v.value, v.isSecret, v.id)
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleAddVar = () => {
    if (!env) return
    const newVar: EnvVar = { id: crypto.randomUUID(), envId: env.id, key: '', value: '', isSecret: false }
    setLocalVars((prev) => [...prev, newVar])
  }

  const handleDeleteVar = async (id: string) => {
    setLocalVars((prev) => prev.filter((v) => v.id !== id))
    await deleteVar(id)
  }

  const handleDelete = async () => {
    if (!env) return
    await deleteEnvironment(env.id)
    setSelectedEnvId(null)
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!env) {
    return (
      <div className="drag-region flex h-full flex-1 flex-col items-center justify-center gap-3 text-th-text-faint">
        <div className="no-drag rounded-full border border-th-border p-6">
          <svg className="h-10 w-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.2}
              d="M3.75 9h16.5m-16.5 6.75h16.5M3 4.5h18M3 19.5h18" />
          </svg>
        </div>
        <p className="no-drag text-sm">Select an environment to edit</p>
        <p className="no-drag text-xs text-th-text-faint">or create one from the sidebar</p>
      </div>
    )
  }

  // ── Editor ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-th-bg">
      {/* Header — drag-region; py-4 padding + name area are the drag target */}
      <div className="drag-region flex shrink-0 items-center justify-between border-b border-th-border px-6 pt-8 pb-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleNameBlur}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          className="no-drag bg-transparent text-lg font-semibold text-th-text-primary outline-none placeholder-th-text-faint focus:border-b focus:border-blue-500"
        />
        <button
          onClick={handleDelete}
          className="no-drag rounded-md border border-th-border-strong px-3 py-1.5 text-sm text-th-text-subtle transition-colors hover:border-rose-700/50 hover:bg-rose-900/20 hover:text-rose-400 focus:outline-none"
        >
          Delete
        </button>
      </div>

      {/* "Set as active" — below header so it's never behind window controls */}
      {!env.isActive && (
        <div className="flex shrink-0 items-center gap-3 border-b border-th-border px-6 py-2.5">
          <span className="text-xs text-th-text-faint">This environment is not active</span>
          <button
            onClick={() => setActive(env.id)}
            className="rounded-md border border-th-border-strong px-3 py-1 text-xs text-th-text-muted transition-colors hover:border-emerald-700/60 hover:bg-emerald-900/20 hover:text-emerald-400 focus:outline-none"
          >
            Set as active
          </button>
        </div>
      )}

      {/* Variables */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-th-text-faint" />
            <input
              value={varSearch}
              onChange={(e) => setVarSearch(e.target.value)}
              placeholder="Search variables…"
              className="w-full rounded border border-th-border-strong bg-th-surface py-1.5 pl-8 pr-3 text-sm text-th-text-primary placeholder:text-th-text-faint focus:border-th-border-strong focus:outline-none focus:ring-1 focus:ring-th-border-strong"
            />
          </div>
          <span className="shrink-0 text-xs text-th-text-faint">{localVars.length} variable{localVars.length !== 1 ? 's' : ''}</span>
        </div>

        {localVars.length > 0 && (
          <div className="mb-2 grid grid-cols-[1fr_1fr_36px_36px] gap-2 px-0.5">
            <span className="text-xs font-medium uppercase tracking-wide text-th-text-faint">Key</span>
            <span className="text-xs font-medium uppercase tracking-wide text-th-text-faint">Value</span>
            <span />
            <span />
          </div>
        )}

        <div className="flex flex-col gap-2">
          {localVars
            .filter((v) => !varSearch || v.key.toLowerCase().includes(varSearch.toLowerCase()) || v.value.toLowerCase().includes(varSearch.toLowerCase()))
            .map((v) => (
              <VarRow
                key={v.id}
                varItem={v}
                onChange={(updated) => setLocalVars((prev) => prev.map((x) => x.id === updated.id ? updated : x))}
                onDelete={() => handleDeleteVar(v.id)}
              />
            ))}
          {localVars.length === 0 && (
            <p className="py-4 text-sm italic text-th-text-faint">No variables yet — add one below</p>
          )}
          {localVars.length > 0 && varSearch && localVars.filter((v) => v.key.toLowerCase().includes(varSearch.toLowerCase()) || v.value.toLowerCase().includes(varSearch.toLowerCase())).length === 0 && (
            <p className="py-4 text-sm italic text-th-text-faint">No variables match "{varSearch}"</p>
          )}
        </div>

        <button
          onClick={handleAddVar}
          className="mt-4 flex items-center gap-2 rounded-md border border-dashed border-th-border-strong px-4 py-2.5 text-sm text-th-text-subtle transition-colors hover:border-th-text-muted hover:text-th-text-secondary focus:outline-none"
        >
          <Plus className="h-4 w-4" /> Add variable
        </button>

        <button
          onClick={handleSave}
          className={cn(
            'mt-2 flex items-center gap-1.5 rounded-md border px-4 py-2.5 text-sm transition-colors focus:outline-none',
            saved
              ? 'border-emerald-700/50 bg-emerald-900/20 text-emerald-400'
              : 'border-th-border-strong text-th-text-muted hover:border-blue-500/50 hover:bg-blue-500/10 hover:text-blue-400'
          )}
        >
          {saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>
    </div>
  )
}
