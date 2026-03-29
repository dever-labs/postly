import React from 'react'
import { cn } from '@/lib/utils'
import { EnvInput } from '@/components/editor/EnvInput'

interface UrlBarProps {
  value: string
  onChange: (url: string) => void
  onSend?: () => void
}

export function UrlBar({ value, onChange, onSend }: UrlBarProps) {
  const hasTemplateVars = /\{\{[^}]+\}\}/.test(value)

  return (
    <EnvInput
      value={value}
      onChange={onChange}
      onKeyDown={(e) => e.key === 'Enter' && onSend?.()}
      placeholder="https://api.example.com/endpoint"
      spellCheck={false}
      wrapperClassName="flex-1"
      className={cn(
        'w-full rounded border border-th-border-strong bg-th-surface px-3 py-1.5 text-sm focus:border-th-border-strong focus:outline-none focus:ring-1 focus:ring-th-border-strong',
        hasTemplateVars ? 'text-amber-300' : 'text-th-text-primary',
        'placeholder:text-th-text-subtle'
      )}
    />
  )
}
