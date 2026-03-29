import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useEnvAutocomplete } from '@/hooks/useEnvAutocomplete'
import { useEnvironmentsStore } from '@/store/environments'
import { EnvSuggestions } from './EnvSuggestions'
import { VarTooltip } from './VarTooltip'
import type { EnvVar } from '@/types'

// ─── Token parsing ───────────────────────────────────────────────────────────

interface VarToken { key: string; start: number; end: number }

function parseTokens(value: string): VarToken[] {
  return [...value.matchAll(/\{\{([^}]+)\}\}/g)].map((m) => ({
    key: m[1].trim(),
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }))
}

type Segment =
  | { type: 'text'; text: string }
  | { type: 'var'; key: string; raw: string; isDefined: boolean }

function parseSegments(value: string, activeVars: EnvVar[]): Segment[] {
  const segs: Segment[] = []
  let last = 0
  for (const tok of parseTokens(value)) {
    if (tok.start > last) segs.push({ type: 'text', text: value.slice(last, tok.start) })
    segs.push({
      type: 'var',
      key: tok.key,
      raw: value.slice(tok.start, tok.end),
      isDefined: activeVars.some((v) => v.key === tok.key),
    })
    last = tok.end
  }
  if (last < value.length) segs.push({ type: 'text', text: value.slice(last) })
  return segs
}

// ─── Text measurement (for hover detection) ──────────────────────────────────

const _canvas = document.createElement('canvas')
function measureWidth(text: string, font: string): number {
  const ctx = _canvas.getContext('2d')
  if (!ctx) return 0
  ctx.font = font
  return ctx.measureText(text).width
}

interface TokenHitZone extends VarToken { left: number; width: number }

function computeHitZones(value: string, input: HTMLInputElement): TokenHitZone[] {
  const style = getComputedStyle(input)
  const font = style.font
  const paddingLeft = parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth)
  const scrollLeft = input.scrollLeft
  return parseTokens(value).map((tok) => ({
    ...tok,
    left: measureWidth(value.slice(0, tok.start), font) + paddingLeft - scrollLeft,
    width: measureWidth(value.slice(tok.start, tok.end), font),
  }))
}

// ─── Overlay style sync ───────────────────────────────────────────────────────

function buildOverlayStyle(input: HTMLInputElement, scrollLeft: number, color: string): React.CSSProperties {
  const s = getComputedStyle(input)
  return {
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    fontWeight: s.fontWeight,
    letterSpacing: s.letterSpacing,
    lineHeight: s.lineHeight,
    color,                           // use the pre-captured color, not s.color (which is now transparent)
    paddingLeft: `calc(${s.paddingLeft} + ${s.borderLeftWidth})`,
    paddingRight: `calc(${s.paddingRight} + ${s.borderRightWidth})`,
    paddingTop: `calc(${s.paddingTop} + ${s.borderTopWidth})`,
    paddingBottom: `calc(${s.paddingBottom} + ${s.borderBottomWidth})`,
    transform: `translateX(-${scrollLeft}px)`,
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

interface EnvInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  value: string
  onChange: (value: string) => void
  wrapperClassName?: string
}

/** Drop-in <input> replacement with {{ env var autocomplete and per-token highlighting. */
export function EnvInput({ value, onChange, onKeyDown, wrapperClassName, className, ...props }: EnvInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const colorProbeRef = useRef<HTMLSpanElement>(null)
  const ac = useEnvAutocomplete()
  const activeEnv = useEnvironmentsStore((s) => s.activeEnv)
  const vars = useEnvironmentsStore((s) => s.vars)

  const [hitZones, setHitZones] = useState<TokenHitZone[]>([])
  const [hovered, setHovered] = useState<{ key: string; left: number } | null>(null)

  const activeVars = vars.filter((v) => v.envId === activeEnv?.id)
  const hasVars = /\{\{[^}]+\}\}/.test(value)
  const segments = hasVars ? parseSegments(value, activeVars) : null

  // Directly mutate overlay DOM styles — avoids triggering a React state
  // update inside useLayoutEffect which causes an infinite re-render cycle.
  const applyOverlayStyle = useCallback((scrollLeft = 0) => {
    if (!overlayRef.current || !inputRef.current) return
    const color = colorProbeRef.current
      ? getComputedStyle(colorProbeRef.current).color
      : ''
    const s = buildOverlayStyle(inputRef.current, scrollLeft, color)
    Object.assign(overlayRef.current.style, s)
  }, [])

  useLayoutEffect(() => {
    if (hasVars) applyOverlayStyle(inputRef.current?.scrollLeft ?? 0)
  }, [hasVars, value, applyOverlayStyle])

  // Recompute hover hit zones whenever value changes
  const recalcHitZones = useCallback(() => {
    if (inputRef.current && hasVars) {
      setHitZones(computeHitZones(value, inputRef.current))
    } else {
      setHitZones([])
    }
  }, [value, hasVars])

  useEffect(() => { recalcHitZones() }, [recalcHitZones])

  const syncScroll = () => {
    if (!inputRef.current) return
    const sl = inputRef.current.scrollLeft
    if (overlayRef.current) overlayRef.current.style.transform = `translateX(-${sl}px)`
    recalcHitZones()
  }
  // ─── Input handlers ─────────────────────────────────────────────────────────

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

  // ─── Hover detection ─────────────────────────────────────────────────────────

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLInputElement>) => {
    if (!hasVars || hitZones.length === 0 || !wrapperRef.current) { setHovered(null); return }
    const relX = e.clientX - wrapperRef.current.getBoundingClientRect().left
    const hit = hitZones.find((h) => relX >= h.left && relX < h.left + h.width) ?? null
    setHovered(hit ? { key: hit.key, left: hit.left } : null)
  }, [hasVars, hitZones])

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div ref={wrapperRef} className={cn('relative', wrapperClassName)} onMouseLeave={() => setHovered(null)}>
      {/* Hidden probe — same className as input, never gets color:transparent.
          Used to reliably read the real text color for the overlay. */}
      <span
        ref={colorProbeRef}
        aria-hidden
        className={className}
        style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none', width: 0, height: 0, overflow: 'hidden', padding: 0, border: 0 }}
      />
      {/* Highlight overlay — mirrors the input text with styled token spans */}
      {segments && (
        <div
          ref={overlayRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre select-none"
        >
          {segments.map((seg, i) =>
            seg.type === 'text' ? (
              <span key={i}>{seg.text}</span>
            ) : (
              <span
                key={i}
                className={cn(
                  'rounded-sm',
                  seg.isDefined
                    ? 'bg-amber-400/20 text-amber-300'
                    : 'bg-red-500/20 text-red-400',
                )}
              >
                {seg.raw}
              </span>
            )
          )}
        </div>
      )}

      <input
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => { setTimeout(() => ac.close(), 150); setHovered(null) }}
        onScroll={syncScroll}
        onMouseMove={handleMouseMove}
        className={className}
        // Make input text transparent so the overlay shows through; keep caret visible
        style={hasVars ? { color: 'transparent', caretColor: 'var(--color-th-text-primary)' } : undefined}
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

      {hovered && !ac.show && (
        <VarTooltip varKey={hovered.key} x={hovered.left} />
      )}
    </div>
  )
}
