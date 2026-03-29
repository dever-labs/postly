import React from 'react'
import { cn } from '@/lib/utils'

interface UrlBarProps {
  value: string
  onChange: (url: string) => void
  onSend: () => void
}

export function UrlBar({ value, onChange, onSend }: UrlBarProps) {
  const hasTemplateVars = /\{\{[^}]+\}\}/.test(value)

  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && onSend()}
      placeholder="https://api.example.com/endpoint"
      spellCheck={false}
      className={cn(
        'flex-1 rounded border border-th-border-strong bg-th-surface px-3 py-1.5 text-sm focus:border-th-border-strong focus:outline-none focus:ring-1 focus:ring-th-border-strong',
        hasTemplateVars ? 'text-amber-300' : 'text-th-text-primary',
        'placeholder:text-th-text-subtle'
      )}
    />
  )
}
