import React from 'react'
import type { AuthType } from '@/types'
import { Input } from '@/components/ui/Input'
import { OAuthPanel } from './OAuthPanel'
import { cn } from '@/lib/utils'

interface AuthEditorProps {
  authType: AuthType
  authConfig: Record<string, string>
  onChange: (authType: AuthType, authConfig: Record<string, string>) => void
  /** Whether to show the Inherit option — false at collection (root) level */
  canInherit?: boolean
  /** Label of the nearest ancestor that has auth configured */
  inheritedFrom?: string
}

const ALL_TYPES: { value: AuthType; label: string }[] = [
  { value: 'none',    label: 'None' },
  { value: 'bearer',  label: 'Bearer Token' },
  { value: 'basic',   label: 'Basic Auth' },
  { value: 'jwt',     label: 'JWT Bearer' },
  { value: 'oauth2',  label: 'OAuth 2.0' },
  { value: 'ntlm',    label: 'NTLM' },
]

export function AuthEditor({ authType, authConfig, onChange, canInherit = true, inheritedFrom }: AuthEditorProps) {
  const types = canInherit
    ? [{ value: 'inherit' as AuthType, label: 'Inherit' }, ...ALL_TYPES]
    : ALL_TYPES

  const set = (field: string, value: string) => onChange(authType, { ...authConfig, [field]: value })

  return (
    <div className="flex flex-col gap-3">
      {/* Type selector */}
      <div className="flex flex-wrap gap-1">
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
            ? <>Inheriting auth from <span className="text-th-text-muted">{inheritedFrom}</span></>
            : 'No auth configured on any parent — will send unauthenticated.'}
        </p>
      )}

      {authType === 'none' && (
        <p className="text-xs italic text-th-text-faint">No authentication will be sent.</p>
      )}

      {authType === 'bearer' && (
        <div>
          <label className="mb-1 block text-xs text-th-text-subtle">Token</label>
          <Input
            type="password"
            placeholder="Bearer token… (supports {{ENV_VAR}})"
            value={authConfig.token ?? ''}
            onChange={(e) => set('token', e.target.value)}
          />
        </div>
      )}

      {authType === 'basic' && (
        <div className="flex flex-col gap-2">
          <div>
            <label className="mb-1 block text-xs text-th-text-subtle">Username</label>
            <Input
              placeholder="Username"
              value={authConfig.username ?? ''}
              onChange={(e) => set('username', e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-th-text-subtle">Password</label>
            <Input
              type="password"
              placeholder="Password"
              value={authConfig.password ?? ''}
              onChange={(e) => set('password', e.target.value)}
            />
          </div>
        </div>
      )}

      {authType === 'jwt' && (
        <div className="flex flex-col gap-2">
          <div>
            <label className="mb-1 block text-xs text-th-text-subtle">Token</label>
            <Input
              type="password"
              placeholder="JWT token…"
              value={authConfig.token ?? ''}
              onChange={(e) => set('token', e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-th-text-subtle">Prefix</label>
            <Input
              placeholder="Bearer"
              value={authConfig.prefix ?? ''}
              onChange={(e) => set('prefix', e.target.value)}
            />
          </div>
          <p className="text-xs text-th-text-faint">Sent as <code className="text-th-text-subtle">{`Authorization: ${authConfig.prefix || 'Bearer'} <token>`}</code></p>
        </div>
      )}

      {authType === 'oauth2' && (
        <OAuthPanel
          authConfig={authConfig}
          onConfigChange={(c) => onChange('oauth2', c)}
        />
      )}

      {authType === 'ntlm' && (
        <div className="flex flex-col gap-2">
          <div>
            <label className="mb-1 block text-xs text-th-text-subtle">Username</label>
            <Input
              placeholder="Username"
              value={authConfig.username ?? ''}
              onChange={(e) => set('username', e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-th-text-subtle">Password</label>
            <Input
              type="password"
              placeholder="Password"
              value={authConfig.password ?? ''}
              onChange={(e) => set('password', e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-th-text-subtle">Domain</label>
            <Input
              placeholder="DOMAIN (optional)"
              value={authConfig.domain ?? ''}
              onChange={(e) => set('domain', e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-th-text-subtle">Workstation</label>
            <Input
              placeholder="Workstation (optional)"
              value={authConfig.workstation ?? ''}
              onChange={(e) => set('workstation', e.target.value)}
            />
          </div>
        </div>
      )}
    </div>
  )
}
