import { Plus, Trash2 } from 'lucide-react'
import React, { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useUIStore } from '@/store/ui'

interface CertificateRow {
  id: string
  kind: 'ca' | 'client'
  name: string
  host: string
  port: number
  format: 'pem' | 'pfx'
  hasPassphrase: boolean
  subject: string
  validTo: number | null
  problem: string | null
}

interface Draft {
  kind: 'ca' | 'client'
  name: string
  host: string
  port: string
  certPem: string
  keyPem: string
  pfxBase64: string
  passphrase: string
}

const EMPTY: Draft = { kind: 'client', name: '', host: '', port: '', certPem: '', keyPem: '', pfxBase64: '', passphrase: '' }

const toBase64 = (buf: ArrayBuffer): string => {
  let bin = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

const expiry = (ms: number | null): string => (ms === null ? 'expiry unknown' : `${ms < Date.now() ? 'expired' : 'expires'} ${new Date(ms).toISOString().slice(0, 10)}`)

export function CertificateSettings() {
  const [rows, setRows] = useState<CertificateRow[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  const addToast = useUIStore((s) => s.addToast)

  const refresh = useCallback(async () => {
    const res = (await window.api.certificates.list()) as { data?: CertificateRow[] }
    if (res.data) setRows(res.data)
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => { setError(null); setDraft((d) => (d ? { ...d, [key]: value } : d)) }

  const readText = async (file: File | undefined, key: 'certPem' | 'keyPem') => {
    if (!file) return
    set(key, await file.text())
    if (key === 'certPem' && draft && !draft.name) set('name', file.name.replace(/\.[^.]+$/, ''))
  }
  const readPfx = async (file: File | undefined) => {
    if (!file) return
    set('pfxBase64', toBase64(await file.arrayBuffer()))
    if (draft && !draft.name) set('name', file.name.replace(/\.[^.]+$/, ''))
  }

  const save = async () => {
    if (!draft) return
    const res = (await window.api.certificates.add({
      kind: draft.kind,
      name: draft.name,
      host: draft.host,
      port: draft.port ? Number(draft.port) : 0,
      certPem: draft.certPem,
      keyPem: draft.keyPem,
      pfxBase64: draft.pfxBase64,
      passphrase: draft.passphrase,
    })) as { error?: string }
    if (res.error) { setError(res.error.replace(/^Error: /, '')); return }
    setDraft(null)
    addToast('Certificate saved', 'success')
    await refresh()
  }

  const remove = async (id: string) => {
    await window.api.certificates.delete({ id })
    await refresh()
  }

  const cas = rows.filter((r) => r.kind === 'ca')
  const clients = rows.filter((r) => r.kind === 'client')

  return (
    <div className="flex flex-col gap-4" data-testid="certificate-settings">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-th-text-primary">Certificates</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" data-testid="cert-add-ca" onClick={() => { setError(null); setDraft({ ...EMPTY, kind: 'ca' }) }}><Plus className="mr-1 h-3.5 w-3.5" />CA certificate</Button>
          <Button size="sm" variant="outline" data-testid="cert-add-client" onClick={() => { setError(null); setDraft({ ...EMPTY, kind: 'client' }) }}><Plus className="mr-1 h-3.5 w-3.5" />Client certificate</Button>
        </div>
      </div>
      <p className="text-xs text-th-text-subtle">
        CA certificates are trusted in addition to the system roots when SSL verification is on. A client certificate is presented to servers whose host matches (most specific wins).
        Used by HTTP, GraphQL, WebSocket, MQTT, gRPC (PEM only) and the OAuth, Backstage, GitHub and GitLab connections. Keys and passphrases are stored encrypted with the rest of your data.
      </p>

      {draft && (
        <div data-testid="cert-form" className="grid grid-cols-2 gap-3 rounded-md border border-th-border-strong bg-th-surface-raised p-3">
          <label className="text-xs text-th-text-muted">Name<Input data-testid="cert-name" value={draft.name} onChange={(e) => set('name', e.target.value)} /></label>
          {draft.kind === 'client' && (
            <>
              <label className="text-xs text-th-text-muted">Host<Input data-testid="cert-host" placeholder="api.example.com, *.example.com or *" value={draft.host} onChange={(e) => set('host', e.target.value)} /></label>
              <label className="text-xs text-th-text-muted">Port (optional)<Input data-testid="cert-port" inputMode="numeric" value={draft.port} onChange={(e) => set('port', e.target.value.replace(/\D/g, ''))} /></label>
            </>
          )}
          <label className="text-xs text-th-text-muted">{draft.kind === 'ca' ? 'CA file (PEM, may hold several)' : 'Certificate (PEM)'}
            <input data-testid="cert-file" type="file" accept=".pem,.crt,.cer" onChange={(e) => void readText(e.target.files?.[0], 'certPem')} className="mt-1 block w-full text-xs" />
          </label>
          {draft.kind === 'client' && (
            <>
              <label className="text-xs text-th-text-muted">Private key (PEM)
                <input data-testid="cert-key-file" type="file" accept=".pem,.key" onChange={(e) => void readText(e.target.files?.[0], 'keyPem')} className="mt-1 block w-full text-xs" />
              </label>
              <label className="text-xs text-th-text-muted">…or PFX / PKCS#12 instead
                <input data-testid="cert-pfx-file" type="file" accept=".pfx,.p12" onChange={(e) => void readPfx(e.target.files?.[0])} className="mt-1 block w-full text-xs" />
              </label>
              <label className="text-xs text-th-text-muted">Passphrase (if encrypted)<Input data-testid="cert-passphrase" type="password" autoComplete="off" value={draft.passphrase} onChange={(e) => set('passphrase', e.target.value)} /></label>
            </>
          )}
          {error && <p role="alert" data-testid="cert-error" className="col-span-2 text-xs text-rose-400">{error}</p>}
          <div className="col-span-2 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
            <Button size="sm" data-testid="cert-save" onClick={() => void save()}>Save certificate</Button>
          </div>
        </div>
      )}

      <section>
        <h4 className="mb-1 text-xs font-medium text-th-text-muted">Custom CA certificates</h4>
        {cas.length === 0 ? <p data-testid="cert-ca-empty" className="text-xs text-th-text-faint">None. Only the system roots are trusted.</p> : <CertTable rows={cas} onDelete={remove} />}
      </section>
      <section>
        <h4 className="mb-1 text-xs font-medium text-th-text-muted">Client certificates</h4>
        {clients.length === 0 ? <p data-testid="cert-client-empty" className="text-xs text-th-text-faint">None.</p> : <CertTable rows={clients} onDelete={remove} />}
      </section>
    </div>
  )
}

function CertTable({ rows, onDelete }: { rows: CertificateRow[]; onDelete: (id: string) => Promise<void> }) {
  return (
    <div className="overflow-hidden rounded-md border border-th-border">
      <table className="w-full text-xs">
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} data-testid="cert-row" className="border-t border-th-surface first:border-t-0">
              <td className="px-3 py-1.5 text-th-text-secondary">{r.name}</td>
              <td className="px-3 py-1.5 font-mono text-th-text-muted">{r.kind === 'client' ? `${r.host}${r.port ? `:${r.port}` : ''}` : r.subject}</td>
              <td className="px-3 py-1.5 text-th-text-subtle">{r.format.toUpperCase()}{r.hasPassphrase ? ' · passphrase' : ''}</td>
              <td className={r.problem || (r.validTo !== null && r.validTo < Date.now()) ? 'px-3 py-1.5 text-rose-400' : 'px-3 py-1.5 text-th-text-subtle'}>{r.problem ?? expiry(r.validTo)}</td>
              <td className="px-3 py-1.5 text-right">
                <button aria-label={`Delete ${r.name}`} onClick={() => void onDelete(r.id)} className="text-th-text-subtle hover:text-rose-400"><Trash2 className="h-3.5 w-3.5" /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
