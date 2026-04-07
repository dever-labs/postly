import React from 'react'

interface PreviewTabProps {
  body: string
}

export function PreviewTab({ body }: PreviewTabProps) {
  return (
    <iframe
      srcDoc={body}
      sandbox="allow-same-origin"
      className="h-full w-full border-0 bg-white"
      title="response preview"
    />
  )
}
