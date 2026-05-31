import React, { useEffect, useState } from 'react'
import type { GeneralSettings } from '@/types'
import { Input } from '@/components/ui/Input'

const DEFAULTS: GeneralSettings = {
  theme: 'dark',
  defaultTimeout: 30000,
  followRedirects: true,
  sslVerification: true,
  autoUpdate: true,
}

export function GeneralSettings() {
  const [settings, setSettings] = useState<GeneralSettings>(DEFAULTS)
  const [updateStatus, setUpdateStatus] = useState<string>('')

  useEffect(() => {
    ;window.api.settings.get({ key: 'general' }).then(({ data }: { data: GeneralSettings }) => {
      if (data) setSettings({ ...DEFAULTS, ...data })
    })
  }, [])

  useEffect(() => {
    const off = window.api.updater.onEvent((event) => {
      if (event.type === 'checking') setUpdateStatus('Checking for updates…')
      else if (event.type === 'available') setUpdateStatus(`Update ${event.version} available — downloading from the notification bar`)
      else if (event.type === 'not-available') setUpdateStatus('You are on the latest version.')
      else if (event.type === 'error') setUpdateStatus(`Error: ${event.error}`)
      else if (event.type === 'downloaded') setUpdateStatus(`Update ${event.version} downloaded — restart to install`)
    })
    return () => { off() }
  }, [])

  const update = <K extends keyof GeneralSettings>(key: K, value: GeneralSettings[K]) => {
    const next = { ...settings, [key]: value }
    setSettings(next)
    ;window.api.settings.set({ key: 'general', value: next })
  }

  const handleCheckNow = () => {
    setUpdateStatus('')
    window.api.updater.check()
  }

  return (
    <div className="flex flex-col gap-5">
      <h3 className="text-sm font-semibold text-th-text-primary">General</h3>

      <div className="flex flex-col gap-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Default Timeout (ms)</label>
          <Input
            type="number"
            className="w-48"
            value={settings.defaultTimeout}
            onChange={(e) => update('defaultTimeout', Number(e.target.value))}
          />
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.sslVerification}
              onChange={(e) => update('sslVerification', e.target.checked)}
              className="h-4 w-4 accent-blue-500"
            />
            <span className="text-sm text-th-text-secondary">SSL Verification</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.followRedirects}
              onChange={(e) => update('followRedirects', e.target.checked)}
              className="h-4 w-4 accent-blue-500"
            />
            <span className="text-sm text-th-text-secondary">Follow Redirects</span>
          </label>
        </div>
      </div>

      <div className="border-t border-th-border pt-4 flex flex-col gap-4">
        <h4 className="text-xs font-semibold text-th-text-muted uppercase tracking-wide">Updates</h4>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.autoUpdate ?? true}
            onChange={(e) => update('autoUpdate', e.target.checked)}
            className="h-4 w-4 accent-blue-500"
          />
          <span className="text-sm text-th-text-secondary">Check for updates on startup</span>
        </label>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-th-text-muted">
            Custom update feed URL <span className="opacity-60">(optional — for enterprise/self-hosted)</span>
          </label>
          <Input
            type="url"
            className="w-full max-w-sm"
            placeholder="https://updates.example.com/postly/"
            value={settings.updateFeedUrl ?? ''}
            onChange={(e) => update('updateFeedUrl', e.target.value || undefined)}
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleCheckNow}
            className="rounded-sm border border-th-border bg-th-surface-raised px-3 py-1.5 text-xs text-th-text-secondary hover:text-th-text-primary hover:border-th-border-active transition-colors focus:outline-hidden"
          >
            Check for updates now
          </button>
          {updateStatus && (
            <span className="text-xs text-th-text-muted">{updateStatus}</span>
          )}
        </div>
      </div>
    </div>
  )
}
