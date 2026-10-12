import React, { useEffect, useState } from 'react'
import type { NetworkSettings } from '@/types'
import { cn } from '@/lib/utils'
import { DEFAULT_MAX_REDIRECTS, MAX_REDIRECT_LIMIT, MAX_TIMEOUT_MS, normalizeNetworkSettings } from '@/lib/networkSettings'

interface NetworkEditorProps {
  value: NetworkSettings | undefined
  onChange: (value: NetworkSettings | undefined) => void
  /** Where an unset value comes from, e.g. "the global setting". */
  inheritsFrom?: string
}

type Choice = 'inherit' | 'custom'

function Segmented<T extends string>({ options, value, onChange, testId }: {
  options: { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
  testId: string
}) {
  return (
    <div className="flex gap-1" data-testid={testId}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          data-testid={`${testId}-${opt.value}`}
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'rounded-sm px-3 py-1.5 text-xs transition-colors focus:outline-hidden',
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

function NumberField({ value, min, max, unit, testId, onCommit }: {
  value: number
  min: number
  max: number
  unit: string
  testId: string
  onCommit: (value: number) => void
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => { setText(String(value)) }, [value])
  const parsed = Number(text)
  const valid = text.trim() !== '' && Number.isInteger(parsed) && parsed >= min && parsed <= max

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        inputMode="numeric"
        data-testid={testId}
        aria-invalid={!valid}
        className={cn(
          'w-28 rounded-md border bg-th-surface px-2.5 py-1.5 text-xs text-th-text-secondary focus:outline-hidden',
          valid ? 'border-th-border focus:border-th-border-strong' : 'border-red-500/60'
        )}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          const n = Number(e.target.value)
          if (e.target.value.trim() !== '' && Number.isInteger(n) && n >= min && n <= max) onCommit(n)
        }}
        onBlur={() => { if (!valid) setText(String(value)) }}
      />
      <span className="text-xs text-th-text-faint">{unit}</span>
      {!valid && <span className="text-xs text-red-400">Enter a whole number from {min} to {max}</span>}
    </div>
  )
}

export function NetworkEditor({ value, onChange, inheritsFrom = 'the parent or the global setting' }: NetworkEditorProps) {
  const current = normalizeNetworkSettings(value) ?? {}
  const update = (patch: NetworkSettings) => {
    const next: NetworkSettings = { ...current, ...patch }
    for (const key of Object.keys(next) as (keyof NetworkSettings)[]) if (next[key] === undefined) delete next[key]
    onChange(normalizeNetworkSettings(next))
  }

  const timeoutChoice: Choice = current.timeout !== undefined ? 'custom' : 'inherit'
  const redirectChoice = current.followRedirects === undefined ? 'inherit' : current.followRedirects ? 'on' : 'off'
  const limitChoice: Choice = current.maxRedirects !== undefined ? 'custom' : 'inherit'

  return (
    <div className="flex flex-col gap-5" data-testid="network-editor">
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-th-text-secondary">Timeout</p>
        <Segmented<Choice>
          testId="timeout-mode"
          value={timeoutChoice}
          options={[{ value: 'inherit', label: 'Inherit' }, { value: 'custom', label: 'Custom' }]}
          onChange={(c) => update({ timeout: c === 'custom' ? 30_000 : undefined })}
        />
        {timeoutChoice === 'custom' ? (
          <NumberField testId="timeout-value" value={current.timeout ?? 30_000} min={1} max={MAX_TIMEOUT_MS} unit="ms" onCommit={(n) => update({ timeout: n })} />
        ) : (
          <p className="text-xs text-th-text-faint">Inherited from {inheritsFrom}.</p>
        )}
        <p className="text-xs text-th-text-faint">How long to wait without any response data. A failed connection is reported as a connect timeout.</p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-th-text-secondary">Follow redirects</p>
        <Segmented<'inherit' | 'on' | 'off'>
          testId="redirects-mode"
          value={redirectChoice}
          options={[{ value: 'inherit', label: 'Inherit' }, { value: 'on', label: 'On' }, { value: 'off', label: 'Off' }]}
          onChange={(c) => update({ followRedirects: c === 'inherit' ? undefined : c === 'on' })}
        />
        {redirectChoice === 'inherit' && <p className="text-xs text-th-text-faint">Inherited from {inheritsFrom}.</p>}
      </div>

      {redirectChoice !== 'off' && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-th-text-secondary">Max redirects</p>
          <Segmented<Choice>
            testId="max-redirects-mode"
            value={limitChoice}
            options={[{ value: 'inherit', label: 'Inherit' }, { value: 'custom', label: 'Custom' }]}
            onChange={(c) => update({ maxRedirects: c === 'custom' ? DEFAULT_MAX_REDIRECTS : undefined })}
          />
          {limitChoice === 'custom' ? (
            <NumberField testId="max-redirects-value" value={current.maxRedirects ?? DEFAULT_MAX_REDIRECTS} min={0} max={MAX_REDIRECT_LIMIT} unit="redirects" onCommit={(n) => update({ maxRedirects: n })} />
          ) : (
            <p className="text-xs text-th-text-faint">Inherited from {inheritsFrom}, otherwise {DEFAULT_MAX_REDIRECTS}.</p>
          )}
        </div>
      )}
    </div>
  )
}
