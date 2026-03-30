import { Check, Database, GitBranch, GitFork, Loader2 } from 'lucide-react'
import React, { useState } from 'react'
import type { Integration } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useCollectionsStore } from '@/store/collections'
import { useIntegrationsStore } from '@/store/integrations'
import { useUIStore } from '@/store/ui'

type IntegrationType = 'github' | 'gitlab' | 'backstage'

interface FormState {
  name: string
  baseUrl: string
  clientId: string
  token: string
  repo: string
  branch: string
}

const TYPE_ICONS: Record<IntegrationType, React.ReactNode> = {
  github: <GitFork className="h-6 w-6" />,
  gitlab: <GitBranch className="h-6 w-6" />,
  backstage: <Database className="h-6 w-6" />,
}

const TYPE_LABELS: Record<IntegrationType, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  backstage: 'Backstage',
}

const DEFAULTS: Record<IntegrationType, Partial<FormState>> = {
  github: { baseUrl: 'https://github.com', branch: 'main' },
  gitlab: { baseUrl: 'https://gitlab.com', branch: 'main' },
  backstage: { baseUrl: 'http://localhost:7007', branch: 'main' },
}

export function IntegrationEditPage({ integrationId }: { integrationId: string }) {
  const { load: loadIntegrations, remove } = useIntegrationsStore()
  const { load: loadCollections } = useCollectionsStore()
  const { clearSelectedItem, addToast } = useUIStore()
  const integration = useIntegrationsStore((s) => s.integrations.find((i) => i.id === integrationId))

  const [step, setStep] = useState<2 | 3>(2)
  const [form, setForm] = useState<FormState>({
    name: integration?.name ?? '',
    baseUrl: integration?.baseUrl ?? DEFAULTS[integration?.type ?? 'github'].baseUrl ?? '',
    clientId: integration?.clientId ?? '',
    token: integration?.token ?? '',
    repo: integration?.repo ?? '',
    branch: integration?.branch ?? 'main',
  })
  const [error, setError] = useState<string | null>(null)
  const [connectedUser, setConnectedUser] = useState<Integration['connectedUser']>(integration?.connectedUser ?? null)
  const [deviceCode, setDeviceCode] = useState<{ userCode: string; verificationUri: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (!integration) return null

  const type = integration.type as IntegrationType

  const handleSaveAndReconnect = async () => {
    setError(null)
    if (!form.name.trim()) { setError('Name is required'); return }
    if (!form.baseUrl.trim()) { setError('Base URL is required'); return }
    if (type !== 'backstage' && !form.clientId.trim()) { setError('Client ID is required'); return }

    setStep(3)

    try {
      await window.api.integrations.update({
        id: integrationId,
        name: form.name,
        base_url: form.baseUrl,
        client_id: form.clientId,
        repo: form.repo,
        branch: form.branch,
      })

      if (type === 'backstage') {
        if (form.token) await window.api.integrations.update({ id: integrationId, token: form.token })
        const { error: connErr } = await window.api.integrations.connect({ id: integrationId })
        if (connErr) { setError(connErr); setStep(2); return }
        setConnectedUser({ name: 'Backstage', avatarUrl: '' })
        await loadIntegrations(); await loadCollections()
        return
      }

      const { data: codeData, error: codeErr } = await window.api.integrations.deviceInit({ id: integrationId })
      if (codeErr) { setError(codeErr); setStep(2); return }
      setDeviceCode({ userCode: codeData.userCode, verificationUri: codeData.verificationUri })

      const { error: pollErr } = await window.api.integrations.devicePoll({ id: integrationId })
      if (pollErr) { setError(pollErr); setStep(2); setDeviceCode(null); return }

      await loadIntegrations()
      const updated = useIntegrationsStore.getState().integrations.find((i) => i.id === integrationId)
      setConnectedUser(updated?.connectedUser ?? null)
      setDeviceCode(null)
      await loadCollections()
    } catch (e) {
      setError(String(e)); setStep(2); setDeviceCode(null)
    }
  }

  const handleSaveOnly = async () => {
    setError(null)
    if (!form.name.trim()) { setError('Name is required'); return }
    await window.api.integrations.update({
      id: integrationId,
      name: form.name,
      base_url: form.baseUrl,
      client_id: form.clientId,
      repo: form.repo,
      branch: form.branch,
    })
    if (form.token) await window.api.integrations.update({ id: integrationId, token: form.token })
    await loadIntegrations()
    addToast('Integration updated', 'success')
    clearSelectedItem()
  }

  const handleDelete = async () => {
    setDeleting(true)
    await remove(integrationId)
    await loadCollections()
    addToast(`Removed ${integration.name}`, 'success')
    clearSelectedItem()
  }

  const stepLabel =
    step === 2 ? 'Edit connection details'
    : deviceCode ? 'Approve in your browser'
    : connectedUser ? 'Reconnected!'
    : 'Reconnecting…'

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto bg-th-bg">
      <div className="drag-region flex items-center justify-between border-b border-th-border px-6 pt-8 pb-4">
        <div className="no-drag">
          <h1 className="text-sm font-semibold text-th-text-primary">Edit Integration</h1>
          <p className="text-xs text-th-text-subtle">{stepLabel}</p>
        </div>
      </div>

      <div className="flex flex-1 items-start justify-center px-6 py-12">
        <div className="w-full max-w-md">

          {step === 2 && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 rounded-md bg-th-surface-raised/50 px-3 py-2">
                <span className="text-th-text-muted">{TYPE_ICONS[type]}</span>
                <span className="text-sm font-medium text-th-text-secondary">{TYPE_LABELS[type]}</span>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Name</label>
                <Input placeholder={`My ${TYPE_LABELS[type]}`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Base URL</label>
                <Input placeholder={DEFAULTS[type].baseUrl} value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
              </div>

              {(type === 'github' || type === 'gitlab') && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-th-text-muted">
                    Client ID
                    <span className="ml-1.5 text-th-text-faint">
                      — register a {type === 'github' ? 'GitHub OAuth App' : 'GitLab Application'} to get this
                    </span>
                  </label>
                  <Input
                    placeholder={type === 'github' ? 'Ov23li...' : 'Application ID'}
                    value={form.clientId}
                    onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                  />
                  <p className="mt-1 text-[11px] text-th-text-faint">
                    No client secret needed — authentication uses the Device Flow standard.
                  </p>
                </div>
              )}

              {type === 'backstage' && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Token <span className="text-th-text-faint">(optional)</span></label>
                  <Input type="password" placeholder="Service account token" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} />
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-medium text-th-text-muted">
                  {type === 'backstage' ? 'Default Path' : 'Repository (owner/repo)'}
                </label>
                <Input placeholder={type === 'backstage' ? '/api/catalog' : 'owner/repo'} value={form.repo} onChange={(e) => setForm({ ...form, repo: e.target.value })} />
              </div>

              {type !== 'backstage' && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Branch</label>
                  <Input placeholder="main" value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} />
                </div>
              )}

              {error && <p className="rounded-sm bg-rose-900/30 px-3 py-2 text-xs text-rose-400">{error}</p>}

              <div className="flex gap-2 pt-1">
                <Button variant="ghost" size="sm" onClick={clearSelectedItem}>Cancel</Button>
                <Button variant="outline" size="sm" className="ml-auto" onClick={handleSaveOnly}>Save</Button>
                <Button size="sm" onClick={handleSaveAndReconnect}>
                  {type === 'backstage' ? 'Save & Connect' : 'Save & Reconnect'}
                </Button>
              </div>

              <div className="mt-6 border-t border-th-border pt-6">
                {!confirmDelete ? (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="text-xs text-th-text-subtle hover:text-rose-400 transition-colors focus:outline-hidden"
                  >
                    Remove this integration…
                  </button>
                ) : (
                  <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-4 flex flex-col gap-3">
                    <div>
                      <p className="text-sm font-medium text-th-text-primary">Remove {integration.name}?</p>
                      <p className="mt-1 text-xs text-th-text-subtle">
                        This will disconnect the integration and remove all collections synced from it. This cannot be undone.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        className="ml-auto bg-rose-600 hover:bg-rose-500 text-white border-transparent"
                        onClick={handleDelete}
                        disabled={deleting}
                      >
                        {deleting ? 'Removing…' : 'Yes, remove'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="flex flex-col items-center gap-5 py-4">
              {!connectedUser && !error && (
                <>
                  {deviceCode ? (
                    <>
                      <div className="flex w-full flex-col items-center gap-3 rounded-lg border border-th-border-strong bg-th-surface-raised/50 px-5 py-5">
                        <p className="text-xs text-th-text-subtle">Enter this code at</p>
                        <a href={deviceCode.verificationUri} target="_blank" rel="noreferrer" className="text-sm text-blue-400 hover:underline">
                          {deviceCode.verificationUri}
                        </a>
                        <div className="mt-1 rounded-md border border-th-border-strong bg-th-surface px-6 py-3">
                          <span className="font-mono text-2xl font-bold tracking-[0.25em] text-th-text-primary">
                            {deviceCode.userCode}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-th-text-muted">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Waiting for you to approve…
                      </div>
                    </>
                  ) : (
                    <>
                      <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
                      <p className="text-sm text-th-text-secondary">Reconnecting…</p>
                    </>
                  )}
                </>
              )}

              {connectedUser && (
                <div className="flex w-full flex-col items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/20 text-green-400">
                    <Check className="h-5 w-5" />
                  </div>
                  <p className="text-sm font-medium text-th-text-primary">Reconnected!</p>
                  {connectedUser.avatarUrl && (
                    <div className="flex items-center gap-3 rounded-md border border-th-border-strong bg-th-surface-raised/50 px-4 py-2.5">
                      <img src={connectedUser.avatarUrl} alt={connectedUser.name} className="h-8 w-8 rounded-full" />
                      <div>
                        <div className="text-sm font-medium text-th-text-primary">{connectedUser.name}</div>
                        {connectedUser.login && <div className="text-xs text-th-text-muted">@{connectedUser.login}</div>}
                        {connectedUser.username && <div className="text-xs text-th-text-muted">@{connectedUser.username}</div>}
                      </div>
                    </div>
                  )}
                  <Button size="sm" className="mt-2 w-full" onClick={clearSelectedItem}>Done</Button>
                </div>
              )}

              {error && (
                <div className="flex w-full flex-col gap-3">
                  <p className="rounded-sm bg-rose-900/30 px-3 py-2 text-xs text-rose-400">{error}</p>
                  <Button variant="outline" size="sm" onClick={() => { setError(null); setStep(2) }}>Back</Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
