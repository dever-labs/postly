import { Terminal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { exportActiveAsCurl, type CurlCopyOptions } from '@/lib/curlActions'
import { useUIStore } from '@/store/ui'

const KEY = 'postly-curl-copy'

function load(): CurlCopyOptions {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<CurlCopyOptions>
    return { resolveVariables: raw.resolveVariables ?? true, includeSecrets: raw.includeSecrets ?? false }
  } catch { return { resolveVariables: true, includeSecrets: false } }
}

export function CurlCopyMenu() {
  const [open, setOpen] = useState(false)
  const [opts, setOpts] = useState<CurlCopyOptions>(load)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setOpen(false) } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const update = (next: CurlCopyOptions) => { setOpts(next); localStorage.setItem(KEY, JSON.stringify(next)) }

  const copy = async () => {
    const out = exportActiveAsCurl(opts)
    const { addToast } = useUIStore.getState()
    if (!out) { addToast('Copy as cURL is only available for HTTP and GraphQL requests', 'info'); return }
    try {
      await navigator.clipboard.writeText(out.command)
      addToast(out.notes.length > 0 ? `Copied as cURL. ${out.notes.join(' ')}` : 'Copied as cURL', 'success')
      setOpen(false)
    } catch {
      addToast('Could not access the clipboard', 'error')
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        data-testid="curl-copy-button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Copy as cURL"
        aria-label="Copy as cURL"
        className="rounded-sm p-1.5 text-th-text-subtle hover:bg-th-surface-raised hover:text-th-text-secondary focus:outline-hidden"
      >
        <Terminal className="h-4 w-4" />
      </button>
      {open && (
        <div role="dialog" aria-label="Copy as cURL" data-testid="curl-copy-menu" className="absolute right-0 top-full z-50 mt-1 w-72 rounded-md border border-th-border-strong bg-th-surface p-3 shadow-xl">
          <fieldset className="flex flex-col gap-1 text-xs text-th-text-secondary">
            <legend className="pb-1 text-[10px] font-semibold uppercase tracking-wide text-th-text-subtle">Variables</legend>
            <label className="flex items-center gap-2"><input type="radio" name="curl-vars" checked={opts.resolveVariables} onChange={() => update({ ...opts, resolveVariables: true })} />Use the active environment's values</label>
            <label className="flex items-center gap-2"><input type="radio" name="curl-vars" checked={!opts.resolveVariables} onChange={() => update({ ...opts, resolveVariables: false })} />Keep {'{{VAR}}'} placeholders</label>
          </fieldset>
          <label className="mt-3 flex items-center gap-2 text-xs text-th-text-secondary">
            <input data-testid="curl-include-secrets" type="checkbox" checked={opts.includeSecrets} onChange={(e) => update({ ...opts, includeSecrets: e.target.checked })} />
            Include secrets
          </label>
          <p className="mt-1 text-[11px] text-th-text-subtle">
            {opts.includeSecrets ? 'Tokens, passwords and secret variables will be written in plain text. Be careful where you paste it.' : 'Tokens, passwords, credential headers and secret variables are replaced with placeholders.'}
          </p>
          <button data-testid="curl-copy-submit" onClick={() => void copy()} className="mt-3 w-full rounded-sm bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500">Copy</button>
        </div>
      )}
    </div>
  )
}
