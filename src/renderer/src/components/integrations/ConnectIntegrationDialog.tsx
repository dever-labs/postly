import { Check, Database, GitBranch, GitFork, Loader2, X } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import type { Integration } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useCollectionsStore } from '@/store/collections'
import { useIntegrationsStore } from '@/store/integrations'
import { cn } from '@/lib/utils'

type IntegrationType = 'github' | 'gitlab' | 'backstage'

interface Props {
  open: boolean
  onClose: () => void
  editIntegration?: Integration | null
}

interface FormState {
  type: IntegrationType
  name: string
  baseUrl: string
  clientId: string
  token: string
  repo: string
  branch: string
}

const DEFAULTS: Record<IntegrationType, Partial<FormState>> = {
  github: { baseUrl: 'https://github.com', branch: 'main' },
  gitlab: { baseUrl: 'https://gitlab.com', branch: 'main' },
  backstage: { baseUrl: 'http://localhost:7007', branch: 'main' },
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

const TYPE_DESCRIPTIONS: Record<IntegrationType, string> = {
  github: 'GitHub.com or GitHub Enterprise — no password needed',
  gitlab: 'GitLab.com or self-hosted GitLab — no password needed',
  backstage: 'Backstage software catalog',
}

export function ConnectIntegrationDialog({ open, onClose, editIntegration }: Props) {
  const { load: loadIntegrations } = useIntegrationsStore()
  const { load: loadCollections } = useCollectionsStore()

  const [step, setStep] = useState<1 | 2 | 3>(editIntegration ? 2 : 1)
  const [form, setForm] = useState<FormState>({
    type: editIntegration?.type ?? 'github',
    name: editIntegration?.name ?? '',
    baseUrl: editIntegration?.baseUrl ?? DEFAULTS.github.baseUrl ?? '',
    clientId: editIntegration?.clientId ?? '',
    token: editIntegration?.token ?? '',
    repo: editIntegration?.repo ?? '',
    branch: editIntegration?.branch ?? 'main',
  })
  const [createdId, setCreatedId] = useState<string | null>(editIntegration?.id ?? null)
  const [error, setError] = useState<string | null>(null)
  const [connectedUser, setConnectedUser] = useState<Integration['connectedUser']>(editIntegration?.connectedUser ?? null)

  // Device flow state
  const [deviceCode, setDeviceCode] = useState<{ userCode: string; verificationUri: string } | null>(null)

  useEffect(() => {
    if (!open) {
      if (!editIntegration) {
        setStep(1)
        setForm({ type: 'github', name: '', baseUrl: DEFAULTS.github.baseUrl ?? '', clientId: '', token: '', repo: '', branch: 'main' })
        setCreatedId(null)
      }
      setError(null)
      setConnectedUser(null)
      setDeviceCode(null)
    }
  }, [open, editIntegration])

  if (!open) return null

  const handleTypeSelect = (type: IntegrationType) => {
    setForm({ ...form, type, baseUrl: DEFAULTS[type].baseUrl ?? '', name: form.name || TYPE_LABELS[type] })
    setStep(2)
  }

  const handleConnect = async () => {
    setError(null)
    if (!form.name.trim()) { setError('Name is required'); return }
    if (!form.baseUrl.trim()) { setError('Base URL is required'); return }
    if (form.type !== 'backstage' && !form.clientId.trim()) { setError('Client ID is required'); return }

    setStep(3)

    try {
      const api = window.api

      // Create or update the integration record first
      let integrationId = createdId
      if (!integrationId) {
        const { data, error: createError } = await api.integrations.create({
          type: form.type, name: form.name, baseUrl: form.baseUrl,
          clientId: form.clientId, repo: form.repo, branch: form.branch,
        })
        if (createError) { setError(createError); setStep(2); return }
        integrationId = (data as Record<string, unknown>).id as string
        setCreatedId(integrationId)
      } else {
        await api.integrations.update({ id: integrationId, name: form.name, base_url: form.baseUrl, client_id: form.clientId, repo: form.repo, branch: form.branch })
      }

      // Backstage — no OAuth, just save and mark connected
      if (form.type === 'backstage') {
        if (form.token) await api.integrations.update({ id: integrationId, token: form.token })
        const { error: connErr } = await api.integrations.connect({ id: integrationId })
        if (connErr) { setError(connErr); setStep(2); return }
        setConnectedUser({ name: 'Backstage', avatarUrl: '' })
        await loadIntegrations(); await loadCollections()
        return
      }

      // GitHub / GitLab — Device Flow
      const { data: codeData, error: codeErr } = await api.integrations.deviceInit({ id: integrationId })
      if (codeErr) { setError(codeErr); setStep(2); return }
      setDeviceCode({ userCode: codeData.userCode, verificationUri: codeData.verificationUri })

      // Poll until user approves (blocks until done or times out)
      const { data: _pollData, error: pollErr } = await api.integrations.devicePoll({ id: integrationId })
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs">
      <div className="relative w-full max-w-md rounded-xl border border-th-border bg-th-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-th-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-th-text-primary">
              {editIntegration ? `Edit ${editIntegration.name}` : 'Add Integration'}
            </h2>
            <p className="mt-0.5 text-xs text-th-text-subtle">
              {step === 1 ? 'Choose a service to connect'
                : step === 2 ? 'Configure connection details'
                : deviceCode ? 'Approve in your browser'
                : connectedUser ? 'Connected!'
                : 'Connecting…'}
            </p>
          </div>
          <button onClick={onClose} className="rounded-sm p-1.5 text-th-text-subtle hover:bg-th-surface-raised hover:text-th-text-secondary focus:outline-hidden">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5">
          {/* Step 1: Choose type */}
          {step === 1 && (
            <div className="flex flex-col gap-3">
              {(['github', 'gitlab', 'backstage'] as IntegrationType[]).map((type) => (
                <button
                  key={type}
                  onClick={() => handleTypeSelect(type)}
                  className="flex items-center gap-4 rounded-lg border border-th-border-strong bg-th-surface-raised/50 px-4 py-3 text-left transition-colors hover:border-th-text-muted hover:bg-th-surface-raised focus:outline-hidden"
                >
                  <span className="text-th-text-secondary">{TYPE_ICONS[type]}</span>
                  <div>
                    <div className="text-sm font-medium text-th-text-primary">{TYPE_LABELS[type]}</div>
                    <div className="text-xs text-th-text-subtle">{TYPE_DESCRIPTIONS[type]}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Step 2: Configure */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 rounded-md bg-th-surface-raised/50 px-3 py-2">
                <span className="text-th-text-muted">{TYPE_ICONS[form.type]}</span>
                <span className="text-sm font-medium text-th-text-secondary">{TYPE_LABELS[form.type]}</span>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Name</label>
                <Input placeholder={`My ${TYPE_LABELS[form.type]}`} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Base URL</label>
                <Input placeholder={DEFAULTS[form.type].baseUrl} value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
              </div>

              {(form.type === 'github' || form.type === 'gitlab') && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-th-text-muted">
                    Client ID
                    <span className="ml-1.5 text-th-text-faint">
                      — register a {form.type === 'github' ? 'GitHub OAuth App' : 'GitLab Application'} to get this
                    </span>
                  </label>
                  <Input
                    placeholder={form.type === 'github' ? 'Ov23li...' : 'Application ID'}
                    value={form.clientId}
                    onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                  />
                  <p className="mt-1 text-[11px] text-th-text-faint">
                    No client secret needed — authentication uses the Device Flow standard.
                  </p>
                </div>
              )}

              {form.type === 'backstage' && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Token <span className="text-th-text-faint">(optional)</span></label>
                  <Input type="password" placeholder="Service account token" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} />
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-medium text-th-text-muted">
                  {form.type === 'backstage' ? 'Default Path' : 'Repository (owner/repo)'}
                </label>
                <Input placeholder={form.type === 'backstage' ? '/api/catalog' : 'owner/repo'} value={form.repo} onChange={(e) => setForm({ ...form, repo: e.target.value })} />
              </div>

              {form.type !== 'backstage' && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Branch</label>
                  <Input placeholder="main" value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} />
                </div>
              )}

              {error && <p className="rounded-sm bg-rose-900/30 px-3 py-2 text-xs text-rose-400">{error}</p>}

              <div className="flex justify-between gap-2 pt-1">
                {!editIntegration && <Button variant="ghost" size="sm" onClick={() => setStep(1)}>Back</Button>}
                <Button size="sm" className={cn('ml-auto', editIntegration ? 'w-full' : '')} onClick={handleConnect}>
                  {form.type === 'backstage' ? 'Connect' : 'Continue'}
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Connecting / Device Code */}
          {step === 3 && (
            <div className="flex flex-col items-center gap-5 py-4">
              {!connectedUser && !error && (
                <>
                  {deviceCode ? (
                    <>
                      <div className="flex w-full flex-col items-center gap-3 rounded-lg border border-th-border-strong bg-th-surface-raised/50 px-5 py-5">
                        <p className="text-xs text-th-text-subtle">Enter this code at</p>
                        <a
                          href={deviceCode.verificationUri}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-blue-400 hover:underline"
                        >
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
                      <p className="text-sm text-th-text-secondary">Requesting device code…</p>
                    </>
                  )}
                </>
              )}

              {connectedUser && (
                <div className="flex w-full flex-col items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/20 text-green-400">
                    <Check className="h-5 w-5" />
                  </div>
                  <p className="text-sm font-medium text-th-text-primary">Connected!</p>
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
                  <Button size="sm" className="mt-2 w-full" onClick={onClose}>Done</Button>
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
