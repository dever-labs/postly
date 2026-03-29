import React, { useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useEnvAutocomplete } from '@/hooks/useEnvAutocomplete'
import { EnvSuggestions } from './EnvSuggestions'
import { VarTooltip } from './VarTooltip'

interface EnvInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string
  onChange: (value: string) => void
  wrapperClassName?: string
}

/** Drop-in replacement for <input> that adds {{ env var autocomplete. */
export function EnvInput({ value, onChange, onKeyDown, wrapperClassName, className, ...props }: EnvInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const ac = useEnvAutocomplete()
  const [showVarTooltip, setShowVarTooltip] = useState(false)
  const hasVars = /\{\{[^}]+\}\}/.test(value)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    onChange(val)
    ac.detect(val, e.target.selectionStart ?? val.length)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
    const cursor = inputRef.current?.selectionStart ?? value.length
    const { newValue, newCursorPos } = ac.complete(value, cursor, key)
    onChange(newValue)
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(newCursorPos, newCursorPos)
    })
  }

  return (
    <div
      className={cn('relative', wrapperClassName)}
      onMouseEnter={() => hasVars && setShowVarTooltip(true)}
      onMouseLeave={() => setShowVarTooltip(false)}
    >
      <input
        ref={inputRef}
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
      {showVarTooltip && !ac.show && (
        <VarTooltip value={value} />
      )}
    </div>
  )
}
