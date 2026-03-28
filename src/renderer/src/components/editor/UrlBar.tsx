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
        'flex-1 rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm focus:border-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500',
        hasTemplateVars ? 'text-amber-300' : 'text-neutral-100',
        'placeholder:text-neutral-500'
      )}
    />
  )
}
