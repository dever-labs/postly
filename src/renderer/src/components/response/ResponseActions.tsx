import { Check, Copy, Download } from 'lucide-react'
import React, { useState } from 'react'
import { useUIStore } from '@/store/ui'
import { cn } from '@/lib/utils'

const button =
  'flex items-center gap-1.5 rounded-sm px-2 py-1 text-xs transition-colors focus:outline-hidden focus-visible:ring-1 focus-visible:ring-th-border-strong disabled:cursor-not-allowed disabled:opacity-40'
const idle = 'text-th-text-subtle hover:bg-th-surface-raised hover:text-th-text-secondary'

interface ResponseActionsProps {
  /** Text copied by the Copy button; null when the response has no text. */
  copyText: string | null
  bodyId?: string
  canSave: boolean
}

export function ResponseActions({ copyText, bodyId, canSave }: ResponseActionsProps) {
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const addToast = useUIStore((s) => s.addToast)

  const handleCopy = async () => {
    if (copyText === null) return
    try {
      await navigator.clipboard.writeText(copyText)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch (err) {
      addToast(`Could not copy: ${String(err)}`, 'error')
    }
  }

  const handleSave = async () => {
    if (!bodyId || saving) return
    setSaving(true)
    try {
      const { data, error } = await window.api.response.save({ bodyId }) as { data?: { filePath: string } | null; error?: string }
      if (error) addToast(`Could not save response: ${error}`, 'error')
      else if (data) addToast(`Saved to ${data.filePath}`, 'success')
    } catch (err) {
      addToast(`Could not save response: ${String(err)}`, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-1">
      {canSave && (
        <button
          type="button"
          data-testid="response-save"
          onClick={handleSave}
          disabled={!bodyId || saving}
          title={bodyId ? 'Save the response body to a file' : 'This response is too large to save'}
          className={cn(button, idle)}
        >
          <Download className="h-3.5 w-3.5" />
          {saving ? 'Saving…' : 'Save'}
        </button>
      )}
      <button
        type="button"
        data-testid="response-copy"
        onClick={handleCopy}
        disabled={copyText === null}
        title={copyText === null ? 'Binary responses cannot be copied as text' : undefined}
        className={cn(button, copied ? 'text-emerald-400' : idle)}
      >
        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  )
}
