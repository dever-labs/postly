import { DiffEditor } from '@monaco-editor/react'
import {
  AlertCircle,
  Check,
  ChevronDown,
  FileCode,
  GitBranch,
  GitCommit,
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
import type { DiffResult } from '@/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DirtyRequest {
  id: string
  group_id: string
  scm_path: string
  request_name: string
  group_name: string
}

interface CommitState {
  requestId: string
  commitMessage: string
  selectedBranch: string
  newBranchName: string
  fromBranch: string
  isNewBranch: boolean
  committing: boolean
  showDiff: boolean
  diff: DiffResult | null
  loadingDiff: boolean
}

// ─── Source icon helper ────────────────────────────────────────────────────────

function ProviderIcon({ type, className }: { type: string; className?: string }) {
  if (type === 'github') return <GitFork className={className} />
  return <GitBranch className={className} />
}

// ─── Inline commit for a single dirty request ─────────────────────────────────

function RequestCommitRow({
  req,
  branches,
  theme,
  onCommitted,
}: {
  req: DirtyRequest
  branches: string[]
  theme: string
  onCommitted: () => void
}) {
  const addToast = useUIStore((s) => s.addToast)
  const [state, setState] = useState<CommitState>({
    requestId: req.id,
    commitMessage: '',
    selectedBranch: branches[0] ?? '',
    newBranchName: '',
    fromBranch: branches[0] ?? '',
    isNewBranch: false,
    committing: false,
    showDiff: false,
    diff: null,
    loadingDiff: false,
  })
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setState((s) => ({ ...s, selectedBranch: branches[0] ?? '', fromBranch: branches[0] ?? '' }))
  }, [branches])

  const handleShowDiff = async () => {
    if (state.showDiff) { setState((s) => ({ ...s, showDiff: false })); return }
    setState((s) => ({ ...s, loadingDiff: true }))
    const { data } = await window.api.git.diff({ requestId: req.id })
    setState((s) => ({ ...s, diff: data ?? null, showDiff: true, loadingDiff: false }))
  }

  const handleCommit = async () => {
    if (!state.commitMessage.trim()) return
    setState((s) => ({ ...s, committing: true }))

    const branch = state.isNewBranch ? state.newBranchName : state.selectedBranch
    const { error } = await window.api.git.commit({
      requestId: req.id,
      commitMessage: state.commitMessage,
      branch,
      fromBranch: state.isNewBranch ? state.fromBranch : undefined,
      content: '', // content resolved on backend from request body_content
    })

    setState((s) => ({ ...s, committing: false }))
    if (error) {
      addToast(`Commit failed: ${error}`, 'error')
    } else {
      addToast(`Committed "${req.request_name}"`, 'success')
      onCommitted()
    }
  }

  return (
    <div className="rounded-md border border-th-border bg-th-surface">
      {/* Header row */}
      <button
        onClick={() => setExpanded((x) => !x)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-th-surface-raised/40"
      >
        <FileCode className="h-3.5 w-3.5 shrink-0 text-amber-400" />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm text-th-text-primary">{req.request_name}</span>
          <span className="block truncate text-xs text-th-text-faint">{req.group_name} · {req.scm_path}</span>
        </div>
        <span className="shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-400">
          uncommitted
        </span>
        <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-th-text-faint transition-transform', expanded && 'rotate-180')} />
      </button>

      {expanded && (
        <div className="border-t border-th-border px-3 pb-3 pt-2">
          <div className="flex flex-col gap-2">
            <Input
              placeholder="Commit message…"
              value={state.commitMessage}
              onChange={(e) => setState((s) => ({ ...s, commitMessage: e.target.value }))}
            />

            {/* Branch selector */}
            {!state.isNewBranch ? (
              <Select
                value={state.selectedBranch}
                onValueChange={(v) => {
                  if (v === '__new__') setState((s) => ({ ...s, isNewBranch: true, selectedBranch: '' }))
                  else setState((s) => ({ ...s, selectedBranch: v }))
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select branch…" />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  <SelectItem value="__new__">
                    <span className="flex items-center gap-1.5"><Plus className="h-3 w-3" />New branch…</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <div className="flex gap-2">
                <Input
                  placeholder="New branch name"
                  value={state.newBranchName}
                  onChange={(e) => setState((s) => ({ ...s, newBranchName: e.target.value }))}
                  className="flex-1"
                />
                <Select value={state.fromBranch} onValueChange={(v) => setState((s) => ({ ...s, fromBranch: v }))}>
                  <SelectTrigger className="w-36">
                    <SelectValue placeholder="From…" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="sm" onClick={() => setState((s) => ({ ...s, isNewBranch: false, newBranchName: '' }))}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleShowDiff} disabled={state.loadingDiff}>
                {state.loadingDiff ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {state.showDiff ? 'Hide diff' : 'Show diff'}
              </Button>
              <Button
                size="sm"
                className="ml-auto"
                onClick={handleCommit}
                disabled={state.committing || !state.commitMessage.trim()}
              >
                {state.committing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCommit className="h-3.5 w-3.5" />}
                {state.committing ? 'Committing…' : 'Commit'}
              </Button>
            </div>

            {state.showDiff && state.diff && (
              <div className="overflow-hidden rounded-sm border border-th-border">
                <DiffEditor
                  height="180px"
                  language="json"
                  theme={theme === 'light' ? 'vs' : 'vs-dark'}
                  original={state.diff.remoteContent}
                  modified={state.diff.localContent}
                  options={{ readOnly: true, minimap: { enabled: false }, fontSize: 11 }}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function GitSourceView({ collectionId }: { collectionId: string }) {
  const theme = useUIStore((s) => s.theme)
  const addToast = useUIStore((s) => s.addToast)
  const selectItem = useUIStore((s) => s.selectItem)

  const collection = useCollectionsStore((s) => s.collections.find((c) => c.id === collectionId))
  const { load: loadCollections } = useCollectionsStore()

  const integrations = useIntegrationsStore((s) => s.integrations)
  const { update: updateIntegration } = useIntegrationsStore()

  const integration = integrations.find((i) => i.id === collection?.integrationId)
    ?? integrations.find((i) => i.type === collection?.source && (collection?.source === 'github' || collection?.source === 'gitlab'))
    ?? null

  const [branches, setBranches] = useState<string[]>([])
  const [loadingBranches, setLoadingBranches] = useState(false)
  const [currentBranch, setCurrentBranch] = useState(integration?.branch ?? 'main')
  const [showNewBranch, setShowNewBranch] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')
  const [fromBranch, setFromBranch] = useState('')
  const [creatingBranch, setCreatingBranch] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [dirtyRequests, setDirtyRequests] = useState<DirtyRequest[]>([])
  const [loadingDirty, setLoadingDirty] = useState(false)

  // Load branches and dirty requests on mount
  useEffect(() => {
    if (!integration) return
    loadBranches()
    loadDirtyRequests()
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

  const loadDirtyRequests = async () => {
    setLoadingDirty(true)
    const { data } = await window.api.git.dirtyRequests({ collectionId })
    setLoadingDirty(false)
    setDirtyRequests(data ?? [])
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
    await loadCollections()
    await loadDirtyRequests()
    addToast('Synced from remote', 'success')
  }

  // ── Empty / no-integration state ──────────────────────────────────────────

  if (!collection) return null

  if (!integration) {
    return (
      <div className="flex h-full flex-1 flex-col bg-th-bg">
        <div className="drag-region shrink-0 px-6 pt-8 pb-4" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-th-text-faint">
          <AlertCircle className="h-10 w-10" />
          <p className="text-sm">No Git integration found for this collection</p>
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
            <h1 className="truncate text-sm font-semibold text-th-text-primary">{collection.name}</h1>
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

        {/* ── Uncommitted changes section ───────────────────────────────────── */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-th-text-faint">
              <GitCommit className="h-3.5 w-3.5" />
              Uncommitted changes
              {dirtyRequests.length > 0 && (
                <span className="ml-1 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-400">
                  {dirtyRequests.length}
                </span>
              )}
            </h2>
            <button
              onClick={loadDirtyRequests}
              className="text-xs text-th-text-faint hover:text-th-text-muted transition-colors"
            >
              Refresh
            </button>
          </div>

          {loadingDirty ? (
            <div className="flex items-center gap-2 py-3 text-sm text-th-text-faint">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking for changes…
            </div>
          ) : dirtyRequests.length === 0 ? (
            <div className="flex items-center gap-2 rounded-md border border-th-border bg-th-surface px-4 py-3 text-sm text-th-text-faint">
              <Check className="h-4 w-4 text-emerald-400" />
              All changes committed
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {dirtyRequests.map((req) => (
                <RequestCommitRow
                  key={req.id}
                  req={req}
                  branches={branches}
                  theme={theme}
                  onCommitted={() => {
                    setDirtyRequests((prev) => prev.filter((r) => r.id !== req.id))
                    loadCollections()
                  }}
                />
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
