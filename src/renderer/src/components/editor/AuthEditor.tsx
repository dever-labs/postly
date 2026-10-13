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
  { value: 'apikey',  label: 'API Key' },
  { value: 'digest',  label: 'Digest' },
  { value: 'awsv4',   label: 'AWS Signature' },
]

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs text-th-text-subtle">{label}</label>
      {children}
    </div>
  )
}

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
          <label htmlFor="auth-token" className="mb-1 block text-xs text-th-text-subtle">Token</label>
          <Input id="auth-token"
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
            <label htmlFor="auth-username" className="mb-1 block text-xs text-th-text-subtle">Username</label>
            <Input id="auth-username"
              placeholder="Username"
              value={authConfig.username ?? ''}
              onChange={(e) => set('username', e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="auth-password" className="mb-1 block text-xs text-th-text-subtle">Password</label>
            <Input id="auth-password"
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
            <label htmlFor="auth-token" className="mb-1 block text-xs text-th-text-subtle">Token</label>
            <Input id="auth-token"
              type="password"
              placeholder="JWT token…"
              value={authConfig.token ?? ''}
              onChange={(e) => set('token', e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="auth-prefix" className="mb-1 block text-xs text-th-text-subtle">Prefix</label>
            <Input id="auth-prefix"
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
            <label htmlFor="auth-username" className="mb-1 block text-xs text-th-text-subtle">Username</label>
            <Input id="auth-username"
              placeholder="Username"
              value={authConfig.username ?? ''}
              onChange={(e) => set('username', e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="auth-password" className="mb-1 block text-xs text-th-text-subtle">Password</label>
            <Input id="auth-password"
              type="password"
              placeholder="Password"
              value={authConfig.password ?? ''}
              onChange={(e) => set('password', e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="auth-domain" className="mb-1 block text-xs text-th-text-subtle">Domain</label>
            <Input id="auth-domain"
              placeholder="DOMAIN (optional)"
              value={authConfig.domain ?? ''}
              onChange={(e) => set('domain', e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="auth-workstation" className="mb-1 block text-xs text-th-text-subtle">Workstation</label>
            <Input id="auth-workstation"
              placeholder="Workstation (optional)"
              value={authConfig.workstation ?? ''}
              onChange={(e) => set('workstation', e.target.value)}
            />
          </div>
        </div>
      )}

      {authType === 'apikey' && (
        <div className="flex flex-col gap-2" data-testid="auth-apikey">
          <Field label="Key">
            <Input placeholder="X-API-Key" value={authConfig.key ?? ''} onChange={(e) => set('key', e.target.value)} />
          </Field>
          <Field label="Value">
            <Input type="password" placeholder="Value (supports {{ENV_VAR}})" value={authConfig.value ?? ''} onChange={(e) => set('value', e.target.value)} />
          </Field>
          <Field label="Add to">
            <div className="flex gap-1">
              {([['header', 'Header'], ['query', 'Query parameter']] as const).map(([value, label]) => (
                <button
                  key={value}
                  data-testid={`auth-apikey-${value}`}
                  onClick={() => set('in', value)}
                  className={cn(
                    'rounded-sm px-3 py-1.5 text-xs focus:outline-hidden',
                    (authConfig.in ?? 'header') === value ? 'bg-th-surface-hover text-th-text-primary' : 'text-th-text-subtle hover:bg-th-surface-raised'
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>
        </div>
      )}

      {authType === 'digest' && (
        <div className="flex flex-col gap-2" data-testid="auth-digest">
          <Field label="Username">
            <Input placeholder="Username" value={authConfig.username ?? ''} onChange={(e) => set('username', e.target.value)} />
          </Field>
          <Field label="Password">
            <Input type="password" placeholder="Password" value={authConfig.password ?? ''} onChange={(e) => set('password', e.target.value)} />
          </Field>
          <p className="text-xs text-th-text-faint">The request is sent first without credentials; if the server answers 401 with a Digest challenge it is sent again with the answer.</p>
        </div>
      )}

      {authType === 'awsv4' && (
        <div className="flex flex-col gap-2" data-testid="auth-awsv4">
          <Field label="Access key">
            <Input placeholder="AKIA…" value={authConfig.accessKey ?? ''} onChange={(e) => set('accessKey', e.target.value)} />
          </Field>
          <Field label="Secret key">
            <Input type="password" placeholder="Secret access key" value={authConfig.secretKey ?? ''} onChange={(e) => set('secretKey', e.target.value)} />
          </Field>
          <Field label="Session token (optional)">
            <Input type="password" placeholder="Session token" value={authConfig.sessionToken ?? ''} onChange={(e) => set('sessionToken', e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <div className="flex-1"><Field label="Region">
              <Input placeholder="us-east-1" value={authConfig.region ?? ''} onChange={(e) => set('region', e.target.value)} />
            </Field></div>
            <div className="flex-1"><Field label="Service">
              <Input placeholder="execute-api" value={authConfig.service ?? ''} onChange={(e) => set('service', e.target.value)} />
            </Field></div>
          </div>
          <p className="text-xs text-th-text-faint">The final request, including query and body, is signed when it is sent.</p>
        </div>
      )}
    </div>
  )
}
