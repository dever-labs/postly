import { Plus, X } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import type { GitLabSettings } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useSettingsStore } from '@/store/settings'
import { useUIStore } from '@/store/ui'

const DEFAULTS: GitLabSettings = {
  baseUrl: 'https://gitlab.com',
  clientId: '',
  token: '',
  repo: '',
  groups: [],
}

export function GitLabSettings() {
  const addToast = useUIStore((s) => s.addToast)
  const loadSettings = useSettingsStore((s) => s.load)
  const [settings, setSettings] = useState<GitLabSettings>(DEFAULTS)
  const [newGroup, setNewGroup] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    ;window.api.settings.get({ key: 'gitlab' }).then(({ data }: { data: GitLabSettings }) => {
      if (data) setSettings({ ...DEFAULTS, ...data, groups: data.groups ?? [] })
    })
  }, [])

  const isConnected = !!settings.connectedUser

  const connect = async () => {
    setConnecting(true)
    const { data, error } = await window.api.gitlab.oauth({
      baseUrl: settings.baseUrl,
      clientId: settings.clientId,
    })
    setConnecting(false)
    if (error) {
      addToast(`Connection failed: ${error}`, 'error')
    } else {
      addToast('Connected to GitLab!', 'success')
      setSettings((prev) => ({ ...prev, connectedUser: data.user }))
      loadSettings()
    }
  }

  const disconnect = async () => {
    const { error } = await window.api.gitlab.disconnect()
    if (error) {
      addToast(`Failed to disconnect: ${error}`, 'error')
    } else {
      addToast('Disconnected from GitLab', 'success')
      setSettings((prev) => ({ ...prev, token: '', connectedUser: undefined }))
      loadSettings()
    }
  }

  const saveConfig = async () => {
    const { error } = await window.api.settings.set({ key: 'gitlab', value: settings })
    if (error) addToast('Failed to save settings', 'error')
    else { addToast('GitLab settings saved', 'success'); loadSettings() }
  }

  const addGroup = () => {
    const g = newGroup.trim()
    if (!g || settings.groups.includes(g)) return
    setSettings({ ...settings, groups: [...settings.groups, g] })
    setNewGroup('')
  }

  const removeGroup = (g: string) => {
    setSettings({ ...settings, groups: settings.groups.filter((x) => x !== g) })
  }

  const syncNow = async () => {
    setSyncing(true)
    const { error } = await window.api.gitlab.sync()
    setSyncing(false)
    if (error) addToast(`Sync failed: ${error}`, 'error')
    else addToast('GitLab sync complete', 'success')
  }

  return (
    <div className="flex flex-col gap-5">
      <h3 className="text-sm font-semibold text-th-text-primary">GitLab Integration</h3>

      <div className="flex flex-col gap-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Base URL</label>
          <Input
            placeholder="https://gitlab.com"
            value={settings.baseUrl}
            onChange={(e) => setSettings({ ...settings, baseUrl: e.target.value })}
            disabled={isConnected}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Client ID (Application ID)</label>
          <Input
            placeholder="Application ID"
            value={settings.clientId}
            onChange={(e) => setSettings({ ...settings, clientId: e.target.value })}
            disabled={isConnected}
          />
          <p className="mt-1 text-xs text-th-text-subtle">
            Register at{' '}
            <a
              href={`${settings.baseUrl}/-/profile/applications`}
              target="_blank"
              rel="noreferrer"
              className="text-blue-400 hover:underline"
            >
              {settings.baseUrl}/-/profile/applications
            </a>
            {' '}— set redirect URI to{' '}
            <span className="font-mono text-th-text-muted">http://localhost/callback</span>
            {' '}and scope <span className="font-mono text-th-text-muted">api</span>
          </p>
        </div>

        {!isConnected ? (
          <Button size="sm" onClick={connect} disabled={connecting || !settings.clientId}>
            {connecting ? 'Connecting...' : 'Connect with GitLab'}
          </Button>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 rounded-md border border-th-border-strong bg-th-surface-raised/50 px-3 py-2">
              <img
                src={settings.connectedUser?.avatarUrl}
                alt={settings.connectedUser?.username}
                className="h-8 w-8 rounded-full"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-th-text-primary">{settings.connectedUser?.name}</div>
                <div className="text-xs text-th-text-muted">@{settings.connectedUser?.username}</div>
              </div>
              <span className="mr-2 text-xs text-green-400">✓ Connected</span>
              <Button variant="outline" size="sm" onClick={disconnect}>
                Disconnect
              </Button>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-th-text-muted">
                Project path (group/project)
              </label>
              <Input
                placeholder="group/project"
                value={settings.repo}
                onChange={(e) => setSettings({ ...settings, repo: e.target.value })}
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Groups</label>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {settings.groups.map((g) => (
                  <span
                    key={g}
                    className="flex items-center gap-1 rounded-sm bg-th-surface-raised px-2 py-0.5 text-xs text-th-text-secondary"
                  >
                    {g}
                    <button onClick={() => removeGroup(g)} className="text-th-text-subtle hover:text-th-text-secondary">
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Add group..."
                  value={newGroup}
                  onChange={(e) => setNewGroup(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addGroup()}
                />
                <Button variant="outline" size="sm" onClick={addGroup}>
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
