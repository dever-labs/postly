import React, { useEffect, useId, useState } from 'react'
import type { NetworkSettings } from '@/types'
import { cn } from '@/lib/utils'
import {
  DEFAULT_MAX_REDIRECTS, MAX_REDIRECT_LIMIT, MAX_TIMEOUT_MS,
  formatDuration, msToSeconds, normalizeNetworkSettings, secondsToMs, type InheritedNetwork,
} from '@/lib/networkSettings'

interface NetworkEditorProps {
  value: NetworkSettings | undefined
  onChange: (value: NetworkSettings | undefined) => void
  /** What each setting resolves to when left on Inherit, and where that comes from. */
  inherited: InheritedNetwork
  /** 'inline' lets the controls join a surrounding grid instead of forming their own. */
  layout?: 'grid' | 'inline'
}

type Choice = 'inherit' | 'custom'

function Segmented<T extends string>({ options, value, onChange, testId, label }: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  testId: string
  label: string
}) {
  return (
    <div className="flex gap-1" role="group" aria-label={label} data-testid={testId}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          data-testid={`${testId}-${opt.value}`}
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'rounded-sm px-3 py-1.5 text-xs transition-colors focus:outline-hidden focus-visible:ring-1 focus-visible:ring-blue-500',
            value === opt.value
              ? 'bg-th-surface-hover text-th-text-primary'
              : 'text-th-text-subtle hover:bg-th-surface-raised hover:text-th-text-secondary'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function NumberField({ text, setText, valid, error, label, unit, testId }: {
  text: string
  setText: (text: string) => void
  valid: boolean
  error: string
  label: string
  unit: string
  testId: string
}) {
  const errorId = useId()
  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        inputMode="decimal"
        data-testid={testId}
        aria-label={label}
        aria-invalid={!valid}
        aria-describedby={valid ? undefined : errorId}
        className={cn(
          'w-28 rounded-md border bg-th-surface px-2.5 py-1.5 text-xs text-th-text-secondary focus:outline-hidden',
          valid ? 'border-th-border focus:border-th-border-strong' : 'border-red-500/60'
        )}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <span className="text-xs text-th-text-faint">{unit}</span>
      {!valid && <span id={errorId} role="alert" className="text-xs text-red-400">{error}</span>}
    </div>
  )
}

function TimeoutField({ ms, onCommit }: { ms: number; onCommit: (ms: number) => void }) {
  const [text, setText] = useState(msToSeconds(ms))
  useEffect(() => { setText((t) => (secondsToMs(t) === ms ? t : msToSeconds(ms))) }, [ms])
  const parsed = secondsToMs(text)
  return (
    <NumberField
      testId="timeout-value"
      label="Timeout in seconds"
      unit="seconds"
      text={text}
      valid={parsed !== null}
      error={`Enter 0.001 to ${MAX_TIMEOUT_MS / 1000} seconds`}
      setText={(t) => { setText(t); const n = secondsToMs(t); if (n !== null) onCommit(n) }}
    />
  )
}

function LimitField({ n, onCommit }: { n: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(n))
  useEffect(() => { setText((t) => (Number(t) === n ? t : String(n))) }, [n])
  const valid = /^\d+$/.test(text) && Number(text) <= MAX_REDIRECT_LIMIT
  return (
    <NumberField
      testId="max-redirects-value"
      label="Maximum number of redirects"
      unit="redirects"
      text={text}
      valid={valid}
      error={`Enter a whole number from 0 to ${MAX_REDIRECT_LIMIT}`}
      setText={(t) => { setText(t); if (/^\d+$/.test(t) && Number(t) <= MAX_REDIRECT_LIMIT) onCommit(Number(t)) }}
    />
  )
}

export const GRID = 'grid grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] items-start gap-x-8 gap-y-5'
const hint = 'text-xs text-th-text-faint'

export function NetworkEditor({ value, onChange, inherited, layout = 'grid' }: NetworkEditorProps) {
  const current = normalizeNetworkSettings(value) ?? {}
  const update = (patch: NetworkSettings) => {
    const next: NetworkSettings = { ...current, ...patch }
    for (const key of Object.keys(next) as (keyof NetworkSettings)[]) if (next[key] === undefined) delete next[key]
    onChange(normalizeNetworkSettings(next))
  }

  const timeoutChoice: Choice = current.timeout !== undefined ? 'custom' : 'inherit'
  const redirectChoice = current.followRedirects === undefined ? 'inherit' : current.followRedirects ? 'on' : 'off'
  const limitChoice: Choice = current.maxRedirects !== undefined ? 'custom' : 'inherit'
  const redirectsOn = current.followRedirects ?? inherited.followRedirects.value

  return (
    <div className={layout === 'inline' ? 'contents' : GRID} data-testid="network-editor">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-th-text-secondary">Timeout</p>
        <Segmented<Choice>
          testId="timeout-mode"
          label="Timeout"
          value={timeoutChoice}
          options={[{ value: 'inherit', label: 'Inherit' }, { value: 'custom', label: 'Custom' }]}
          onChange={(c) => update({ timeout: c === 'custom' ? inherited.timeout.value : undefined })}
        />
        {timeoutChoice === 'custom' ? (
          <TimeoutField ms={current.timeout ?? inherited.timeout.value} onCommit={(n) => update({ timeout: n })} />
        ) : (
          <p className={hint} data-testid="timeout-inherited">Inherited: {formatDuration(inherited.timeout.value)} from {inherited.timeout.source}.</p>
        )}
        <p className={hint}>Longest wait without response data.</p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-th-text-secondary">Follow redirects</p>
        <Segmented<'inherit' | 'on' | 'off'>
          testId="redirects-mode"
          label="Follow redirects"
          value={redirectChoice}
          options={[{ value: 'inherit', label: 'Inherit' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]}
          onChange={(c) => update({ followRedirects: c === 'inherit' ? undefined : c === 'on' })}
        />
        {redirectChoice === 'inherit' && (
          <p className={hint} data-testid="redirects-inherited">Inherited: {inherited.followRedirects.value ? 'on' : 'off'} from {inherited.followRedirects.source}.</p>
        )}
      </div>

      {redirectsOn && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-th-text-secondary">Max redirects</p>
          <Segmented<Choice>
            testId="max-redirects-mode"
            label="Max redirects"
            value={limitChoice}
            options={[{ value: 'inherit', label: 'Inherit' }, { value: 'custom', label: 'Custom' }]}
            onChange={(c) => update({ maxRedirects: c === 'custom' ? inherited.maxRedirects.value : undefined })}
          />
          {limitChoice === 'custom' ? (
            <LimitField n={current.maxRedirects ?? DEFAULT_MAX_REDIRECTS} onCommit={(n) => update({ maxRedirects: n })} />
          ) : (
            <p className={hint} data-testid="max-redirects-inherited">Inherited: {inherited.maxRedirects.value} from {inherited.maxRedirects.source}.</p>
          )}
        </div>
      )}
    </div>
  )
}
