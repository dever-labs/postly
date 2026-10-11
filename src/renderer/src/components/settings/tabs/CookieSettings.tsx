import { Pencil, Plus, Trash2 } from 'lucide-react'
import React, { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cookieFlags, formatExpiry, maskValue } from '@/lib/cookieFormat'
import { useUIStore } from '@/store/ui'
import type { CookieRecord } from '@/types'

type CookieId = { name: string; domain: string; path: string }

const EMPTY: CookieRecord = { name: '', value: '', domain: '', path: '/', expires: null, secure: false, httpOnly: false, sameSite: '', hostOnly: true }

// datetime-local works in local time without a zone suffix
const toLocalInput = (ms: number | null): string => {
  if (ms === null) return ''
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000)
  return d.toISOString().slice(0, 16)
}
const fromLocalInput = (v: string): number | null => (v ? new Date(v).getTime() : null)

export function CookieSettings() {
  const [environment, setEnvironment] = useState<string | null>(null)
  const [cookies, setCookies] = useState<CookieRecord[]>([])
  const [enabled, setEnabled] = useState(true)
  const [reveal, setReveal] = useState(false)
  const [draft, setDraft] = useState<CookieRecord | null>(null)
  const [editing, setEditing] = useState<CookieId | undefined>()
  const addToast = useUIStore((s) => s.addToast)

  const refresh = useCallback(async () => {
    const res = (await window.api.cookies.list()) as { data?: { environment: string | null; cookies: CookieRecord[] }; error?: string }
    if (res.data) { setEnvironment(res.data.environment); setCookies(res.data.cookies) }
  }, [])

  useEffect(() => {
    void refresh()
    void (window.api.settings.get({ key: 'general' }) as Promise<{ data?: { cookiesEnabled?: boolean } }>).then(({ data }) => setEnabled(data?.cookiesEnabled !== false))
  }, [refresh])

  const save = async () => {
    if (!draft) return
    const res = (await window.api.cookies.upsert({ cookie: draft, previous: editing })) as { error?: string }
    if (res.error) { addToast(res.error.replace(/^Error: /, ''), 'error'); return }
    setDraft(null); setEditing(undefined)
    await refresh()
  }

  const remove = async (c: CookieRecord) => {
    await window.api.cookies.delete({ name: c.name, domain: c.domain, path: c.path })
    await refresh()
  }

  const clear = async (domain?: string) => {
    await window.api.cookies.clear(domain ? { domain } : undefined)
    await refresh()
  }

  const domains = [...new Set(cookies.map((c) => c.domain))]
  const set = <K extends keyof CookieRecord>(key: K, value: CookieRecord[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d))

  return (
    <div className="flex flex-col gap-4" data-testid="cookie-settings">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-th-text-primary">Cookies</h3>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" data-testid="cookie-add" onClick={() => { setDraft({ ...EMPTY }); setEditing(undefined) }}><Plus className="mr-1 h-3.5 w-3.5" />Add</Button>
          <Button size="sm" variant="outline" data-testid="cookie-clear-all" disabled={cookies.length === 0} onClick={() => void clear()}>Clear all</Button>
        </div>
      </div>
      <p className="text-xs text-th-text-subtle">
        Cookies from responses are sent automatically to matching requests. They belong to the {environment ? <>active environment <strong>{environment}</strong></> : 'no-environment jar (no environment is active)'}, so switching environments switches cookies. Values are stored encrypted with the rest of your data.
      </p>
      {!enabled && <p className="rounded-sm border border-amber-800 bg-amber-900/20 px-3 py-2 text-xs text-amber-300">The cookie jar is turned off in General settings. Nothing below is sent or updated.</p>}

      {draft && (
        <div data-testid="cookie-form" className="grid grid-cols-2 gap-3 rounded-md border border-th-border-strong bg-th-surface-raised p-3">
          <label className="text-xs text-th-text-muted">Name<Input data-testid="cookie-name" value={draft.name} onChange={(e) => set('name', e.target.value)} /></label>
          <label className="text-xs text-th-text-muted">Value<Input data-testid="cookie-value" value={draft.value} onChange={(e) => set('value', e.target.value)} /></label>
          <label className="text-xs text-th-text-muted">Domain<Input data-testid="cookie-domain" placeholder="api.example.com" value={draft.domain} onChange={(e) => set('domain', e.target.value)} /></label>
          <label className="text-xs text-th-text-muted">Path<Input data-testid="cookie-path" value={draft.path} onChange={(e) => set('path', e.target.value)} /></label>
          <label className="text-xs text-th-text-muted">Expires (empty = session)<Input type="datetime-local" value={toLocalInput(draft.expires)} onChange={(e) => set('expires', fromLocalInput(e.target.value))} /></label>
          <label className="text-xs text-th-text-muted">SameSite
            <select value={draft.sameSite} onChange={(e) => set('sameSite', e.target.value as CookieRecord['sameSite'])} className="w-full rounded-sm border border-th-border-strong bg-th-surface px-3 py-1.5 text-sm text-th-text-primary">
              <option value="">Not set</option><option value="lax">Lax</option><option value="strict">Strict</option><option value="none">None</option>
            </select>
          </label>
          <div className="col-span-2 flex flex-wrap items-center gap-4 text-xs text-th-text-secondary">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={draft.secure} onChange={(e) => set('secure', e.target.checked)} />Secure</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={draft.httpOnly} onChange={(e) => set('httpOnly', e.target.checked)} />HttpOnly</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={draft.hostOnly} onChange={(e) => set('hostOnly', e.target.checked)} />Host only (exclude subdomains)</label>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => { setDraft(null); setEditing(undefined) }}>Cancel</Button>
            <Button size="sm" data-testid="cookie-save" onClick={() => void save()}>Save cookie</Button>
          </div>
        </div>
      )}

      {cookies.length === 0 ? (
        <div data-testid="cookie-empty" className="rounded-md border border-dashed border-th-border-strong px-4 py-8 text-center text-xs text-th-text-faint">No cookies yet. Send a request to a server that sets one, or add one manually.</div>
      ) : (
        <>
          <label className="flex items-center gap-2 text-xs text-th-text-subtle">
            <input type="checkbox" data-testid="cookie-reveal" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />Show values
          </label>
          {domains.map((domain) => (
            <section key={domain} data-testid={`cookie-domain-${domain}`} className="overflow-hidden rounded-md border border-th-border">
              <header className="flex items-center justify-between bg-th-surface-raised px-3 py-1.5">
                <span className="text-xs font-medium text-th-text-secondary">{domain}</span>
                <button onClick={() => void clear(domain)} className="text-[11px] text-th-text-subtle hover:text-rose-400">Clear domain</button>
              </header>
              <table className="w-full text-xs">
                <tbody>
                  {cookies.filter((c) => c.domain === domain).map((c) => (
                    <tr key={`${c.name}-${c.path}`} data-testid="cookie-row" className="border-t border-th-surface">
                      <td className="px-3 py-1.5 font-mono text-th-text-muted">{c.name}</td>
                      <td className="max-w-48 break-all px-3 py-1.5 font-mono text-th-text-secondary">{reveal ? c.value : maskValue(c.value)}</td>
                      <td className="px-3 py-1.5 text-th-text-secondary">{c.path}</td>
                      <td className="px-3 py-1.5 text-th-text-subtle">{formatExpiry(c.expires)}</td>
                      <td className="px-3 py-1.5 text-th-text-subtle">{cookieFlags(c).join(', ')}</td>
                      <td className="px-3 py-1.5 text-right">
                        <button aria-label={`Edit ${c.name}`} onClick={() => { setDraft({ ...c }); setEditing({ name: c.name, domain: c.domain, path: c.path }) }} className="mr-2 text-th-text-subtle hover:text-th-text-secondary"><Pencil className="h-3.5 w-3.5" /></button>
                        <button aria-label={`Delete ${c.name}`} onClick={() => void remove(c)} className="text-th-text-subtle hover:text-rose-400"><Trash2 className="h-3.5 w-3.5" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </>
      )}
    </div>
  )
}
