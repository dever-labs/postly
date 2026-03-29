import React, { useEffect, useState } from 'react'
import type { GeneralSettings } from '@/types'
import { Input } from '@/components/ui/Input'

const DEFAULTS: GeneralSettings = {
  theme: 'dark',
  defaultTimeout: 30000,
  followRedirects: true,
  sslVerification: true,
}

export function GeneralSettings() {
  const [settings, setSettings] = useState<GeneralSettings>(DEFAULTS)

  useEffect(() => {
    ;window.api.settings.get({ key: 'general' }).then(({ data }: { data: GeneralSettings }) => {
      if (data) setSettings({ ...DEFAULTS, ...data })
    })
  }, [])

  const update = <K extends keyof GeneralSettings>(key: K, value: GeneralSettings[K]) => {
    const next = { ...settings, [key]: value }
    setSettings(next)
    ;window.api.settings.set({ key: 'general', value: next })
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
    </div>
  )
}
