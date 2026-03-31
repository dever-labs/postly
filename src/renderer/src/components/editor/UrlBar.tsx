import React from 'react'
import { EnvInput } from '@/components/editor/EnvInput'

interface UrlBarProps {
  value: string
  onChange: (url: string) => void
  onSend?: () => void
}

export function UrlBar({ value, onChange, onSend }: UrlBarProps) {
  return (
    <EnvInput
      value={value}
      onChange={onChange}
      onKeyDown={(e) => e.key === 'Enter' && onSend?.()}
      placeholder="https://api.example.com/endpoint"
      data-testid="url-input"
      spellCheck={false}
      wrapperClassName="flex-1"
      className="w-full rounded-sm border border-th-border-strong bg-th-surface px-3 py-1.5 text-sm text-th-text-primary focus:border-th-border-strong focus:outline-hidden focus:ring-1 focus:ring-th-border-strong placeholder:text-th-text-subtle"
    />
  )
}
