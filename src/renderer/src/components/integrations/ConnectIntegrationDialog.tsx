import { Check, Database, GitBranch, Loader2, X } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import type { Integration } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useCollectionsStore } from '@/store/collections'
import { useIntegrationsStore } from '@/store/integrations'

type Mode = 'git' | 'backstage'

interface Props {
  open: boolean
  onClose: () => void
  editIntegration?: Integration | null
}

function parseRepoName(raw: string): string {
  try { return raw.trim().replace(/\.git$/, '').split('/').slice(-2).join('/') } catch { return raw }
}

export function ConnectIntegrationDialog({ open, onClose, editIntegration }: Props) {
  const { load: loadIntegrations } = useIntegrationsStore()
  const { load: loadCollections } = useCollectionsStore()

  const isEdit = !!editIntegration
  const initialMode: Mode = editIntegration?.type === 'backstage' ? 'backstage' : 'git'

  const [mode, setMode] = useState<Mode | null>(isEdit ? initialMode : null)
  const [repoUrl, setRepoUrl] = useState(editIntegration?.repo ?? '')
  const [name, setName] = useState(editIntegration?.name ?? '')
  const [branch, setBranch] = useState(editIntegration?.branch ?? 'main')
  const [bsUrl, setBsUrl] = useState(editIntegration?.baseUrl ?? 'http://localhost:7007')
  const [bsName, setBsName] = useState(editIntegration?.name ?? 'Backstage')
  const [bsToken, setBsToken] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [connectedUser, setConnectedUser] = useState<Integration['connectedUser']>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      if (!isEdit) { setMode(null); setRepoUrl(''); setName(''); setBranch('main') }
      setConnectedUser(null); setError(null)
    }
  }, [open, isEdit])

  if (!open) return null

  const handleConnect = async () => {
    setError(null); setConnecting(true)
    try {
      const api = window.api
      let integrationId = editIntegration?.id ?? ''

      if (mode === 'git') {
        if (!repoUrl.trim()) { setError('Repository URL is required'); setConnecting(false); return }
        if (!integrationId) {
          const { data, error: e } = await api.integrations.create({ type: 'git', name: name.trim() || parseRepoName(repoUrl), baseUrl: '', repo: repoUrl.trim(), branch: branch || 'main' })
          if (e) { setError(e); setConnecting(false); return }
          integrationId = (data as Record<string, unknown>).id as string
        } else {
          await api.integrations.update({ id: integrationId, name: name.trim(), repo: repoUrl.trim(), branch })
        }
        const { data: connData, error: connErr } = await api.integrations.connect({ id: integrationId })
        if (connErr) { setError(connErr); setConnecting(false); return }
        const u = (connData as Record<string, unknown>)?.connected_user
        try { setConnectedUser(typeof u === 'string' ? JSON.parse(u) : null) } catch { /* empty */ }
      } else {
        if (!integrationId) {
          const { data, error: e } = await api.integrations.create({ type: 'backstage', name: bsName.trim() || 'Backstage', baseUrl: bsUrl.trim(), repo: '', branch: 'main' })
          if (e) { setError(e); setConnecting(false); return }
          integrationId = (data as Record<string, unknown>).id as string
        } else {
          await api.integrations.update({ id: integrationId, name: bsName.trim(), base_url: bsUrl.trim() })
        }
        if (bsToken) await api.integrations.update({ id: integrationId, token: bsToken })
        const { error: connErr } = await api.integrations.connect({ id: integrationId })
        if (connErr) { setError(connErr); setConnecting(false); return }
        setConnectedUser({ name: 'Backstage', avatarUrl: '' })
      }

      await loadIntegrations(); await loadCollections()
    } catch (e) { setError(String(e)) }
    setConnecting(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs">
      <div className="relative w-full max-w-md rounded-xl border border-th-border bg-th-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-th-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-th-text-primary">{isEdit ? `Edit ${editIntegration.name}` : 'Add Git Source'}</h2>
            <p className="mt-0.5 text-xs text-th-text-subtle">
              {connectedUser ? 'Connected!' : !mode ? 'Choose a source type' : mode === 'git' ? 'Paste a repository URL' : 'Configure Backstage'}
            </p>
          </div>
          <button onClick={onClose} className="rounded-sm p-1.5 text-th-text-subtle hover:bg-th-surface-raised hover:text-th-text-secondary focus:outline-hidden">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5">
          {connectedUser && (
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/20 text-green-400"><Check className="h-5 w-5" /></div>
              <p className="text-sm font-medium text-th-text-primary">Connected!</p>
              <Button size="sm" className="mt-2 w-full" onClick={onClose}>Done</Button>
            </div>
          )}

          {!mode && !connectedUser && (
            <div className="flex flex-col gap-3">
              {([['git', <GitBranch className="h-6 w-6" />, 'Git repository', 'GitHub, GitLab, any host — uses your local git credentials'], ['backstage', <Database className="h-6 w-6" />, 'Backstage', 'Backstage software catalog']] as const).map(([t, icon, label, desc]) => (
                <button key={t} onClick={() => setMode(t as Mode)} className="flex items-center gap-4 rounded-lg border border-th-border-strong bg-th-surface-raised/50 px-4 py-3 text-left transition-colors hover:border-th-text-muted hover:bg-th-surface-raised focus:outline-hidden">
                  <span className="text-th-text-secondary">{icon}</span>
                  <div><div className="text-sm font-medium text-th-text-primary">{label}</div><div className="text-xs text-th-text-subtle">{desc}</div></div>
                </button>
              ))}
            </div>
          )}

          {mode === 'git' && !connectedUser && (
            <div className="flex flex-col gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Repository URL</label>
                <Input placeholder="https://github.com/org/repo" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} onBlur={() => { if (repoUrl && !name) setName(parseRepoName(repoUrl)) }} className="font-mono" />
                <p className="mt-1 text-[11px] text-th-text-faint">Uses your local git credentials — no token needed.</p>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Name <span className="text-th-text-faint">(auto-filled)</span></label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="org/repo" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Default branch</label>
                <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
              </div>
              {error && <p className="rounded-sm bg-rose-900/30 px-3 py-2 text-xs text-rose-400">{error}</p>}
              <div className="flex gap-2 pt-1">
                {!isEdit && <Button variant="ghost" size="sm" onClick={() => setMode(null)}>Back</Button>}
                <Button size="sm" className="ml-auto" onClick={handleConnect} disabled={connecting || !repoUrl.trim()}>
                  {connecting ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Connecting…</> : 'Connect'}
                </Button>
              </div>
            </div>
          )}

          {mode === 'backstage' && !connectedUser && (
            <div className="flex flex-col gap-4">
              <div><label className="mb-1.5 block text-xs font-medium text-th-text-muted">Base URL</label><Input value={bsUrl} onChange={(e) => setBsUrl(e.target.value)} /></div>
              <div><label className="mb-1.5 block text-xs font-medium text-th-text-muted">Name</label><Input value={bsName} onChange={(e) => setBsName(e.target.value)} /></div>
              <div><label className="mb-1.5 block text-xs font-medium text-th-text-muted">Token <span className="text-th-text-faint">(optional)</span></label><Input type="password" value={bsToken} onChange={(e) => setBsToken(e.target.value)} /></div>
              {error && <p className="rounded-sm bg-rose-900/30 px-3 py-2 text-xs text-rose-400">{error}</p>}
              <div className="flex gap-2 pt-1">
                {!isEdit && <Button variant="ghost" size="sm" onClick={() => setMode(null)}>Back</Button>}
                <Button size="sm" className="ml-auto" onClick={handleConnect} disabled={connecting}>
                  {connecting ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Connecting…</> : 'Connect'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
