import { Check, Database, GitBranch, Github, Globe, KeyRound, Loader2, UserRound } from 'lucide-react'
import React, { useState } from 'react'
import type { Integration } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useCollectionsStore } from '@/store/collections'
import { useIntegrationsStore } from '@/store/integrations'
import { useUIStore } from '@/store/ui'

type Phase = 'url' | 'collection' | 'importing' | 'done'
type Mode = 'git' | 'backstage'

type BsProvider = 'guest' | 'token' | 'gitlab' | 'github' | 'google'

const BS_PROVIDERS: { value: BsProvider; icon: React.ReactNode; label: string }[] = [
  { value: 'guest',  icon: <UserRound className="h-4 w-4" />,  label: 'Guest'  },
  { value: 'token',  icon: <KeyRound className="h-4 w-4" />,   label: 'Token'  },
  { value: 'gitlab', icon: <GitBranch className="h-4 w-4" />,  label: 'GitLab' },
  { value: 'github', icon: <Github className="h-4 w-4" />,     label: 'GitHub' },
  { value: 'google', icon: <Globe className="h-4 w-4" />,      label: 'Google' },
]

function BsProviderPicker({ value, onChange }: { value: BsProvider; onChange: (v: BsProvider) => void }) {
  return (
    <div className="flex gap-1.5">
      {BS_PROVIDERS.map((p) => (
        <button
          key={p.value}
          type="button"
          onClick={() => onChange(p.value)}
          title={p.label}
          className={[
            'flex flex-1 flex-col items-center gap-1 rounded-sm border px-2 py-2 text-[10px] font-medium transition-colors focus:outline-hidden',
            value === p.value
              ? 'border-blue-500 bg-blue-500/10 text-blue-400'
              : 'border-th-border text-th-text-muted hover:border-th-border-strong hover:text-th-text-secondary',
          ].join(' ')}
        >
          {p.icon}
          {p.label}
        </button>
      ))}
    </div>
  )
}

function inferRepoName(raw: string): string {
  try {
    const clean = raw.trim().replace(/\.git$/, '')
    const parts = clean.replace(/^git@[^:]+:/, 'https://fake/').split('/').filter(Boolean)
    return parts.slice(-2).join('/') || clean
  } catch {
    return raw
  }
}

export function IntegrationSetupPage() {
  const { load: loadIntegrations } = useIntegrationsStore()
  const integrations = useIntegrationsStore((s) => s.integrations)
  const { load: loadCollections } = useCollectionsStore()
  const collections = useCollectionsStore((s) => s.collections)
  const selectItem = useUIStore((s) => s.selectItem)

  const [mode, setMode] = useState<Mode | null>(null)
  const [phase, setPhase] = useState<Phase>('url')

  // Git form — URL step
  const [repoUrl, setRepoUrl] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [connectedUser, setConnectedUser] = useState<Integration['connectedUser']>(null)
  const [integrationId, setIntegrationId] = useState('')

  // Collection step
  type CollectionTarget = { mode: 'new'; name: string } | { mode: 'existing'; id: string; name: string }
  const [target, setTarget] = useState<CollectionTarget>({ mode: 'new', name: '' })

  // Done
  const [doneCollectionId, setDoneCollectionId] = useState('')

  // Backstage form
  const [bsUrl, setBsUrl] = useState('http://localhost:7007')
  const [bsName, setBsName] = useState('Backstage')
  const [bsToken, setBsToken] = useState('')
  const [bsProvider, setBsProvider] = useState<'token' | 'guest' | 'gitlab' | 'github' | 'google'>('guest')

  const [error, setError] = useState<string | null>(null)

  // ── Connect (URL step) ────────────────────────────────────────────────────

  const handleConnect = async () => {
    setError(null)
    setConnecting(true)
    try {
      const api = window.api

      if (mode === 'git') {
        if (!repoUrl.trim()) { setError('Repository URL is required'); setConnecting(false); return }

        // Reuse an existing integration for the same repo URL to avoid duplicates
        const existingIntegration = integrations.find(
          (i) => i.repo === repoUrl.trim() && i.type === 'git'
        )

        let id: string
        if (existingIntegration) {
          id = existingIntegration.id
        } else {
          const { data: createData, error: createErr } = await api.integrations.create({
            type: 'git',
            name: repoNameFromUrl(repoUrl),
            baseUrl: '',
            repo: repoUrl.trim(),
            branch: 'main',
          })
          if (createErr) { setError(createErr); setConnecting(false); return }
          id = (createData as Record<string, unknown>).id as string
        }
        setIntegrationId(id)

        // Test connectivity — also detects + stores the default branch
        const { data: connData, error: connErr } = await api.integrations.connect({ id })
        if (connErr) {
          // Delete the integration we just created so it doesn't leave orphaned folders
          if (!existingIntegration) await api.integrations.delete({ id })
          setIntegrationId('')
          setError(connErr)
          setConnecting(false)
          return
        }

        const u = (connData as Record<string, unknown>)?.connected_user
        try { setConnectedUser(typeof u === 'string' ? JSON.parse(u) : null) } catch { /* ok */ }

        // Pre-fill collection name from URL
        setTarget({ mode: 'new', name: repoNameFromUrl(repoUrl) })
        await loadIntegrations()
        setPhase('collection')

      } else {
        const { data: createData, error: createErr } = await api.integrations.create({
          type: 'backstage',
          name: bsName.trim() || 'Backstage',
          baseUrl: bsUrl.trim(),
          repo: '',
          branch: 'main',
          clientId: bsProvider,
        })
        if (createErr) { setError(createErr); setConnecting(false); return }
        const id = (createData as Record<string, unknown>).id as string
        if (bsProvider === 'token' && bsToken) await api.integrations.update({ id, token: bsToken })
        const { error: connErr } = await api.integrations.connect({ id })
        if (connErr) { setError(connErr); setConnecting(false); return }
        setConnectedUser({ name: 'Backstage', avatarUrl: '' })
        setPhase('done')
        await loadIntegrations()
        await loadCollections()
      }
    } catch (e) {
      setError(String(e))
    }
    setConnecting(false)
  }

  // ── Import (collection step) ───────────────────────────────────────────────

  const handleImport = async () => {
    setError(null)
    setPhase('importing')
    try {
      const { data, error: importErr } = await window.api.git.import({
        integrationId,
        collectionId: target.mode === 'existing' ? target.id : undefined,
        collectionName: target.mode === 'new' ? target.name : target.name,
      })
      if (importErr) { setError(importErr); setPhase('collection'); return }
      const col = data as { id: string; name: string } | null
      if (col) setDoneCollectionId(col.id)
      await loadIntegrations()
      await loadCollections()
      setPhase('done')
    } catch (e) {
      setError(String(e))
      setPhase('collection')
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const subtitle = () => {
    if (mode === 'git') {
      if (phase === 'url') return 'Paste a clone URL'
      if (phase === 'collection') return 'Choose a collection'
      if (phase === 'importing') return 'Importing APIs…'
      return 'Done!'
    }
    if (mode === 'backstage') return 'Configure Backstage'
    return 'Choose a source type'
  }

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-th-bg">
      <div className="drag-region flex shrink-0 items-center justify-between border-b border-th-border px-6 pt-8 pb-4">
        <div className="no-drag">
          <h1 className="text-sm font-semibold text-th-text-primary">Add Git Source</h1>
          <p className="text-xs text-th-text-subtle">{subtitle()}</p>
        </div>
      </div>

      <div className="flex flex-1 items-start justify-center px-6 py-12">
        <div className="w-full max-w-md">

          {/* ── Source type picker ─────────────────────────────────────── */}
          {!mode && (
            <div className="flex flex-col gap-3">
              <button
                onClick={() => { setMode('git'); setPhase('url') }}
                className="flex items-center gap-4 rounded-lg border border-th-border-strong bg-th-surface-raised/50 px-4 py-3 text-left transition-colors hover:border-th-text-muted hover:bg-th-surface-raised focus:outline-hidden"
              >
                <GitBranch className="h-6 w-6 text-th-text-secondary" />
                <div>
                  <div className="text-sm font-medium text-th-text-primary">Git repository</div>
                  <div className="text-xs text-th-text-subtle">GitHub, GitLab, Azure DevOps, self-hosted — uses your local git credentials</div>
                </div>
              </button>
              <button
                onClick={() => { setMode('backstage'); setPhase('url') }}
                className="flex items-center gap-4 rounded-lg border border-th-border-strong bg-th-surface-raised/50 px-4 py-3 text-left transition-colors hover:border-th-text-muted hover:bg-th-surface-raised focus:outline-hidden"
              >
                <Database className="h-6 w-6 text-th-text-secondary" />
                <div>
                  <div className="text-sm font-medium text-th-text-primary">Backstage</div>
                  <div className="text-xs text-th-text-subtle">Backstage software catalog</div>
                </div>
              </button>
            </div>
          )}

          {/* ── Git: URL step ──────────────────────────────────────────── */}
          {mode === 'git' && phase === 'url' && (
            <div className="flex flex-col gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Repository URL</label>
                <Input
                  autoFocus
                  placeholder="https://github.com/org/repo.git   or   git@github.com:org/repo.git"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  className="font-mono text-xs"
                />
                <p className="mt-1 text-[11px] text-th-text-faint">
                  Uses your local git credentials — no token or OAuth app needed.
                </p>
              </div>

              {error && <p className="rounded-sm bg-rose-900/30 px-3 py-2 text-xs text-rose-400">{error}</p>}

              <div className="flex gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={() => { setMode(null); setError(null) }}>Back</Button>
                <Button size="sm" className="ml-auto" onClick={handleConnect} disabled={connecting || !repoUrl.trim()}>
                  {connecting ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Connecting…</> : 'Connect'}
                </Button>
              </div>
            </div>
          )}

          {/* ── Git: Collection picker step ────────────────────────────── */}
          {mode === 'git' && phase === 'collection' && (
            <div className="flex flex-col gap-5">
              <p className="text-xs text-th-text-subtle">
                All APIs discovered in <span className="font-mono text-th-text-secondary">{repoUrl.replace(/\.git$/, '').split('/').slice(-1)[0]}</span> will be imported into this collection.
              </p>

              {/* New collection */}
              <div>
                <button
                  onClick={() => setTarget({ mode: 'new', name: target.mode === 'new' ? target.name : repoNameFromUrl(repoUrl) })}
                  className={`mb-2 flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus:outline-hidden ${
                    target.mode === 'new'
                      ? 'border-th-accent bg-th-accent/10'
                      : 'border-th-border hover:border-th-border-strong'
                  }`}
                >
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${target.mode === 'new' ? 'border-th-accent' : 'border-th-border-strong'}`}>
                    {target.mode === 'new' && <span className="h-2 w-2 rounded-full bg-th-accent" />}
                  </span>
                  <span className="text-xs font-medium text-th-text-primary">Create new collection</span>
                </button>
                {target.mode === 'new' && (
                  <Input
                    autoFocus
                    placeholder="Collection name"
                    value={target.name}
                    onChange={(e) => setTarget({ mode: 'new', name: e.target.value })}
                    className="ml-7 w-[calc(100%-1.75rem)]"
                  />
                )}
              </div>

              {/* Existing collections */}
              {collections.length > 0 && (
                <div>
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-th-text-faint">Or add to existing</p>
                  <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                    {collections.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setTarget({ mode: 'existing', id: c.id, name: c.name })}
                        className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors focus:outline-hidden ${
                          target.mode === 'existing' && target.id === c.id
                            ? 'border-th-accent bg-th-accent/10'
                            : 'border-th-border hover:border-th-border-strong'
                        }`}
                      >
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${target.mode === 'existing' && target.id === c.id ? 'border-th-accent' : 'border-th-border-strong'}`}>
                          {target.mode === 'existing' && target.id === c.id && <span className="h-2 w-2 rounded-full bg-th-accent" />}
                        </span>
                        <span className="truncate text-xs text-th-text-primary">{c.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {error && <p className="rounded-sm bg-rose-900/30 px-3 py-2 text-xs text-rose-400">{error}</p>}

              <div className="flex gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={() => { setPhase('url'); setError(null) }}>Back</Button>
                <Button
                  size="sm"
                  className="ml-auto"
                  onClick={handleImport}
                  disabled={target.mode === 'new' ? !target.name.trim() : false}
                >
                  Import
                </Button>
              </div>
            </div>
          )}

          {/* ── Importing spinner ──────────────────────────────────────── */}
          {mode === 'git' && phase === 'importing' && (
            <div className="flex flex-col items-center gap-4">
              <Loader2 className="h-8 w-8 animate-spin text-th-text-muted" />
              <p className="text-sm text-th-text-subtle">Cloning repository and discovering APIs…</p>
            </div>
          )}

          {/* ── Done ───────────────────────────────────────────────────── */}
          {phase === 'done' && (
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/20 text-green-400">
                <Check className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-th-text-primary">
                {mode === 'git' ? 'APIs imported!' : 'Connected!'}
              </p>
              {connectedUser && (
                <p className="text-xs text-th-text-subtle">Connected as {connectedUser.name}</p>
              )}
              <Button size="sm" className="mt-2 w-full" onClick={() => {
                if (doneCollectionId) selectItem('collection', doneCollectionId)
                else selectItem('collection', '')
              }}>
                {doneCollectionId ? 'Open collection' : 'Done'}
              </Button>
            </div>
          )}

          {/* ── Backstage form ─────────────────────────────────────────── */}
          {mode === 'backstage' && phase === 'url' && (
            <div className="flex flex-col gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Base URL</label>
                <Input placeholder="http://localhost:7007" value={bsUrl} onChange={(e) => setBsUrl(e.target.value)} />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Name</label>
                <Input placeholder="Backstage" value={bsName} onChange={(e) => setBsName(e.target.value)} />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Authentication</label>
                <BsProviderPicker value={bsProvider} onChange={setBsProvider} />
              </div>
              {bsProvider === 'token' && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Token</label>
                  <Input type="password" placeholder="Service account token" value={bsToken} onChange={(e) => setBsToken(e.target.value)} />
                </div>
              )}
              {bsProvider !== 'token' && bsProvider !== 'guest' && (
                <p className="text-xs text-th-text-subtle">A browser window will open to sign in via {bsProvider.charAt(0).toUpperCase() + bsProvider.slice(1)}.</p>
              )}

              {error && <p className="rounded-sm bg-rose-900/30 px-3 py-2 text-xs text-rose-400">{error}</p>}

              <div className="flex gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={() => { setMode(null); setError(null) }}>Back</Button>
                <Button size="sm" className="ml-auto" onClick={handleConnect} disabled={connecting}>
                  {connecting ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Connecting…</> : 'Connect'}
                </Button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
