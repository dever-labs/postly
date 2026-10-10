import React, { useEffect, useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'

type Mode = 'system' | 'manual' | 'none'

const MODE_LABELS: Record<Mode, string> = {
  system: 'System (use OS and HTTP_PROXY / HTTPS_PROXY settings)',
  manual: 'Manual',
  none: 'None (connect directly)',
}

export function NetworkSettings() {
  const [mode, setMode] = useState<Mode>('system')
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [hasPassword, setHasPassword] = useState(false)
  const [bypass, setBypass] = useState('')
  const [status, setStatus] = useState('')
  const [testUrl, setTestUrl] = useState('https://example.com')

  useEffect(() => {
    window.api.proxy.get().then(({ data }) => {
      if (!data) return
      setMode(data.mode)
      setUrl(data.url)
      setUsername(data.username)
      setBypass(data.bypass)
      setHasPassword(data.hasPassword)
    })
  }, [])

  const save = async () => {
    const { data, error } = await window.api.proxy.set({
      mode, url, username, bypass,
      ...(password !== '' && { password }),
    })
    if (error) { setStatus(error); return }
    setPassword('')
    setHasPassword(Boolean(data?.hasPassword))
    setStatus('Saved')
  }

  const clearPassword = async () => {
    await window.api.proxy.set({ mode, url, username, bypass, password: '' })
    setHasPassword(false)
    setStatus('Password cleared')
  }

  const test = async () => {
    await save()
    const { data, error } = await window.api.proxy.test({ url: testUrl })
    if (error) setStatus(error)
    else setStatus(data?.proxy ? `${testUrl} will use proxy ${data.proxy}` : `${testUrl} will connect directly`)
  }

  return (
    <div className="flex flex-col gap-5">
      <h3 className="text-sm font-semibold text-th-text-primary">Network</h3>

      <div className="flex flex-col gap-2" role="radiogroup" aria-label="Proxy mode">
        <span className="text-xs font-medium text-th-text-muted">Proxy</span>
        {(Object.keys(MODE_LABELS) as Mode[]).map((m) => (
          <label key={m} className="flex items-center gap-3 cursor-pointer">
            <input type="radio" name="proxy-mode" checked={mode === m} onChange={() => setMode(m)} className="h-4 w-4 accent-blue-500" />
            <span className="text-sm text-th-text-secondary">{MODE_LABELS[m]}</span>
          </label>
        ))}
      </div>

      {mode === 'manual' && (
        <div className="flex flex-col gap-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Proxy URL</label>
            <Input placeholder="http://proxy.example.com:8080 or socks5://host:1080" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Username <span className="text-th-text-faint">(optional)</span></label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="flex-1">
              <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Password</label>
              <Input
                type="password"
                value={password}
                placeholder={hasPassword ? 'Saved — leave blank to keep' : ''}
                onChange={(e) => setPassword(e.target.value)}
              />
              {hasPassword && (
                <button type="button" className="mt-1 text-[11px] text-th-text-faint underline" onClick={clearPassword}>Clear saved password</button>
              )}
            </div>
          </div>
        </div>
      )}

      {mode !== 'none' && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Bypass list</label>
          <Input placeholder="localhost, 127.0.0.1, .internal.example.com" value={bypass} onChange={(e) => setBypass(e.target.value)} />
          <p className="mt-1 text-[11px] text-th-text-faint">Comma-separated hosts that skip the proxy. A leading dot matches subdomains; * bypasses everything.{mode === 'system' ? ' NO_PROXY is also honored.' : ''}</p>
        </div>
      )}

      <div className="flex items-end gap-3">
        <div className="flex-1">
          <label className="mb-1.5 block text-xs font-medium text-th-text-muted">Test URL</label>
          <Input value={testUrl} onChange={(e) => setTestUrl(e.target.value)} />
        </div>
        <Button variant="outline" onClick={test}>Check route</Button>
        <Button onClick={save}>Save</Button>
      </div>

      {status && <p role="status" data-testid="proxy-status" className="text-xs text-th-text-subtle">{status}</p>}
    </div>
  )
}
