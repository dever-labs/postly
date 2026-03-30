import React from 'react'
import type { AuthType } from '@/types'
import { cn } from '@/lib/utils'

interface Props {
  authType: AuthType
  authConfig: Record<string, string>
  onChange: (authType: AuthType, authConfig: Record<string, string>) => void
  /** Label of the nearest ancestor that has auth configured, e.g. "My Collection" */
  inheritedFrom?: string
  /** Whether to show the Inherit option — false at root/integration level */
  canInherit?: boolean
}

const BASE_TYPES: { value: AuthType; label: string }[] = [
  { value: 'bearer', label: 'Bearer' },
  { value: 'oauth2', label: 'OAuth 2.0' },
  { value: 'none',   label: 'None' },
]

export function AuthConfigEditor({ authType, authConfig, onChange, inheritedFrom, canInherit = true }: Props) {
  const types = canInherit
    ? [{ value: 'inherit' as AuthType, label: 'Inherit' }, ...BASE_TYPES]
    : BASE_TYPES

  return (
    <div className="flex flex-col gap-3">
      {/* Type selector */}
      <div className="flex gap-1">
        {types.map((t) => (
          <button
            key={t.value}
            onClick={() => onChange(t.value, authConfig)}
            className={cn(
              'rounded-sm px-3 py-1.5 text-xs transition-colors focus:outline-hidden',
              authType === t.value
                ? 'bg-th-surface-hover text-th-text-primary'
                : 'text-th-text-subtle hover:bg-th-surface-raised hover:text-th-text-secondary'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {authType === 'inherit' && (
        <p className="text-xs italic text-th-text-subtle">
          {inheritedFrom
            ? <>Auth inherited from <span className="text-th-text-muted">{inheritedFrom}</span></>
            : 'No auth configured on any parent — will send unauthenticated.'}
        </p>
      )}

      {authType === 'none' && (
        <p className="text-xs italic text-th-text-faint">No authentication.</p>
      )}

      {authType === 'bearer' && (
        <div>
          <label className="mb-1 block text-xs text-th-text-subtle">Token</label>
          <input
            type="text"
            placeholder="Bearer token… (supports {{ENV_VAR}})"
            value={authConfig.token ?? ''}
            onChange={(e) => onChange(authType, { ...authConfig, token: e.target.value })}
            className="w-full rounded-sm border border-th-border bg-th-surface px-3 py-2 text-sm text-th-text-primary placeholder-th-text-faint focus:border-th-border-strong focus:outline-hidden"
          />
        </div>
      )}

      {authType === 'oauth2' && (
        <p className="text-xs text-th-text-subtle">
          OAuth 2.0 — configure via the <span className="text-th-text-muted">OAuth Configs</span> panel in request auth settings.
        </p>
      )}
    </div>
  )
}
