import React from 'react'

interface RawTabProps {
  body: string
}

export function RawTab({ body }: RawTabProps) {
  return (
    <pre className="h-full overflow-auto whitespace-pre-wrap break-all p-4 font-mono text-xs text-neutral-300">
      {body}
    </pre>
  )
}
