import { Plus, X } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import type { GitLabSettings } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useSettingsStore } from '@/store/settings'
import { useUIStore } from '@/store/ui'

const DEFAULTS: GitLabSettings = { baseUrl: 'https://gitlab.com', token: '', groups: [] }

export function GitLabSettings() {
  const addToast = useUIStore((s) => s.addToast)
  const loadSettings = useSettingsStore((s) => s.load)
  const [settings, setSettings] = useState<GitLabSettings>(DEFAULTS)
  const [newGroup, setNewGroup] = useState('')
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    ;(window as any).api.settings.get({ key: 'gitlab' }).then(({ data }: { data: GitLabSettings }) => {
      if (data) setSettings({ ...DEFAULTS, ...data, groups: data.groups ?? [] })
    })
  }, [])

  const save = async () => {
    const { error } = await (window as any).api.settings.set({ key: 'gitlab', value: settings })
    if (error) {
      addToast('Failed to save GitLab settings', 'error')
    } else {
      addToast('GitLab settings saved', 'success')
      loadSettings()
    }
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
    const { error } = await (window as any).api.gitlab.sync()
    setSyncing(false)
    if (error) addToast(`Sync failed: ${error}`, 'error')
    else addToast('GitLab sync complete', 'success')
  }

  return (
    <div className="flex flex-col gap-5">
      <h3 className="text-sm font-semibold text-neutral-200">GitLab</h3>

      <div className="flex flex-col gap-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-neutral-400">Base URL</label>
          <Input
            placeholder="https://gitlab.com"
            value={settings.baseUrl}
            onChange={(e) => setSettings({ ...settings, baseUrl: e.target.value })}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-neutral-400">Token</label>
          <Input
            type="password"
            placeholder="glpat-..."
            value={settings.token}
            onChange={(e) => setSettings({ ...settings, token: e.target.value })}
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-neutral-400">Groups</label>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {settings.groups.map((g) => (
              <span
                key={g}
                className="flex items-center gap-1 rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300"
              >
                {g}
                <button onClick={() => removeGroup(g)} className="text-neutral-500 hover:text-neutral-300">
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
