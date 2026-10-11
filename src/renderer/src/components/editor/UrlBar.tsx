import React, { useCallback, useEffect, useRef, useState } from 'react'
import { EnvInput } from '@/components/editor/EnvInput'

interface UrlBarProps {
  value: string
  onChange: (url: string) => void
  onSend?: () => void
  isLoading?: boolean
  /** Called with pasted text; return true when it was consumed (e.g. a cURL command) so the default paste is skipped */
  onPasteText?: (text: string) => boolean
}

/**
 * URL input with a local-state buffer that debounces Zustand store updates.
 * Only this component (and EnvInput inside it) re-renders on every keystroke;
 * the parent RequestEditor re-renders only after the 100 ms debounce fires.
 */
export const UrlBar = React.memo(function UrlBar({ value, onChange, onSend, isLoading, onPasteText }: UrlBarProps) {
  const [localUrl, setLocalUrl] = useState(value)
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Stable ref so handleChange/handleSend never need onChange in their dep array
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const localUrlRef = useRef(localUrl)
  localUrlRef.current = localUrl

  // Sync local state when the external value changes (request switch, undo, etc.)
  // Also cancel any pending flush to prevent a stale update overwriting the new value.
  useEffect(() => {
    if (flushTimer.current) { clearTimeout(flushTimer.current); flushTimer.current = null }
    setLocalUrl(value)
  }, [value])

  const handleChange = useCallback((url: string) => {
    setLocalUrl(url)
    if (flushTimer.current) clearTimeout(flushTimer.current)
    flushTimer.current = setTimeout(() => {
      flushTimer.current = null
      onChangeRef.current(url)
    }, 100)
  }, [])

  const handleSend = useCallback(() => {
    // Flush any buffered URL to the store before sending
    if (flushTimer.current) {
      clearTimeout(flushTimer.current)
      flushTimer.current = null
      onChangeRef.current(localUrlRef.current)
    }
    onSend?.()
  }, [onSend])

  return (
    <EnvInput
      value={localUrl}
      onChange={handleChange}
      onKeyDown={(e) => e.key === 'Enter' && !isLoading && handleSend()}
      onPaste={(e) => {
        // Only take over when it would not clobber a URL the user is editing: an empty field or a full selection
        const input = e.currentTarget
        const replacesAll = input.value.trim() === '' || (input.selectionStart === 0 && input.selectionEnd === input.value.length)
        if (replacesAll && onPasteText?.(e.clipboardData.getData('text'))) e.preventDefault()
      }}
      placeholder="https://api.example.com/endpoint"
      data-testid="url-input"
      spellCheck={false}
      wrapperClassName="flex-1"
      className="w-full rounded-sm border border-th-border-strong bg-th-surface px-3 py-1.5 text-sm text-th-text-primary focus:border-th-border-strong focus:outline-hidden focus:ring-1 focus:ring-th-border-strong placeholder:text-th-text-subtle"
    />
  )
})
