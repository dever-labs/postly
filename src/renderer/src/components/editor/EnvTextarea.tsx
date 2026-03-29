import React, { useRef } from 'react'
import { cn } from '@/lib/utils'
import { useEnvAutocomplete } from '@/hooks/useEnvAutocomplete'
import { EnvSuggestions } from './EnvSuggestions'

interface EnvTextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'> {
  value: string
  onChange: (value: string) => void
  wrapperClassName?: string
}

/** Drop-in replacement for <textarea> that adds {{ env var autocomplete. */
export function EnvTextarea({ value, onChange, onKeyDown, wrapperClassName, className, ...props }: EnvTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const ac = useEnvAutocomplete()

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    onChange(val)
    ac.detect(val, e.target.selectionStart ?? val.length)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (ac.show) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        ac.setSelectedIndex(Math.min(ac.selectedIndex + 1, ac.filtered.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        ac.setSelectedIndex(Math.max(ac.selectedIndex - 1, 0))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const v = ac.filtered[ac.selectedIndex]
        if (v) {
          e.preventDefault()
          doComplete(v.key)
          return
        }
      }
      if (e.key === 'Escape') { ac.close(); return }
    }
    onKeyDown?.(e)
  }

  const doComplete = (key: string) => {
    const cursor = ref.current?.selectionStart ?? value.length
    const { newValue, newCursorPos } = ac.complete(value, cursor, key)
    onChange(newValue)
    requestAnimationFrame(() => {
      ref.current?.focus()
      ref.current?.setSelectionRange(newCursorPos, newCursorPos)
    })
  }

  return (
    <div className={cn('relative', wrapperClassName)}>
      <textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => ac.close(), 150)}
        className={className}
        {...props}
      />
      {ac.show && (
        <EnvSuggestions
          filtered={ac.filtered}
          selectedIndex={ac.selectedIndex}
          onSelect={doComplete}
          onHover={ac.setSelectedIndex}
        />
      )}
    </div>
  )
}
