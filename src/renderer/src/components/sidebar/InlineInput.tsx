import React, { useRef, useState } from 'react'
import { Check, X } from 'lucide-react'

interface InlineInputProps {
  placeholder: string
  onConfirm: (name: string) => void
  onCancel: () => void
  paddingLeft?: number
}

export function InlineInput({ placeholder, onConfirm, onCancel, paddingLeft = 16 }: InlineInputProps) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  React.useEffect(() => { ref.current?.focus() }, [])

  return (
    <div className="flex items-center gap-1 py-0.5 pr-2" style={{ paddingLeft }}>
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { if (value.trim()) onConfirm(value.trim()); else onCancel() }
          if (e.key === 'Escape') onCancel()
        }}
        placeholder={placeholder}
        className="flex-1 rounded-sm bg-th-surface-raised px-2 py-1 text-sm text-th-text-primary placeholder-th-text-subtle outline-hidden ring-1 ring-blue-500/50"
      />
      <button onClick={() => { if (value.trim()) onConfirm(value.trim()); else onCancel() }} className="text-green-400 hover:text-green-300"><Check className="h-3.5 w-3.5" /></button>
      <button onClick={onCancel} className="text-th-text-subtle hover:text-th-text-secondary"><X className="h-3.5 w-3.5" /></button>
    </div>
  )
}
