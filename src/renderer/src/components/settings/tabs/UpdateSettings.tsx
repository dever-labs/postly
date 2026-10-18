import React, { useEffect, useState } from 'react'
import type { GeneralSettings } from '@/types'
import { Input } from '@/components/ui/Input'

const DEFAULTS: Pick<GeneralSettings, 'autoUpdate' | 'updateFeedUrl'> = {
  autoUpdate: true,
  updateFeedUrl: undefined,
}

export function UpdateSettings() {
  const [settings, setSettings] = useState(DEFAULTS)
  const [updateStatus, setUpdateStatus] = useState<string>('')
  const [enterpriseUrl, setEnterpriseUrl] = useState<string | null>(null)
  const [draftFeedUrl, setDraftFeedUrl] = useState('')
  const [feedError, setFeedError] = useState<string | null>(null)
  const [savingFeed, setSavingFeed] = useState(false)

  useEffect(() => {
    window.api.settings.get({ key: 'general' }).then(({ data }: { data: GeneralSettings }) => {
      if (data) {
        const next = { autoUpdate: data.autoUpdate ?? true, updateFeedUrl: data.updateFeedUrl }
        setSettings(next)
        setDraftFeedUrl(next.updateFeedUrl ?? '')
      }
    })
    window.api.updater.getEnterpriseConfig().then(({ data }) => {
      setEnterpriseUrl(data?.updateUrl ?? null)
    })
  }, [])

  useEffect(() => {
    const off = window.api.updater.onEvent((event) => {
      if (event.type === 'checking') setUpdateStatus('Checking for updates…')
      else if (event.type === 'available') setUpdateStatus(`Update ${event.version} is available — see the notification bar to download.`)
      else if (event.type === 'not-available') setUpdateStatus('You are on the latest version.')
      else if (event.type === 'error') setUpdateStatus(`Error: ${event.error}`)
      else if (event.type === 'downloaded') setUpdateStatus(`Update ${event.version} downloaded — restart to install.`)
    })
    return () => { off() }
  }, [])

  const update = (key: 'autoUpdate', value: boolean) => {
    const next = { ...settings, [key]: value }
    setSettings(next)
    window.api.settings.get({ key: 'general' }).then(({ data }: { data: GeneralSettings }) => {
      window.api.settings.set({ key: 'general', value: { ...data, ...next } })
    })
  }

  const applyFeedUrl = async (rawValue = draftFeedUrl) => {
    const nextUrl = rawValue.trim() || undefined
    setSavingFeed(true)
    const { error } = await window.api.updater.setFeed({ url: nextUrl ?? '' })
    if (error) {
      setFeedError(String(error))
      setSavingFeed(false)
      return
    }

    const { data } = await window.api.settings.get({ key: 'general' }) as { data: GeneralSettings }
    const next = { autoUpdate: settings.autoUpdate ?? true, updateFeedUrl: nextUrl }
    await window.api.settings.set({ key: 'general', value: { ...data, ...next } })
    setSettings(next)
    setDraftFeedUrl(nextUrl ?? '')
    setFeedError(null)
    setUpdateStatus(nextUrl ? 'Internal update server saved.' : 'Using the default GitHub Releases channel.')
    setSavingFeed(false)
  }

  const handleCheckNow = () => {
    setUpdateStatus('')
    window.api.updater.check()
  }

  const isEnterpriseManaged = Boolean(enterpriseUrl)

  return (
    <div className="flex flex-col gap-5">
      <h3 className="text-sm font-semibold text-th-text-primary">Updates</h3>

      <div className="flex flex-col gap-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.autoUpdate ?? true}
            onChange={(e) => update('autoUpdate', e.target.checked)}
            className="h-4 w-4 accent-blue-500"
          />
          <div>
            <span className="text-sm text-th-text-secondary">Check for updates on startup</span>
            <p className="text-xs text-th-text-muted mt-0.5">Automatically checks for new releases when Postly opens.</p>
          </div>
        </label>

        <div className="flex items-center gap-3 pt-1">
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

      {/* ── Enterprise / Disconnected Mode ─────────────────────────────── */}
      <div className="border-t border-th-border pt-4 flex flex-col gap-3">
        <div>
          <h4 className="text-xs font-semibold text-th-text-muted uppercase tracking-wide">
            Enterprise / Disconnected Mode
          </h4>
          <p className="mt-1 text-xs text-th-text-muted leading-relaxed">
            Configure an internal update mirror for air-gapped or proxy-restricted networks.
            When set, updates are fetched from this server instead of GitHub Releases.{' '}
            <span className="opacity-90">
              The server must serve <code className="font-mono">latest.yml</code> and the installer
              binaries in the standard electron-updater generic provider format.
            </span>
          </p>
        </div>

        {isEnterpriseManaged ? (
          <div className="rounded-sm border border-blue-500/30 bg-blue-500/5 px-3 py-2.5 flex flex-col gap-1">
            <span className="text-xs font-medium text-blue-400 light:text-blue-800">Managed by your administrator</span>
            <span className="text-xs text-th-text-muted font-mono break-all">{enterpriseUrl}</span>
            <span className="text-xs text-th-text-muted opacity-90 mt-0.5">
              This URL is configured in the bundled enterprise.json and cannot be changed here.
            </span>
          </div>
        ) : (
          <div>
            <label htmlFor="update-internal-update-server-url" className="mb-1.5 block text-xs font-medium text-th-text-muted">
              Internal update server URL
            </label>
            <Input id="update-internal-update-server-url"
              type="url"
              className="w-full max-w-sm"
              placeholder="https://updates.internal.corp/postly/"
              value={draftFeedUrl}
              onChange={(e) => {
                setDraftFeedUrl(e.target.value)
                setFeedError(null)
              }}
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={() => { void applyFeedUrl() }}
                disabled={savingFeed || draftFeedUrl === (settings.updateFeedUrl ?? '')}
                className="rounded-sm border border-th-border bg-th-surface-raised px-3 py-1.5 text-xs text-th-text-secondary hover:text-th-text-primary hover:border-th-border-active transition-colors disabled:opacity-50"
              >
                {savingFeed ? 'Saving…' : 'Apply'}
              </button>
              <button
                onClick={() => {
                  setDraftFeedUrl('')
                  setFeedError(null)
                  void applyFeedUrl('')
                }}
                disabled={savingFeed}
                className="rounded-sm border border-th-border px-3 py-1.5 text-xs text-th-text-muted hover:text-th-text-secondary transition-colors disabled:opacity-50"
              >
                Use GitHub Releases
              </button>
            </div>
            {feedError && (
              <p className="mt-1.5 text-xs text-rose-400 light:text-rose-800">{feedError}</p>
            )}
            <p className="mt-1.5 text-xs text-th-text-muted">
              Leave blank to use the default GitHub Releases channel.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
