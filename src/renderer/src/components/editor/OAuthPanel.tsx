import React, { useEffect, useState } from 'react'
import type { GrantType, Token } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface OAuthPanelProps {
  authConfig: Record<string, string>
  onConfigChange: (c: Record<string, string>) => void
}

function buildInlineConfig(authConfig: Record<string, string>) {
  return {
    id: '',
    name: 'inline',
    grantType: authConfig.grantType ?? 'authorization_code',
    clientId: authConfig.clientId ?? '',
    clientSecret: authConfig.clientSecret || undefined,
    authUrl: authConfig.authUrl || undefined,
    tokenUrl: authConfig.tokenUrl ?? '',
    scopes: authConfig.scopes ?? '',
    redirectUri: authConfig.redirectUri || 'http://localhost:9876/callback',
  }
}

export function OAuthPanel({ authConfig, onConfigChange }: OAuthPanelProps) {
  const [token, setToken] = useState<Token | null>(null)
  const [authorizing, setAuthorizing] = useState(false)

  const set = (field: string, value: string) => onConfigChange({ ...authConfig, [field]: value })
  const hasMinConfig = !!(authConfig.clientId && authConfig.tokenUrl)
  const grantType = (authConfig.grantType ?? 'authorization_code') as GrantType

  useEffect(() => {
    if (!hasMinConfig) { setToken(null); return }
    const config = buildInlineConfig(authConfig)
    ;(window as any).api.oauth.inline.getToken(config).then(({ data }: { data: Token | null }) => {
      setToken(data ?? null)
    })
  }, [authConfig.clientId, authConfig.tokenUrl, authConfig.scopes])

  const handleAuthorize = async () => {
    if (!hasMinConfig) return
    setAuthorizing(true)
    const config = buildInlineConfig(authConfig)
    const { data, error } = await (window as any).api.oauth.inline.authorize(config)
    setAuthorizing(false)
    if (data) setToken(data)
    if (error) console.error('OAuth error:', error)
  }

  const handleClearToken = async () => {
    await (window as any).api.oauth.inline.clearToken(buildInlineConfig(authConfig))
    setToken(null)
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
            <label className="mb-1 block text-xs text-th-text-subtle">Auth URL</label>
            <Input placeholder="https://..." value={authConfig.authUrl ?? ''} onChange={(e) => set('authUrl', e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-th-text-subtle">Redirect URI</label>
            <Input placeholder="http://localhost:9876/callback" value={authConfig.redirectUri ?? ''} onChange={(e) => set('redirectUri', e.target.value)} />
          </div>
        </>
      )}

      <div>
        <label className="mb-1 block text-xs text-th-text-subtle">Token URL</label>
        <Input placeholder="https://..." value={authConfig.tokenUrl ?? ''} onChange={(e) => set('tokenUrl', e.target.value)} />
      </div>
      <div>
        <label className="mb-1 block text-xs text-th-text-subtle">Scopes</label>
        <Input placeholder="read write (space-separated)" value={authConfig.scopes ?? ''} onChange={(e) => set('scopes', e.target.value)} />
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

      {token && (
        <div className={cn(
          'rounded border px-3 py-2 text-xs',
          isExpired
            ? 'border-rose-700/40 bg-rose-900/10 text-rose-400'
            : 'border-emerald-700/40 bg-emerald-900/10 text-emerald-400'
        )}>
          {isExpired ? 'Token expired' : 'Token active'}
          {token.expiresAt && ` - expires ${new Date(token.expiresAt).toLocaleString()}`}
        </div>
      )}

      {!token && hasMinConfig && (
        <p className="text-xs text-amber-400/80">No token cached - click Authorize to authenticate.</p>
      )}
    </div>
  )
}