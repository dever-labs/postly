import React, { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { GrantType, Token } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { Check, ClipboardCopy, Eye, EyeOff, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface OAuthPanelProps {
  authConfig: Record<string, string>
  onConfigChange: (c: Record<string, string>) => void
}

interface ExtraParam { id: string; key: string; value: string }

function parseExtraParams(raw: string | undefined): ExtraParam[] {
  if (!raw) return []
  try {
    const obj = JSON.parse(raw) as Record<string, string>
    return Object.entries(obj).map(([key, value]) => ({ id: crypto.randomUUID(), key, value }))
  } catch { return [] }
}

function serializeExtraParams(params: ExtraParam[]): string | undefined {
  const active = params.filter((p) => p.key.trim())
  if (!active.length) return undefined
  return JSON.stringify(Object.fromEntries(active.map((p) => [p.key.trim(), p.value])))
}

function buildInlineConfig(authConfig: Record<string, string>) {
  const extraParamsRaw = authConfig.extraParams
  const extraParams = extraParamsRaw
    ? (() => { try { return JSON.parse(extraParamsRaw) as Record<string, string> } catch { return undefined } })()
    : undefined

  return {
    id: '',
    name: 'inline',
    grantType: authConfig.grantType ?? 'authorization_code',
    clientId: authConfig.clientId ?? '',
    clientSecret: authConfig.clientSecret || undefined,
    authUrl: authConfig.authUrl || undefined,
    tokenUrl: authConfig.tokenUrl ?? '',
    scopes: authConfig.scopes ?? '',
    redirectUri: authConfig.redirectUri ?? '',
    extraParams,
  }
}

function CopyButton({ value, className }: { value: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Copy to clipboard"
      className={cn('shrink-0 opacity-60 transition-opacity hover:opacity-100', className)}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
    </button>
  )
}

function TokenField({ label, value, masked }: { label: string; value: string; masked?: boolean }) {
  const [visible, setVisible] = useState(false)
  const display = masked && !visible ? '••••••••••••••••••••••••' : value
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs opacity-60">{label}</span>
      <div className="flex items-center gap-1.5">
        <code className="flex-1 select-all truncate font-mono text-xs opacity-90">{display}</code>
        {masked && (
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            title={visible ? 'Hide' : 'Reveal'}
            className="shrink-0 opacity-60 hover:opacity-100"
          >
            {visible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        )}
        <CopyButton value={value} />
      </div>
    </div>
  )
}

export function OAuthPanel({ authConfig, onConfigChange }: OAuthPanelProps) {
  const [token, setToken] = useState<Token | null>(null)
  const [authorizing, setAuthorizing] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [extraParams, setExtraParams] = useState<ExtraParam[]>(() => parseExtraParams(authConfig.extraParams))

  // Keep extraParams local state in sync when the active request changes.
  // Use a ref to track the last serialized value so we don't re-parse on every
  // keystroke that goes through authConfig (other fields don't affect extraParams).
  const prevExtraParamsRaw = React.useRef(authConfig.extraParams)
  useEffect(() => {
    if (authConfig.extraParams !== prevExtraParamsRaw.current) {
      prevExtraParamsRaw.current = authConfig.extraParams
      setExtraParams(parseExtraParams(authConfig.extraParams))
    }
  }, [authConfig.extraParams])

  const set = (field: string, value: string) => onConfigChange({ ...authConfig, [field]: value })
  const hasMinConfig = !!(authConfig.clientId && authConfig.tokenUrl)
  const grantType = (authConfig.grantType ?? 'authorization_code') as GrantType

  const updateExtraParams = (params: ExtraParam[]) => {
    setExtraParams(params)
    const serialized = serializeExtraParams(params)
    onConfigChange({ ...authConfig, extraParams: serialized ?? '' })
  }

  const addExtraParam = () => updateExtraParams([...extraParams, { id: crypto.randomUUID(), key: '', value: '' }])
  const updateExtraParam = (id: string, field: 'key' | 'value', value: string) =>
    updateExtraParams(extraParams.map((p) => (p.id === id ? { ...p, [field]: value } : p)))
  const deleteExtraParam = (id: string) => updateExtraParams(extraParams.filter((p) => p.id !== id))

  useEffect(() => {
    setAuthError(null)
    if (!hasMinConfig) { setToken(null); return }
    const config = buildInlineConfig(authConfig)
    window.api.oauth.inline.getToken(config).then(({ data, error }: { data: Token | null; error?: string }) => {
      setToken(data ?? null)
      if (error) setAuthError(error)
    })
  }, [authConfig, hasMinConfig])

  const handleAuthorize = async () => {
    if (!hasMinConfig) return
    if (!authConfig.scopes?.trim()) {
      setAuthError('Scopes are required. Enter at least one scope, e.g. "openid profile".')
      return
    }
    if (grantType === 'authorization_code' && !authConfig.authUrl?.trim()) {
      setAuthError('Auth URL is required for Authorization Code flow.')
      return
    }
    if (grantType === 'authorization_code' && !authConfig.redirectUri?.trim()) {
      setAuthError('Redirect URI is required for Authorization Code flow.')
      return
    }
    setAuthorizing(true)
    setAuthError(null)
    const config = buildInlineConfig(authConfig)
    const { data, error } = await window.api.oauth.inline.authorize(config)
    setAuthorizing(false)
    if (data) setToken(data)
    if (error) setAuthError(String(error))
  }

  const handleClearToken = async () => {
    await window.api.oauth.inline.clearToken(buildInlineConfig(authConfig))
    setToken(null)
    setAuthError(null)
  }

  const isExpired = token?.expiresAt ? token.expiresAt < Date.now() : false

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="mb-1 block text-xs text-th-text-subtle">Grant Type</label>
        <Select value={grantType} onValueChange={(v) => set('grantType', v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="authorization_code">Authorization Code</SelectItem>
            <SelectItem value="client_credentials">Client Credentials</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <label className="mb-1 block text-xs text-th-text-subtle">Client ID</label>
        <Input placeholder="Client ID" value={authConfig.clientId ?? ''} onChange={(e) => set('clientId', e.target.value)} />
      </div>
      <div>
        <label className="mb-1 block text-xs text-th-text-subtle">Client Secret</label>
        <Input type="password" placeholder="Client Secret" value={authConfig.clientSecret ?? ''} onChange={(e) => set('clientSecret', e.target.value)} />
      </div>

      {grantType === 'authorization_code' && (
        <>
          <div>
            <label className="mb-1 flex items-center gap-1 text-xs text-th-text-subtle">
              Auth URL <span className="text-rose-400">*</span>
            </label>
            <Input placeholder="https://..." value={authConfig.authUrl ?? ''} onChange={(e) => set('authUrl', e.target.value)} />
          </div>
          <div>
            <label className="mb-1 flex items-center gap-1 text-xs text-th-text-subtle">
              Redirect URI <span className="text-rose-400">*</span>
            </label>
            <Input placeholder="https://..." value={authConfig.redirectUri ?? ''} onChange={(e) => set('redirectUri', e.target.value)} />
          </div>
        </>
      )}

      <div>
        <label className="mb-1 block text-xs text-th-text-subtle">Token URL</label>
        <Input placeholder="https://..." value={authConfig.tokenUrl ?? ''} onChange={(e) => set('tokenUrl', e.target.value)} />
      </div>
      <div>
        <label className="mb-1 block text-xs text-th-text-subtle">Scopes</label>
        <Input placeholder="openid profile email (space-separated, required)" value={authConfig.scopes ?? ''} onChange={(e) => set('scopes', e.target.value)} />
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="text-xs text-th-text-subtle">Extra Token Params</label>
          <button
            type="button"
            onClick={addExtraParam}
            className="flex items-center gap-1 text-xs text-th-text-muted hover:text-th-text-secondary"
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        </div>
        {extraParams.length > 0 && (
          <div className="flex flex-col gap-1">
            {extraParams.map((p) => (
              <div key={p.id} className="grid grid-cols-[1fr_1fr_24px] items-center gap-1">
                <Input
                  placeholder="Key"
                  value={p.key}
                  onChange={(e) => updateExtraParam(p.id, 'key', e.target.value)}
                />
                <Input
                  placeholder="Value"
                  value={p.value}
                  onChange={(e) => updateExtraParam(p.id, 'value', e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => deleteExtraParam(p.id)}
                  className="flex h-8 w-6 items-center justify-center rounded-sm text-th-text-faint hover:text-rose-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
        {extraParams.length === 0 && (
          <p className="text-xs text-th-text-faint">None — add fields like <code>audience</code> or <code>resource</code> for non-standard providers.</p>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Button onClick={handleAuthorize} disabled={!hasMinConfig || authorizing} size="sm">
          {authorizing ? 'Authorizing...' : token && !isExpired ? 'Re-authorize' : 'Authorize'}
        </Button>
        {token && (
          <button onClick={handleClearToken} className="text-th-text-subtle hover:text-th-text-secondary">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {authError && (
        <p className="rounded-sm border border-rose-700/40 bg-rose-900/10 px-3 py-2 text-xs text-rose-400">
          {authError}
        </p>
      )}

      {token && (
        <div className={cn(
          'flex flex-col gap-2 rounded-sm border px-3 py-2.5 text-xs',
          isExpired
            ? 'border-rose-700/40 bg-rose-900/10'
            : 'border-emerald-700/40 bg-emerald-900/10'
        )}>
          <div className={cn('font-medium', isExpired ? 'text-rose-400' : 'text-emerald-400')}>
            {isExpired ? '⚠ Token expired' : '✓ Token active'}
            {token.expiresAt && (
              <span className="ml-2 font-normal opacity-70">
                {isExpired ? 'expired' : 'expires'} {new Date(token.expiresAt).toLocaleString(undefined, {
                  day: 'numeric', month: 'short', year: 'numeric',
                  hour: '2-digit', minute: '2-digit'
                })}
              </span>
            )}
          </div>
          {token.scope && (
            <div className="text-xs text-th-text-subtle">Scopes: {token.scope}</div>
          )}
          <TokenField label="Access Token" value={token.accessToken} masked />
          {token.refreshToken && (
            <TokenField label="Refresh Token" value={token.refreshToken} masked />
          )}
        </div>
      )}

      {!token && hasMinConfig && (
        <p className="text-xs text-amber-400/80">No token cached - click Authorize to authenticate.</p>
      )}
    </div>
  )
}