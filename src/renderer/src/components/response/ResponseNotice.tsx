import React from 'react'
import type { HttpResponse } from '@/types'
import { formatSize } from '@/lib/responseBody'

/** Explains why the viewer shows less than the full body. */
export function ResponseNotice({ response, contentType }: { response: HttpResponse; contentType: string }) {
  let text: string | null = null
  if (response.binary) {
    text = `Binary response (${contentType || 'unknown type'}, ${formatSize(response.size)}). It is not shown as text.${response.bodyId ? ' Use Save to write it to a file.' : ''}`
  } else if (response.bodyTruncated) {
    text = `Showing the first part of a ${formatSize(response.size)} response.${response.bodyId ? ' Save writes the full body.' : ''}`
  }
  if (response.bodyTooLarge) {
    text = `${text ? `${text} ` : ''}This response is too large to keep, so it cannot be saved.`
  }
  if (!text) return null
  return (
    <div data-testid="response-notice" role="note" className="border-b border-th-border bg-th-surface px-4 py-1.5 text-xs text-th-text-muted">
      {text}
    </div>
  )
}
