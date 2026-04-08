import React, { useEffect, useState } from 'react'
import type { BackstageSettings } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useSettingsStore } from '@/store/settings'
import { useUIStore } from '@/store/ui'

const DEFAULTS: BackstageSettings = { baseUrl: '', token: '', autoSync: false, authProvider: 'token' }

const PROVIDER_LABELS: Record<string, string> = {
  token: 'Static token',
  guest: 'Guest (local dev)',
  gitlab: 'GitLab',
  github: 'GitHub',
  google: 'Google',
}

export function BackstageSettings() {
  const addToast = useUIStore((s) => s.addToast)
  const loadSettings = useSettingsStore((s) => s.load)
  const [settings, setSettings] = useState<BackstageSettings>(DEFAULTS)
  const [syncing, setSyncing] = useState(false)
  const [signingIn, setSigningIn] = useState(false)

  useEffect(() => {
    ;window.api.settings.get({ key: 'backstage' }).then(({ data }: { data: BackstageSettings }) => {
      if (data) setSettings({ ...DEFAULTS, ...data })
    })
  }, [])

  const save = async () => {
    const { error } = await window.api.settings.set({ key: 'backstage', value: settings })
    if (error) {
      addToast('Failed to save Backstage settings', 'error')
    } else {
      addToast('Backstage settings saved', 'success')
      loadSettings()
    }
  }

  const signIn = async () => {
    if (!settings.baseUrl) { addToast('Enter a Base URL first', 'error'); return }
    const provider = settings.authProvider ?? 'gitlab'
    setSigningIn(true)
    const { data, error } = await window.api.backstage.auth({ baseUrl: settings.baseUrl, provider })
    setSigningIn(false)
    if (error) {
      addToast(`Sign-in failed: ${error}`, 'error')
    } else {
      const updated = { ...settings, connectedUser: data.user, token: '' }
      setSettings(updated)
      addToast(`Signed in as ${data.user.name}`, 'success')
      loadSettings()
    }
  }

  const disconnect = async () => {
    const { error } = await window.api.backstage.disconnect()
    if (error) {
      addToast(`Disconnect failed: ${error}`, 'error')
    } else {
      setSettings((s) => ({ ...s, token: '', connectedUser: undefined }))
      addToast('Disconnected from Backstage', 'success')
      loadSettings()
    }
  }

  const syncNow = async () => {
    setSyncing(true)
    const { data, error } = await window.api.backstage.sync()
    setSyncing(false)
    if (error) {
      addToast(`Sync failed: ${error}`, 'error')
    } else {
      const { synced, skipped, entitiesFound, errors } = data as { synced: number; skipped: number; entitiesFound: number; errors: string[] }
      const msg = entitiesFound === 0
        ? 'No API entities found in the Backstage catalog'
        : skipped > 0
          ? `Synced ${synced} collection${synced !== 1 ? 's' : ''}, skipped ${skipped} (no parseable spec)`
          : `Synced ${synced} collection${synced !== 1 ? 's' : ''}`
      addToast(msg, skipped > 0 && synced === 0 ? 'error' : 'success')
      if (errors.length > 0) {
        errors.forEach((e) => addToast(e, 'error'))
      }
    }
  }

  const useOAuth = settings.authProvider !== 'token'
  const isConnected = !!settings.connectedUser

  return (
    <div className="flex flex-col gap-5">
      <h3 className="text-sm font-semibold text-th-text-primary">Backstage</h3>

      <div className="flex flex-col gap-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Base URL</label>
          <Input
            placeholder="https://backstage.example.com"
            value={settings.baseUrl}
            onChange={(e) => setSettings({ ...settings, baseUrl: e.target.value })}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Authentication</label>
          <select
            className="w-full rounded-sm border border-th-border bg-th-bg-secondary px-2 py-1.5 text-sm text-th-text-primary focus:outline-hidden focus:ring-1 focus:ring-blue-500"
            value={settings.authProvider ?? 'token'}
            onChange={(e) => setSettings({ ...settings, authProvider: e.target.value as BackstageSettings['authProvider'], connectedUser: undefined, token: '' })}
          >
            {Object.entries(PROVIDER_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>

        {!useOAuth && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Token</label>
            <Input
              type="password"
              placeholder="Token..."
              value={settings.token}
              onChange={(e) => setSettings({ ...settings, token: e.target.value })}
            />
          </div>
        )}

        {useOAuth && (
          <div className="flex items-center gap-3">
            {isConnected ? (
              <>
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {settings.connectedUser?.picture && (
                    <img src={settings.connectedUser.picture} alt="" className="h-6 w-6 rounded-full" />
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm text-th-text-primary">{settings.connectedUser?.name}</p>
                    {settings.connectedUser?.email && (
                      <p className="truncate text-xs text-th-text-muted">{settings.connectedUser.email}</p>
                    )}
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={disconnect}>Disconnect</Button>
              </>
            ) : (
              <Button size="sm" onClick={signIn} disabled={signingIn}>
                {signingIn
                  ? (settings.authProvider === 'guest' ? 'Connecting…' : 'Signing in…')
                  : (settings.authProvider === 'guest' ? 'Connect as Guest' : `Sign in via ${PROVIDER_LABELS[settings.authProvider ?? 'gitlab']}`)}
              </Button>
            )}
          </div>
        )}

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.autoSync}
            onChange={(e) => setSettings({ ...settings, autoSync: e.target.checked })}
            className="h-4 w-4 accent-blue-500"
          />
          <span className="text-sm text-th-text-secondary">Auto-sync on startup</span>
        </label>
      </div>

      <div className="flex gap-2">
        <Button size="sm" onClick={save}>Save</Button>
        <Button variant="outline" size="sm" onClick={syncNow} disabled={syncing}>
          {syncing ? 'Syncing...' : 'Sync Now'}
        </Button>
      </div>
    </div>
  )
}
