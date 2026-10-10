import { X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { parseCurl } from '@/lib/curl'
import { importCurlAsNewRequest } from '@/lib/curlActions'
import { useCurlImportStore } from '@/store/curlImport'

export function CurlImportDialog() {
  const open = useCurlImportStore((s) => s.open)
  return open ? <Dialog /> : null
}

function Dialog() {
  const hide = useCurlImportStore((s) => s.hide)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const parsed = useMemo(() => (text.trim() ? parseCurl(text) : null), [text])

  useEffect(() => { areaRef.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); hide() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [hide])

  const submit = async () => {
    if (!parsed || busy) return
    setBusy(true)
    const ok = await importCurlAsNewRequest(text)
    setBusy(false)
    if (ok) hide()
  }

  return (
    <div
      className="fixed inset-0 z-[300] flex items-start justify-center bg-black/50 pt-[10vh] backdrop-blur-xs"
      onMouseDown={(e) => { if (e.target === e.currentTarget) hide() }}
    >
      <div role="dialog" aria-modal="true" aria-label="Import from cURL" data-testid="curl-import-dialog" className="w-[640px] max-w-[92vw] overflow-hidden rounded-lg border border-th-border-strong bg-th-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-th-border px-4 py-3">
          <h2 className="text-sm font-semibold text-th-text-primary">Import from cURL</h2>
          <button onClick={hide} aria-label="Close" className="rounded-sm p-1 text-th-text-subtle hover:bg-th-surface-raised hover:text-th-text-primary"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex flex-col gap-2 p-4">
          <textarea
            ref={areaRef}
            data-testid="curl-import-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            placeholder={"curl -X POST 'https://api.example.com/items' -H 'Content-Type: application/json' -d '{\"name\":\"x\"}'"}
            className="h-40 w-full resize-none rounded-sm border border-th-border-strong bg-th-bg p-2 font-mono text-xs text-th-text-primary placeholder:text-th-text-subtle focus:outline-hidden focus:ring-1 focus:ring-th-border-strong"
          />
          <div data-testid="curl-import-status" className="min-h-[2.5rem] text-xs text-th-text-subtle">
            {!text.trim() && 'Paste a cURL command (bash, cmd or PowerShell). Chrome and Firefox "Copy as cURL" work.'}
            {text.trim() && !parsed && <span className="text-red-400">Not a valid cURL command.</span>}
            {parsed && (
              <>
                <div className="text-th-text-secondary"><span className="font-mono">{parsed.method}</span> {parsed.url}</div>
                {parsed.warnings.map((w) => <div key={w} className="text-amber-400">• {w}</div>)}
              </>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-th-border px-4 py-3">
          <button onClick={hide} className="rounded-sm px-3 py-1.5 text-sm text-th-text-subtle hover:bg-th-surface-raised">Cancel</button>
          <button
            data-testid="curl-import-submit"
            onClick={() => void submit()}
            disabled={!parsed || busy}
            className="rounded-sm bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40"
          >
            Import as new request
          </button>
        </div>
      </div>
    </div>
  )
}
