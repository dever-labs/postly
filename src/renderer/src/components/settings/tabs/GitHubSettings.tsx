import { Plus, X } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import type { GitHubSettings } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useSettingsStore } from '@/store/settings'
import { useUIStore } from '@/store/ui'

const DEFAULTS: GitHubSettings = {
  baseUrl: 'https://github.com',
  clientId: '',
  clientSecret: '',
  token: '',
  repo: '',
  orgs: [],
}

export function GitHubSettings() {
  const addToast = useUIStore((s) => s.addToast)
  const loadSettings = useSettingsStore((s) => s.load)
  const [settings, setSettings] = useState<GitHubSettings>(DEFAULTS)
  const [newOrg, setNewOrg] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    ;window.api.settings.get({ key: 'github' }).then(({ data }: { data: GitHubSettings }) => {
      if (data) setSettings({ ...DEFAULTS, ...data, orgs: data.orgs ?? [] })
    })
  }, [])

  const isConnected = !!settings.connectedUser

  const connect = async () => {
    setConnecting(true)
    const { data, error } = await window.api.github.oauth({
      baseUrl: settings.baseUrl,
      clientId: settings.clientId,
      clientSecret: settings.clientSecret,
    })
    setConnecting(false)
    if (error) {
      addToast(`Connection failed: ${error}`, 'error')
    } else {
      addToast('Connected to GitHub!', 'success')
      setSettings((prev) => ({ ...prev, connectedUser: data.user }))
      loadSettings()
    }
  }

  const disconnect = async () => {
    const { error } = await window.api.github.disconnect()
    if (error) {
      addToast(`Failed to disconnect: ${error}`, 'error')
    } else {
      addToast('Disconnected from GitHub', 'success')
      setSettings((prev) => ({ ...prev, token: '', connectedUser: undefined }))
      loadSettings()
    }
  }

  const saveConfig = async () => {
    const { error } = await window.api.settings.set({ key: 'github', value: settings })
    if (error) addToast('Failed to save settings', 'error')
    else { addToast('GitHub settings saved', 'success'); loadSettings() }
  }

  const addOrg = () => {
    const org = newOrg.trim()
    if (!org || settings.orgs.includes(org)) return
    setSettings({ ...settings, orgs: [...settings.orgs, org] })
    setNewOrg('')
  }

  const removeOrg = (org: string) => {
    setSettings({ ...settings, orgs: settings.orgs.filter((o) => o !== org) })
  }

  const syncNow = async () => {
    setSyncing(true)
    const { error } = await window.api.github.sync()
    setSyncing(false)
    if (error) addToast(`Sync failed: ${error}`, 'error')
    else addToast('GitHub sync complete', 'success')
  }

  return (
    <div className="flex flex-col gap-5">
      <h3 className="text-sm font-semibold text-th-text-primary">GitHub Integration</h3>

      <div className="flex flex-col gap-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Base URL</label>
          <Input
            placeholder="https://github.com"
            value={settings.baseUrl}
            onChange={(e) => setSettings({ ...settings, baseUrl: e.target.value })}
            disabled={isConnected}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Client ID</label>
          <Input
            placeholder="Oauth App Client ID"
            value={settings.clientId}
            onChange={(e) => setSettings({ ...settings, clientId: e.target.value })}
            disabled={isConnected}
          />
          <p className="mt-1 text-xs text-th-text-subtle">
            <a
              href="https://github.com/settings/applications/new"
              target="_blank"
              rel="noreferrer"
              className="text-blue-400 hover:underline"
            >
              Register an OAuth App on GitHub
            </a>
            {' '}— set redirect URI to{' '}
            <span className="font-mono text-th-text-muted">http://localhost/callback</span>
          </p>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Client Secret</label>
          <Input
            type="password"
            placeholder="Client secret"
            value={settings.clientSecret}
            onChange={(e) => setSettings({ ...settings, clientSecret: e.target.value })}
            disabled={isConnected}
          />
        </div>

        {!isConnected ? (
          <Button size="sm" onClick={connect} disabled={connecting || !settings.clientId}>
            {connecting ? 'Connecting...' : 'Connect with GitHub'}
          </Button>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 rounded-md border border-th-border-strong bg-th-surface-raised/50 px-3 py-2">
              <img
                src={settings.connectedUser?.avatarUrl}
                alt={settings.connectedUser?.login}
                className="h-8 w-8 rounded-full"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-th-text-primary">{settings.connectedUser?.name}</div>
                <div className="text-xs text-th-text-muted">@{settings.connectedUser?.login}</div>
              </div>
              <span className="mr-2 text-xs text-green-400">✓ Connected</span>
              <Button variant="outline" size="sm" onClick={disconnect}>
                Disconnect
              </Button>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-th-text-muted">
                Repository (owner/repo)
              </label>
              <Input
                placeholder="owner/repo"
                value={settings.repo}
                onChange={(e) => setSettings({ ...settings, repo: e.target.value })}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Organizations</label>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {settings.orgs.map((org) => (
                  <span
                    key={org}
                    className="flex items-center gap-1 rounded-sm bg-th-surface-raised px-2 py-0.5 text-xs text-th-text-secondary"
                  >
                    {org}
                    <button onClick={() => removeOrg(org)} className="text-th-text-subtle hover:text-th-text-secondary">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Add organization..."
                  value={newOrg}
                  onChange={(e) => setNewOrg(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addOrg()}
                />
                <Button variant="outline" size="sm" onClick={addOrg}>
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div className="flex gap-2">
              <Button size="sm" onClick={saveConfig}>Save</Button>
              <Button variant="outline" size="sm" onClick={syncNow} disabled={syncing}>
                {syncing ? 'Syncing...' : 'Sync Now'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
