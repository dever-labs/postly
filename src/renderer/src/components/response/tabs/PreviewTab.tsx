import React, { useEffect, useState } from 'react'
import { isPreviewableImage } from '@/lib/responseBody'

interface PreviewTabProps {
  body: string
  contentType?: string
  bodyId?: string
  binary?: boolean
}

export function PreviewTab({ body, contentType = '', bodyId, binary }: PreviewTabProps) {
  const image = isPreviewableImage(contentType)
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSrc(null)
    setError(null)
    if (!image || !bodyId) return
    let current = true
    window.api.response.preview({ bodyId }).then((result: { data?: { mime: string; base64: string } | null; error?: string }) => {
      if (!current) return
      if (result.error) setError(result.error)
      else if (result.data) setSrc(`data:${result.data.mime};base64,${result.data.base64}`)
    }).catch((err: unknown) => { if (current) setError(String(err)) })
    return () => { current = false }
  }, [image, bodyId])

  if (image) {
    return (
      <div data-testid="preview-image" className="flex h-full items-center justify-center overflow-auto bg-th-surface p-4">
        {src ? <img src={src} alt="Response preview" className="max-h-full max-w-full object-contain" /> : (
          <span className="text-sm text-th-text-subtle">{error ?? (bodyId ? 'Loading preview…' : 'This image is too large to preview.')}</span>
        )}
      </div>
    )
  }

  if (binary) {
    return (
      <div data-testid="preview-unavailable" className="flex h-full items-center justify-center p-4 text-sm text-th-text-subtle">
        No preview for this content type. Use Save to write it to a file.
      </div>
    )
  }

  return (
    <iframe
      srcDoc={body}
      sandbox="allow-same-origin"
      className="h-full w-full border-0 bg-white"
      title="response preview"
    />
  )
}
