import { Check, Database, GitBranch, Loader2 } from 'lucide-react'
import React, { useState } from 'react'
import type { Integration } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useCollectionsStore } from '@/store/collections'
import { useIntegrationsStore } from '@/store/integrations'
import { useUIStore } from '@/store/ui'

type Mode = 'git' | 'backstage'

function parseRepoUrl(raw: string): { name: string; branch: string } {
  try {
    const clean = raw.trim().replace(/\.git$/, '')
    const parts = clean.replace(/^git@[^:]+:/, '').split('/').filter(Boolean)
    const last2 = parts.slice(-2).join('/')
    return { name: last2 || clean, branch: 'main' }
  } catch {
    return { name: raw, branch: 'main' }
  }
}

export function IntegrationSetupPage() {
  const { load: loadIntegrations } = useIntegrationsStore()
  const { load: loadCollections } = useCollectionsStore()
  const selectItem = useUIStore((s) => s.selectItem)

  const [mode, setMode] = useState<Mode | null>(null)

  // Git form state
  const [repoUrl, setRepoUrl] = useState('')
  const [name, setName] = useState('')
  const [branch, setBranch] = useState('main')

  // Backstage form state
  const [bsUrl, setBsUrl] = useState('http://localhost:7007')
  const [bsName, setBsName] = useState('Backstage')
  const [bsToken, setBsToken] = useState('')

  const [connecting, setConnecting] = useState(false)
  const [connectedUser, setConnectedUser] = useState<Integration['connectedUser']>(null)
  const [error, setError] = useState<string | null>(null)

  const handleUrlBlur = () => {
    if (repoUrl && !name) {
      setName(parseRepoUrl(repoUrl).name)
    }
  }

  const handleConnect = async () => {
    setError(null)
    setConnecting(true)
    try {
      const api = window.api

      if (mode === 'git') {
        if (!repoUrl.trim()) { setError('Repository URL is required'); setConnecting(false); return }
        const { data, error: createErr } = await api.integrations.create({
          type: 'git',
          name: name.trim() || parseRepoUrl(repoUrl).name,
          baseUrl: '',
          repo: repoUrl.trim(),
          branch: branch.trim() || 'main',
        })
        if (createErr) { setError(createErr); setConnecting(false); return }
        const id = (data as Record<string, unknown>).id as string
        const { data: connData, error: connErr } = await api.integrations.connect({ id })
        if (connErr) { setError(connErr); setConnecting(false); return }
        const user = (connData as Record<string, unknown>)?.connected_user
        try { setConnectedUser(typeof user === 'string' ? JSON.parse(user) : null) } catch { /* empty */ }
      } else {
        const { data, error: createErr } = await api.integrations.create({
          type: 'backstage',
          name: bsName.trim() || 'Backstage',
          baseUrl: bsUrl.trim(),
          repo: '',
          branch: 'main',
        })
        if (createErr) { setError(createErr); setConnecting(false); return }
        const id = (data as Record<string, unknown>).id as string
        if (bsToken) await api.integrations.update({ id, token: bsToken })
        const { error: connErr } = await api.integrations.connect({ id })
        if (connErr) { setError(connErr); setConnecting(false); return }
        setConnectedUser({ name: 'Backstage', avatarUrl: '' })
      }

      await loadIntegrations()
      await loadCollections()
    } catch (e) {
      setError(String(e))
    }
    setConnecting(false)
  }

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-th-bg">
      <div className="drag-region flex shrink-0 items-center justify-between border-b border-th-border px-6 pt-8 pb-4">
        <div className="no-drag">
          <h1 className="text-sm font-semibold text-th-text-primary">Add Git Source</h1>
          <p className="text-xs text-th-text-subtle">
            {!mode ? 'Choose a source type' : mode === 'git' ? 'Paste a repository URL' : 'Configure Backstage'}
          </p>
        </div>
      </div>

      <div className="flex flex-1 items-start justify-center px-6 py-12">
        <div className="w-full max-w-md">

          {/* Connected success */}
          {connectedUser && (
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/20 text-green-400">
                <Check className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-th-text-primary">Connected!</p>
              <Button size="sm" className="mt-2 w-full" onClick={() => selectItem('collection', '')}>Done</Button>
            </div>
          )}

          {/* Source type picker */}
          {!mode && !connectedUser && (
            <div className="flex flex-col gap-3">
              <button
                onClick={() => setMode('git')}
                className="flex items-center gap-4 rounded-lg border border-th-border-strong bg-th-surface-raised/50 px-4 py-3 text-left transition-colors hover:border-th-text-muted hover:bg-th-surface-raised focus:outline-hidden"
              >
                <GitBranch className="h-6 w-6 text-th-text-secondary" />
                <div>
                  <div className="text-sm font-medium text-th-text-primary">Git repository</div>
                  <div className="text-xs text-th-text-subtle">GitHub, GitLab, Azure DevOps, self-hosted — uses your local git credentials</div>
                </div>
              </button>
              <button
                onClick={() => setMode('backstage')}
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

          {/* Git form */}
          {mode === 'git' && !connectedUser && (
            <div className="flex flex-col gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Repository URL</label>
                <Input
                  placeholder="https://github.com/org/repo"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  onBlur={handleUrlBlur}
                  className="font-mono"
                />
                <p className="mt-1 text-[11px] text-th-text-faint">
                  Uses your local git credentials — no token or OAuth app needed.
                </p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Name <span className="text-th-text-faint">(auto-filled)</span></label>
                <Input
                  placeholder="org/repo"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Default branch</label>
                <Input placeholder="main" value={branch} onChange={(e) => setBranch(e.target.value)} />
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

          {/* Backstage form */}
          {mode === 'backstage' && !connectedUser && (
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
                <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Token <span className="text-th-text-faint">(optional)</span></label>
                <Input type="password" placeholder="Service account token" value={bsToken} onChange={(e) => setBsToken(e.target.value)} />
              </div>

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
