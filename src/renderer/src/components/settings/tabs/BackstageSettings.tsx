import React, { useEffect, useState } from 'react'
import type { BackstageSettings } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useSettingsStore } from '@/store/settings'
import { useUIStore } from '@/store/ui'

const DEFAULTS: BackstageSettings = { baseUrl: '', token: '', autoSync: false }

export function BackstageSettings() {
  const addToast = useUIStore((s) => s.addToast)
  const loadSettings = useSettingsStore((s) => s.load)
  const [settings, setSettings] = useState<BackstageSettings>(DEFAULTS)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    ;(window as any).api.settings.get({ key: 'backstage' }).then(({ data }: { data: BackstageSettings }) => {
      if (data) setSettings({ ...DEFAULTS, ...data })
    })
  }, [])

  const save = async () => {
    const { error } = await (window as any).api.settings.set({ key: 'backstage', value: settings })
    if (error) {
      addToast('Failed to save Backstage settings', 'error')
    } else {
      addToast('Backstage settings saved', 'success')
      loadSettings()
    }
  }

  const syncNow = async () => {
    setSyncing(true)
    const { error } = await (window as any).api.backstage.sync()
    setSyncing(false)
    if (error) addToast(`Sync failed: ${error}`, 'error')
    else addToast('Backstage sync complete', 'success')
  }

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
          <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Auth Token</label>
          <Input
            type="password"
            placeholder="Token..."
            value={settings.token}
            onChange={(e) => setSettings({ ...settings, token: e.target.value })}
          />
        </div>

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
