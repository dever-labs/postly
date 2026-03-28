import { Database, GitBranch, GitFork, Loader2, X } from 'lucide-react'
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
  clientSecret: string
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
  github: 'GitHub.com or GitHub Enterprise',
  gitlab: 'GitLab.com or self-hosted GitLab',
  backstage: 'Backstage software catalog',
}

export function ConnectIntegrationDialog({ open, onClose, editIntegration }: Props) {
  const { load: loadIntegrations, connect } = useIntegrationsStore()
  const { load: loadCollections } = useCollectionsStore()

  const [step, setStep] = useState<1 | 2 | 3>(editIntegration ? 2 : 1)
  const [form, setForm] = useState<FormState>({
    type: editIntegration?.type ?? 'github',
    name: editIntegration?.name ?? '',
    baseUrl: editIntegration?.baseUrl ?? DEFAULTS.github.baseUrl ?? '',
    clientId: editIntegration?.clientId ?? '',
    clientSecret: editIntegration?.clientSecret ?? '',
    token: editIntegration?.token ?? '',
    repo: editIntegration?.repo ?? '',
    branch: editIntegration?.branch ?? 'main',
  })
  const [createdId, setCreatedId] = useState<string | null>(editIntegration?.id ?? null)
  const [error, setError] = useState<string | null>(null)
  const [connectedUser, setConnectedUser] = useState<Integration['connectedUser']>(
    editIntegration?.connectedUser ?? null
  )

  useEffect(() => {
    if (!open) {
      if (!editIntegration) {
        setStep(1)
        setForm({ type: 'github', name: '', baseUrl: DEFAULTS.github.baseUrl ?? '', clientId: '', clientSecret: '', token: '', repo: '', branch: 'main' })
        setCreatedId(null)
      }
      setError(null)
      setConnectedUser(null)
    }
  }, [open, editIntegration])

  if (!open) return null

  const handleTypeSelect = (type: IntegrationType) => {
    const defaults = DEFAULTS[type]
    setForm({ ...form, type, baseUrl: defaults.baseUrl ?? '', name: form.name || TYPE_LABELS[type] })
    setStep(2)
  }

  const handleConfigureNext = async () => {
    setError(null)
    if (!form.name.trim()) { setError('Name is required'); return }
    if (!form.baseUrl.trim()) { setError('Base URL is required'); return }
    if ((form.type === 'github' || form.type === 'gitlab') && !form.clientId.trim()) {
      setError('Client ID is required'); return
    }

    setStep(3)

    try {
      let integrationId = createdId

      if (!integrationId) {
        const { data, error: createError } = await (window as any).api.integrations.create({
          type: form.type,
          name: form.name,
          baseUrl: form.baseUrl,
          clientId: form.clientId,
          clientSecret: form.clientSecret,
          repo: form.repo,
          branch: form.branch,
        })
        if (createError) { setError(createError); setStep(2); return }
        integrationId = (data as Record<string, unknown>).id as string
        setCreatedId(integrationId)
      } else {
        await (window as any).api.integrations.update({
          id: integrationId,
          name: form.name,
          base_url: form.baseUrl,
          client_id: form.clientId,
          client_secret: form.clientSecret,
          repo: form.repo,
          branch: form.branch,
          ...(form.type === 'backstage' ? { token: form.token } : {}),
        })
      }

      if (form.type === 'backstage') {
        if (form.token) {
          await (window as any).api.integrations.update({ id: integrationId, token: form.token })
        }
        const { error: connErr } = await connect(integrationId!)
        if (connErr) { setError(connErr); setStep(2); return }
        setConnectedUser({ name: 'Backstage', avatarUrl: '' })
      } else {
        const { error: connErr } = await connect(integrationId!)
        if (connErr) { setError(connErr); setStep(2); return }
        await loadIntegrations()
        const store = useIntegrationsStore.getState()
        const updated = store.integrations.find((i) => i.id === integrationId)
        setConnectedUser(updated?.connectedUser ?? null)
      }

      await loadIntegrations()
      await loadCollections()
    } catch (e) {
      setError(String(e))
      setStep(2)
    }
  }

  const handleSuccess = () => {
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-neutral-100">
              {editIntegration ? `Edit ${editIntegration.name}` : 'Connect Integration'}
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              {step === 1 ? 'Choose a service to connect' : step === 2 ? 'Configure connection details' : 'Connecting…'}
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300 focus:outline-none">
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
                  className="flex items-center gap-4 rounded-lg border border-neutral-700 bg-neutral-800/50 px-4 py-3 text-left transition-colors hover:border-neutral-500 hover:bg-neutral-800 focus:outline-none"
                >
                  <span className="text-neutral-300">{TYPE_ICONS[type]}</span>
                  <div>
                    <div className="text-sm font-medium text-neutral-200">{TYPE_LABELS[type]}</div>
                    <div className="text-xs text-neutral-500">{TYPE_DESCRIPTIONS[type]}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Step 2: Configure */}
          {step === 2 && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2 rounded-md bg-neutral-800/50 px-3 py-2">
                <span className="text-neutral-400">{TYPE_ICONS[form.type]}</span>
                <span className="text-sm font-medium text-neutral-300">{TYPE_LABELS[form.type]}</span>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-neutral-400">Name</label>
                <Input
                  placeholder={`My ${TYPE_LABELS[form.type]}`}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-neutral-400">Base URL</label>
                <Input
                  placeholder={DEFAULTS[form.type].baseUrl}
                  value={form.baseUrl}
                  onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                />
              </div>

              {form.type === 'github' && (
                <>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-neutral-400">Client ID</label>
                    <Input
                      placeholder="OAuth App Client ID"
                      value={form.clientId}
                      onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-neutral-400">Client Secret</label>
                    <Input
                      type="password"
                      placeholder="OAuth App Client Secret"
                      value={form.clientSecret}
                      onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}
                    />
                  </div>
                </>
              )}

              {form.type === 'gitlab' && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-neutral-400">Client ID (Application ID)</label>
                  <Input
                    placeholder="GitLab Application ID"
                    value={form.clientId}
                    onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                  />
                </div>
              )}

              {form.type === 'backstage' && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-neutral-400">Token (optional)</label>
                  <Input
                    type="password"
                    placeholder="Service account token"
                    value={form.token}
                    onChange={(e) => setForm({ ...form, token: e.target.value })}
                  />
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-medium text-neutral-400">
                  {form.type === 'backstage' ? 'Default Path' : 'Repository (owner/repo)'}
                </label>
                <Input
                  placeholder={form.type === 'backstage' ? '/api/catalog' : 'owner/repo'}
                  value={form.repo}
                  onChange={(e) => setForm({ ...form, repo: e.target.value })}
                />
              </div>

              {form.type !== 'backstage' && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-neutral-400">Branch</label>
                  <Input
                    placeholder="main"
                    value={form.branch}
                    onChange={(e) => setForm({ ...form, branch: e.target.value })}
                  />
                </div>
              )}

              {error && (
                <p className="rounded bg-rose-900/30 px-3 py-2 text-xs text-rose-400">{error}</p>
              )}

              <div className="flex justify-between gap-2 pt-1">
                {!editIntegration && (
                  <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                    ← Back
                  </Button>
                )}
                <Button
                  size="sm"
                  className={cn('ml-auto', editIntegration ? 'w-full' : '')}
                  onClick={handleConfigureNext}
                >
                  {form.type === 'backstage' ? 'Connect' : 'Connect with OAuth →'}
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Connecting */}
          {step === 3 && (
            <div className="flex flex-col items-center gap-4 py-6">
              {!connectedUser && !error && (
                <>
                  <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
                  <p className="text-sm text-neutral-300">
                    {form.type === 'backstage'
                      ? 'Connecting to Backstage…'
                      : 'Opening browser for authentication…'}
                  </p>
                  <p className="text-xs text-neutral-500">Complete the login in the browser window.</p>
                </>
              )}

              {connectedUser && (
                <div className="flex w-full flex-col items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-500/20 text-green-400">
                    ✓
                  </div>
                  <p className="text-sm font-medium text-neutral-200">Connected successfully!</p>
                  {connectedUser.avatarUrl && (
                    <div className="flex items-center gap-3 rounded-md border border-neutral-700 bg-neutral-800/50 px-4 py-2.5">
                      <img src={connectedUser.avatarUrl} alt={connectedUser.name} className="h-8 w-8 rounded-full" />
                      <div>
                        <div className="text-sm font-medium text-neutral-200">{connectedUser.name}</div>
                        {(connectedUser.login || connectedUser.username) && (
                          <div className="text-xs text-neutral-400">
                            @{connectedUser.login ?? connectedUser.username}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  <Button size="sm" className="mt-2 w-full" onClick={handleSuccess}>
                    Done
                  </Button>
                </div>
              )}

              {error && (
                <div className="flex w-full flex-col gap-3">
                  <p className="rounded bg-rose-900/30 px-3 py-2 text-xs text-rose-400">{error}</p>
                  <Button variant="outline" size="sm" onClick={() => { setError(null); setStep(2) }}>
                    ← Back
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
