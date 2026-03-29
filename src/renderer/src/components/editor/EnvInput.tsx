import React, { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useEnvAutocomplete } from '@/hooks/useEnvAutocomplete'
import { useEnvironmentsStore } from '@/store/environments'
import { EnvSuggestions } from './EnvSuggestions'
import { VarTooltip } from './VarTooltip'
import type { EnvVar } from '@/types'

// ─── Text measurement ────────────────────────────────────────────────────────

const _canvas = document.createElement('canvas')
function measureWidth(text: string, font: string): number {
  const ctx = _canvas.getContext('2d')
  if (!ctx) return 0
  ctx.font = font
  return ctx.measureText(text).width
}

// ─── Token parsing ───────────────────────────────────────────────────────────

interface VarToken { key: string; start: number; end: number }

function parseTokens(value: string): VarToken[] {
  return [...value.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => ({
    key: m[1].trim(),
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }))
}

// ─── Token highlight (pixel positions) ──────────────────────────────────────

interface TokenHighlight extends VarToken {
  left: number
  width: number
  isDefined: boolean
}

function computeHighlights(
  value: string,
  input: HTMLInputElement,
  activeVars: EnvVar[],
): TokenHighlight[] {
  const style = getComputedStyle(input)
  const font = style.font
  const paddingLeft = parseFloat(style.paddingLeft)
  const scrollLeft = input.scrollLeft

  return parseTokens(value).map((tok) => {
    const left = measureWidth(value.slice(0, tok.start), font) + paddingLeft - scrollLeft
    const width = measureWidth(value.slice(tok.start, tok.end), font)
    const isDefined = activeVars.some((v) => v.key === tok.key)
    return { ...tok, left, width, isDefined }
  })
}

// ─── Component ───────────────────────────────────────────────────────────────

interface EnvInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string
  onChange: (value: string) => void
  wrapperClassName?: string
}

/** Drop-in replacement for <input> that adds {{ env var autocomplete and per-token highlighting. */
export function EnvInput({ value, onChange, onKeyDown, wrapperClassName, className, ...props }: EnvInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const ac = useEnvAutocomplete()
  const activeEnv = useEnvironmentsStore((s) => s.activeEnv)
  const vars = useEnvironmentsStore((s) => s.vars)

  const [highlights, setHighlights] = useState<TokenHighlight[]>([])
  const [hovered, setHovered] = useState<{ key: string; left: number } | null>(null)

  const activeVars = vars.filter((v) => v.envId === activeEnv?.id)
  const hasVars = /\{\{[^}]+\}\}/.test(value)

  const recalc = useCallback(() => {
    if (inputRef.current && hasVars) {
      setHighlights(computeHighlights(value, inputRef.current, activeVars))
    } else {
      setHighlights([])
    }
  }, [value, activeVars, hasVars])

  // Recalculate whenever value or active vars change
  useEffect(() => { recalc() }, [recalc])

  // ─── Input handlers ────────────────────────────────────────────────────────

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    onChange(val)
    ac.detect(val, e.target.selectionStart ?? val.length)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (ac.show) {
      if (e.key === 'ArrowDown') { e.preventDefault(); ac.setSelectedIndex(Math.min(ac.selectedIndex + 1, ac.filtered.length - 1)); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); ac.setSelectedIndex(Math.max(ac.selectedIndex - 1, 0)); return }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const v = ac.filtered[ac.selectedIndex]
        if (v) { e.preventDefault(); doComplete(v.key); return }
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

  // ─── Hover detection via mousemove on the input ────────────────────────────
  // We use onMouseMove on the input (not overlay divs) so click/focus still work.

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLInputElement>) => {
    if (!hasVars || highlights.length === 0 || !wrapperRef.current) { setHovered(null); return }
    const wrapperLeft = wrapperRef.current.getBoundingClientRect().left
    const relX = e.clientX - wrapperLeft
    const hit = highlights.find((h) => relX >= h.left && relX < h.left + h.width) ?? null
    setHovered(hit ? { key: hit.key, left: hit.left } : null)
  }, [hasVars, highlights])

  const handleMouseLeave = () => setHovered(null)

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div ref={wrapperRef} className={cn('relative', wrapperClassName)} onMouseLeave={handleMouseLeave}>
      <input
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => { setTimeout(() => ac.close(), 150); setHovered(null) }}
        onScroll={recalc}
        onMouseMove={handleMouseMove}
        className={className}
        {...props}
      />

      {/* Per-token underlines (pointer-events: none so they don't steal clicks) */}
      {highlights.map((h) => (
        <div
          key={`${h.key}-${h.start}`}
          aria-hidden
          className={cn(
            'pointer-events-none absolute bottom-[3px] h-[2px] rounded-full transition-colors',
            h.isDefined ? 'bg-amber-400/70' : 'bg-red-500/80',
          )}
          style={{ left: h.left, width: h.width }}
        />
      ))}

      {/* Autocomplete suggestions */}
      {ac.show && (
        <EnvSuggestions
          filtered={ac.filtered}
          selectedIndex={ac.selectedIndex}
          onSelect={doComplete}
          onHover={ac.setSelectedIndex}
        />
      )}

      {/* Per-token hover tooltip */}
      {hovered && !ac.show && (
        <VarTooltip varKey={hovered.key} x={hovered.left} />
      )}
    </div>
  )
}
