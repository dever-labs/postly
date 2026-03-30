import {
  AlertCircle,
  Check,
  FolderOpen,
  GitBranch,
  GitFork,
  Loader2,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react'
import React, { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { useCollectionsStore } from '@/store/collections'
import { useIntegrationsStore } from '@/store/integrations'
import { useUIStore } from '@/store/ui'
import { cn } from '@/lib/utils'

// ─── Source icon helper ────────────────────────────────────────────────────────

function ProviderIcon({ type, className }: { type: string; className?: string }) {
  if (type === 'github') return <GitFork className={className} />
  return <GitBranch className={className} />
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function GitSourceView({ integrationId }: { integrationId: string }) {
  const addToast = useUIStore((s) => s.addToast)
  const selectItem = useUIStore((s) => s.selectItem)

  const allCollections = useCollectionsStore((s) => s.collections)
  const collections = allCollections.filter((c) => c.integrationId === integrationId)

  const integrations = useIntegrationsStore((s) => s.integrations)
  const updateIntegration = useIntegrationsStore((s) => s.update)

  const integration = integrations.find((i) => i.id === integrationId) ?? null

  const [branches, setBranches] = useState<string[]>([])
  const [loadingBranches, setLoadingBranches] = useState(false)
  const [currentBranch, setCurrentBranch] = useState(integration?.branch ?? 'main')
  const [showNewBranch, setShowNewBranch] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [fromBranch, setFromBranch] = useState('')
  const [creatingBranch, setCreatingBranch] = useState(false)
  const [syncing, setSyncing] = useState(false)

  // Load branches on mount
  useEffect(() => {
    if (!integration) return
    loadBranches()
  }, [integration?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setCurrentBranch(integration?.branch ?? 'main')
  }, [integration?.branch])

  const loadBranches = async () => {
    if (!integration) return
    setLoadingBranches(true)
    const { data, error } = await window.api.git.listBranches({ integrationId: integration.id })
    setLoadingBranches(false)
    if (error) { addToast(`Failed to load branches: ${error}`, 'error'); return }
    setBranches(data ?? [])
    if (!fromBranch) setFromBranch(data?.[0] ?? 'main')
  }

  const handleSwitchBranch = async (branch: string) => {
    if (!integration || branch === currentBranch) return
    setCurrentBranch(branch)
    await window.api.git.switchBranch({ integrationId: integration.id, branch })
    await updateIntegration(integration.id, { branch })
    addToast(`Switched to ${branch}`, 'success')
  }

  const handleCreateBranch = async () => {
    if (!integration || !newBranchName.trim()) return
    setCreatingBranch(true)
    const { error } = await window.api.git.createBranch({
      integrationId: integration.id,
      newBranch: newBranchName.trim(),
      fromBranch: fromBranch || currentBranch,
    })
    setCreatingBranch(false)
    if (error) { addToast(`Failed to create branch: ${error}`, 'error'); return }
    addToast(`Created branch "${newBranchName.trim()}"`, 'success')
    setNewBranchName('')
    setShowNewBranch(false)
    await loadBranches()
    handleSwitchBranch(newBranchName.trim())
  }

  const handleSync = async () => {
    if (!integration) return
    setSyncing(true)
    const { error } = await window.api.git.sync({ integrationId: integration.id })
    setSyncing(false)
    if (error) { addToast(`Sync failed: ${error}`, 'error'); return }
    addToast('Synced from remote', 'success')
  }

  // ── No-integration state ──────────────────────────────────────────────────

  if (!integration) {
    return (
      <div className="flex h-full flex-1 flex-col bg-th-bg">
        <div className="drag-region shrink-0 px-6 pt-8 pb-4" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-th-text-faint">
          <AlertCircle className="h-10 w-10" />
          <p className="text-sm">Git integration not found</p>
          <Button size="sm" variant="outline" onClick={() => selectItem('add-integration', '')}>
            Add Git integration
          </Button>
        </div>
      </div>
    )
  }

  const providerLabel = integration.type === 'github' ? 'GitHub' : integration.type === 'gitlab' ? 'GitLab' : 'Git'

  // ── Main view ─────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden bg-th-bg">
      {/* Header */}
      <div className="drag-region flex shrink-0 items-center justify-between border-b border-th-border pl-6 pr-48 pt-8 pb-4">
        <div className="no-drag flex min-w-0 flex-1 items-center gap-3">
          <ProviderIcon type={integration.type} className="h-4 w-4 shrink-0 text-th-text-muted" />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-th-text-primary">{integration.name}</h1>
            <p className="text-xs text-th-text-subtle">{providerLabel} · {integration.repo}</p>
          </div>
        </div>

        <div className="no-drag flex shrink-0 items-center gap-2">
          {/* Integration status */}
          <span className={cn(
            'rounded-full px-2 py-0.5 text-xs font-medium',
            integration.status === 'connected'
              ? 'bg-emerald-900/20 text-emerald-400'
              : integration.status === 'error'
              ? 'bg-rose-900/20 text-rose-400'
              : 'bg-th-surface text-th-text-faint'
          )}>
            {integration.status}
          </span>

          {/* Sync button */}
          <Button
            size="sm"
            variant="outline"
            onClick={handleSync}
            disabled={syncing || integration.status !== 'connected'}
            className="gap-1.5"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', syncing && 'animate-spin')} />
            {syncing ? 'Syncing…' : 'Sync'}
          </Button>

          {/* Edit integration */}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => selectItem('edit-integration', integration.id)}
          >
            Settings
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

        {/* ── Collections section ───────────────────────────────────────────── */}
        {collections.length > 0 && (
          <section>
            <h2 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-th-text-faint">
              <FolderOpen className="h-3.5 w-3.5" />
              Collections
            </h2>
            <div className="flex flex-col gap-1">
              {collections.map((c) => (
                <button
                  key={c.id}
                  onClick={() => selectItem('collection', c.id)}
                  className="flex items-center gap-2 rounded-md border border-th-border bg-th-surface px-3 py-2 text-sm text-th-text-secondary hover:bg-th-surface-raised hover:text-th-text-primary text-left transition-colors"
                >
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-th-text-muted" />
                  {c.name}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* ── Branches section ─────────────────────────────────────────────── */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-th-text-faint">
              <GitBranch className="h-3.5 w-3.5" />
              Branches
            </h2>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 px-2 text-xs"
              onClick={() => { setShowNewBranch((x) => !x); setNewBranchName('') }}
            >
              <Plus className="h-3 w-3" />
              New
            </Button>
          </div>

          {/* New branch form */}
          {showNewBranch && (
            <div className="mb-3 flex gap-2">
              <Input
                placeholder="branch-name"
                value={newBranchName}
                onChange={(e) => setNewBranchName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateBranch() }}
                className="flex-1 font-mono text-sm"
              />
              <Select value={fromBranch} onValueChange={setFromBranch}>
                <SelectTrigger className="w-32">
                  <SelectValue placeholder="From…" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={handleCreateBranch}
                disabled={creatingBranch || !newBranchName.trim()}
              >
                {creatingBranch ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                Create
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowNewBranch(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {/* Branch list */}
          {loadingBranches ? (
            <div className="flex items-center gap-2 py-3 text-sm text-th-text-faint">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading branches…
            </div>
          ) : branches.length === 0 ? (
            <p className="py-3 text-sm text-th-text-faint">No branches found</p>
          ) : (
            <div className="flex flex-col gap-1">
              {branches.map((b) => (
                <button
                  key={b}
                  onClick={() => handleSwitchBranch(b)}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors text-left',
                    b === currentBranch
                      ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                      : 'text-th-text-secondary hover:bg-th-surface-raised/60 border border-transparent'
                  )}
                >
                  <GitBranch className="h-3.5 w-3.5 shrink-0" />
                  <span className="font-mono">{b}</span>
                  {b === currentBranch && (
                    <span className="ml-auto text-[10px] font-medium uppercase tracking-wide">active</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── Connected user ────────────────────────────────────────────────── */}
        {integration.connectedUser && (
          <section className="border-t border-th-border pt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-th-text-faint">Connected as</p>
            <div className="flex items-center gap-3">
              {integration.connectedUser.avatarUrl && (
                <img
                  src={integration.connectedUser.avatarUrl}
                  alt={integration.connectedUser.name}
                  className="h-8 w-8 rounded-full border border-th-border"
                />
              )}
              <div>
                <p className="text-sm font-medium text-th-text-primary">{integration.connectedUser.name}</p>
                {(integration.connectedUser.login ?? integration.connectedUser.username) && (
                  <p className="text-xs text-th-text-muted">
                    @{integration.connectedUser.login ?? integration.connectedUser.username}
                  </p>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
