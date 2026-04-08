import { Check, Database, GitBranch, GitFork, Globe, KeyRound, Loader2, UserRound } from 'lucide-react'
import React, { useState } from 'react'
import type { Integration } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useCollectionsStore } from '@/store/collections'
import { useIntegrationsStore } from '@/store/integrations'
import { useUIStore } from '@/store/ui'

type BsProvider = 'guest' | 'token' | 'gitlab' | 'github' | 'google'

const BS_PROVIDERS: { value: BsProvider; icon: React.ReactNode; label: string }[] = [
  { value: 'guest',  icon: <UserRound className="h-4 w-4" />,  label: 'Guest'  },
  { value: 'token',  icon: <KeyRound className="h-4 w-4" />,   label: 'Token'  },
  { value: 'gitlab', icon: <GitBranch className="h-4 w-4" />,  label: 'GitLab' },
  { value: 'github', icon: <GitFork className="h-4 w-4" />,     label: 'GitHub' },
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

type IntegrationType = 'github' | 'gitlab' | 'backstage' | 'git'

const TYPE_ICONS: Record<IntegrationType, React.ReactNode> = {
  github: <GitFork className="h-6 w-6" />,
  gitlab: <GitBranch className="h-6 w-6" />,
  backstage: <Database className="h-6 w-6" />,
  git: <GitBranch className="h-6 w-6" />,
}

const TYPE_LABELS: Record<IntegrationType, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  backstage: 'Backstage',
  git: 'Git repository',
}

const DEFAULTS: Record<string, { baseUrl: string }> = {
  github: { baseUrl: 'https://github.com' },
  gitlab: { baseUrl: 'https://gitlab.com' },
  backstage: { baseUrl: 'http://localhost:7007' },
  git: { baseUrl: '' },
}

export function IntegrationEditPage({ integrationId }: { integrationId: string }) {
  const { load: loadIntegrations, remove } = useIntegrationsStore()
  const { load: loadCollections } = useCollectionsStore()
  const { clearSelectedItem, addToast } = useUIStore()
  const integration = useIntegrationsStore((s) => s.integrations.find((i) => i.id === integrationId))

  const [name, setName] = useState(integration?.name ?? '')
  const [repoUrl, setRepoUrl] = useState(integration?.repo ?? '')
  const [branch, setBranch] = useState(integration?.branch ?? 'main')
  const [baseUrl, setBaseUrl] = useState(integration?.baseUrl ?? DEFAULTS[integration?.type ?? 'git']?.baseUrl ?? '')
  const [clientId, setClientId] = useState(integration?.clientId ?? '')
  const [token, setToken] = useState(integration?.token ?? '')

  const [reconnecting, setReconnecting] = useState(false)
  const [connectedUser, setConnectedUser] = useState<Integration['connectedUser']>(integration?.connectedUser ?? null)
  const [deviceCode, setDeviceCode] = useState<{ userCode: string; verificationUri: string } | null>(null)
  const [step, setStep] = useState<'form' | 'oauth'>(integration?.type === 'git' || integration?.type === 'backstage' ? 'form' : 'form')
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (!integration) return null

  const type = integration.type as IntegrationType
  const isGit = type === 'git'

  const handleSave = async () => {
    setError(null)
    if (!name.trim()) { setError('Name is required'); return }

    await window.api.integrations.update({
      id: integrationId,
      name: name.trim(),
      repo: isGit ? repoUrl.trim() : repoUrl.trim(),
      branch: branch.trim() || 'main',
      base_url: baseUrl,
      client_id: clientId,
    })
    if (token && (type === 'backstage')) {
      await window.api.integrations.update({ id: integrationId, token })
    }
    await loadIntegrations()
    addToast('Saved', 'success')
    clearSelectedItem()
  }

  const handleReconnect = async () => {
    setError(null)
    setReconnecting(true)

    try {
      await window.api.integrations.update({
        id: integrationId,
        name: name.trim(),
        repo: repoUrl.trim(),
        branch: branch.trim() || 'main',
        base_url: baseUrl,
        client_id: clientId,
      })

      if (type === 'git') {
        const { data, error: connErr } = await window.api.integrations.connect({ id: integrationId })
        if (connErr) { setError(connErr); setReconnecting(false); return }
        const u = (data as Record<string, unknown>)?.connected_user
        try { setConnectedUser(typeof u === 'string' ? JSON.parse(u) : null) } catch { /* empty */ }
        await loadIntegrations(); await loadCollections()
      } else if (type === 'backstage') {
        if (token) await window.api.integrations.update({ id: integrationId, token })
        const { data, error: connErr, syncError, syncResult } = await window.api.integrations.connect({ id: integrationId }) as {
          data: unknown; error?: string; syncError?: string
          syncResult?: { entitiesFound: number; synced: number; skipped: number; errors: string[] }
        }
        if (connErr) { setError(connErr); setReconnecting(false); return }
        const u = (data as Record<string, unknown>)?.connected_user
        try { setConnectedUser(typeof u === 'string' ? JSON.parse(u) : null) } catch { /* empty */ }
        if (syncError) {
          setError(`Catalog sync failed: ${syncError}`)
        } else if (syncResult) {
          if (syncResult.synced === 0) {
            const detail = syncResult.errors.length ? syncResult.errors.join('; ') : `${syncResult.skipped} entities skipped`
            setError(`Connected but no APIs imported. ${detail}`)
          } else if (syncResult.errors.length) {
            console.warn('Backstage sync partial errors:', syncResult.errors)
          }
        }
        await loadIntegrations(); await loadCollections()
      } else {
        // github / gitlab — device flow
        setStep('oauth')
        const { data: codeData, error: codeErr } = await window.api.integrations.deviceInit({ id: integrationId })
        if (codeErr) { setError(codeErr); setStep('form'); setReconnecting(false); return }
        setDeviceCode({ userCode: codeData.userCode, verificationUri: codeData.verificationUri })

        const { error: pollErr } = await window.api.integrations.devicePoll({ id: integrationId })
        if (pollErr) { setError(pollErr); setStep('form'); setDeviceCode(null); setReconnecting(false); return }

        await loadIntegrations()
        const updated = useIntegrationsStore.getState().integrations.find((i) => i.id === integrationId)
        setConnectedUser(updated?.connectedUser ?? null)
        setDeviceCode(null)
        await loadCollections()
      }
    } catch (e) {
      setError(String(e)); setStep('form'); setDeviceCode(null)
    }
    setReconnecting(false)
  }

  const handleDelete = async () => {
    setDeleting(true)
    await remove(integrationId)
    await loadCollections()
    addToast(`Removed ${integration.name}`, 'success')
    clearSelectedItem()
  }

  const stepLabel = step === 'oauth'
    ? deviceCode ? 'Approve in your browser' : connectedUser ? 'Reconnected!' : 'Reconnecting…'
    : 'Edit Git Source'

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-th-bg">
      <div className="drag-region flex items-center justify-between border-b border-th-border px-6 pt-8 pb-4">
        <div className="no-drag">
          <h1 className="text-sm font-semibold text-th-text-primary">Edit Git Source</h1>
          <p className="text-xs text-th-text-subtle">{stepLabel}</p>
        </div>
      </div>

      <div className="flex flex-1 items-start justify-center px-6 py-12">
        <div className="w-full max-w-md">

          {/* Form */}
          {step === 'form' && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 rounded-md bg-th-surface-raised/50 px-3 py-2">
                <span className="text-th-text-muted">{TYPE_ICONS[type]}</span>
                <span className="text-sm font-medium text-th-text-secondary">{TYPE_LABELS[type]}</span>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>

              {isGit && (
                <>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Repository URL</label>
                    <Input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} className="font-mono" placeholder="https://github.com/org/repo" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Default branch</label>
                    <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
                  </div>
                </>
              )}

              {type === 'backstage' && (
                <>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Base URL</label>
                    <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Authentication</label>
                    <BsProviderPicker
                      value={(clientId as BsProvider) || 'guest'}
                      onChange={(v) => setClientId(v)}
                    />
                  </div>
                  {(clientId === 'token' || (!clientId)) && (
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Token <span className="text-th-text-faint">(optional)</span></label>
                      <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} />
                    </div>
                  )}
                  {connectedUser && (
                    <p className="text-xs text-th-text-subtle">Connected as <span className="text-th-text-secondary">{connectedUser.name}</span></p>
                  )}
                </>
              )}

              {(type === 'github' || type === 'gitlab') && (
                <>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Base URL</label>
                    <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Client ID</label>
                    <Input value={clientId} onChange={(e) => setClientId(e.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Repository</label>
                    <Input value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="owner/repo" />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Branch</label>
                    <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
                  </div>
                </>
              )}

              {error && <p className="rounded-sm bg-rose-900/30 px-3 py-2 text-xs text-rose-400">{error}</p>}

              <div className="flex gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={clearSelectedItem}>Cancel</Button>
                <Button variant="outline" size="sm" className="ml-auto" onClick={handleSave}>Save</Button>
                <Button size="sm" onClick={handleReconnect} disabled={reconnecting}>
                  {reconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  {isGit || type === 'backstage' ? 'Save & Reconnect' : 'Save & Reconnect'}
                </Button>
              </div>

              {/* Delete */}
              <div className="mt-6 border-t border-th-border pt-6">
                {!confirmDelete ? (
                  <button onClick={() => setConfirmDelete(true)} className="text-xs text-th-text-subtle hover:text-rose-400 transition-colors focus:outline-hidden">
                    Remove this integration…
                  </button>
                ) : (
                  <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-4 flex flex-col gap-3">
                    <p className="text-sm font-medium text-th-text-primary">Remove {integration.name}?</p>
                    <p className="text-xs text-th-text-subtle">This will remove all collections synced from it.</p>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</Button>
                      <Button size="sm" className="ml-auto bg-rose-600 hover:bg-rose-500 text-white border-transparent" onClick={handleDelete} disabled={deleting}>
                        {deleting ? 'Removing…' : 'Yes, remove'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* OAuth device flow for legacy github/gitlab */}
          {step === 'oauth' && (
            <div className="flex flex-col items-center gap-5 py-4">
              {!connectedUser && !error && (
                <>
                  {deviceCode ? (
                    <div className="flex w-full flex-col items-center gap-3 rounded-lg border border-th-border-strong bg-th-surface-raised/50 px-5 py-5">
                      <p className="text-xs text-th-text-subtle">Enter this code at</p>
                      <a href={deviceCode.verificationUri} target="_blank" rel="noreferrer" className="text-sm text-blue-400 hover:underline">{deviceCode.verificationUri}</a>
                      <div className="mt-1 rounded-md border border-th-border-strong bg-th-surface px-6 py-3">
                        <span className="font-mono text-2xl font-bold tracking-[0.25em] text-th-text-primary">{deviceCode.userCode}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-th-text-muted"><Loader2 className="h-4 w-4 animate-spin" />Waiting for you to approve…</div>
                    </div>
                  ) : (
                    <><Loader2 className="h-8 w-8 animate-spin text-blue-400" /><p className="text-sm text-th-text-secondary">Reconnecting…</p></>
                  )}
                </>
              )}
              {connectedUser && (
                <div className="flex flex-col items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/20 text-green-400"><Check className="h-5 w-5" /></div>
                  <p className="text-sm font-medium text-th-text-primary">Reconnected!</p>
                  <Button size="sm" className="mt-2 w-full" onClick={clearSelectedItem}>Done</Button>
                </div>
              )}
              {error && (
                <div className="flex w-full flex-col gap-3">
                  <p className="rounded-sm bg-rose-900/30 px-3 py-2 text-xs text-rose-400">{error}</p>
                  <Button variant="outline" size="sm" onClick={() => { setError(null); setStep('form') }}>Back</Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
