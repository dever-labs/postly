import { Plus, X } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import type { GitHubSettings } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useSettingsStore } from '@/store/settings'
import { useUIStore } from '@/store/ui'

const DEFAULTS: GitHubSettings = { token: '', orgs: [] }

export function GitHubSettings() {
  const addToast = useUIStore((s) => s.addToast)
  const loadSettings = useSettingsStore((s) => s.load)
  const [settings, setSettings] = useState<GitHubSettings>(DEFAULTS)
  const [newOrg, setNewOrg] = useState('')
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    ;(window as any).api.settings.get({ key: 'github' }).then(({ data }: { data: GitHubSettings }) => {
      if (data) setSettings({ ...DEFAULTS, ...data, orgs: data.orgs ?? [] })
    })
  }, [])

  const save = async () => {
    const { error } = await (window as any).api.settings.set({ key: 'github', value: settings })
    if (error) {
      addToast('Failed to save GitHub settings', 'error')
    } else {
      addToast('GitHub settings saved', 'success')
      loadSettings()
    }
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
    const { error } = await (window as any).api.github.sync()
    setSyncing(false)
    if (error) addToast(`Sync failed: ${error}`, 'error')
    else addToast('GitHub sync complete', 'success')
  }

  return (
    <div className="flex flex-col gap-5">
      <h3 className="text-sm font-semibold text-neutral-200">GitHub</h3>

      <div className="flex flex-col gap-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-neutral-400">Personal Access Token</label>
          <Input
            type="password"
            placeholder="ghp_..."
            value={settings.token}
            onChange={(e) => setSettings({ ...settings, token: e.target.value })}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-neutral-400">Organizations</label>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {settings.orgs.map((org) => (
              <span
                key={org}
                className="flex items-center gap-1 rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300"
              >
                {org}
                <button onClick={() => removeOrg(org)} className="text-neutral-500 hover:text-neutral-300">
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
