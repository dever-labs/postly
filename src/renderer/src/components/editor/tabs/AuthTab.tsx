import { ChevronDown, ChevronRight, X } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import type { AuthType, GrantType, OAuthConfig, Token } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { cn } from '@/lib/utils'

interface AuthTabProps {
  authType: AuthType
  authConfig: Record<string, string>
  onTypeChange: (t: AuthType) => void
  onConfigChange: (c: Record<string, string>) => void
}

const AUTH_TYPES: AuthType[] = ['none', 'bearer', 'oauth2']

function OAuthPanel({
  authConfig,
  onConfigChange,
}: {
  authConfig: Record<string, string>
  onConfigChange: (c: Record<string, string>) => void
}) {
  const [configs, setConfigs] = useState<OAuthConfig[]>([])
  const [token, setToken] = useState<Token | null>(null)
  const [authorizing, setAuthorizing] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [newConfig, setNewConfig] = useState<Partial<OAuthConfig>>({ grantType: 'authorization_code' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    ;(window as any).api.oauth.configs.list().then(({ data }: { data: OAuthConfig[] }) => {
      if (data) setConfigs(data)
    })
  }, [])

  useEffect(() => {
    if (authConfig.configId) {
      ;(window as any).api.oauth.tokens.get({ configId: authConfig.configId }).then(({ data }: { data: Token }) => {
        if (data) setToken(data)
      })
    }
  }, [authConfig.configId])

  const handleAuthorize = async () => {
    if (!authConfig.configId) return
    setAuthorizing(true)
    const { data, error } = await (window as any).api.oauth.authorize({ configId: authConfig.configId })
    setAuthorizing(false)
    if (data) setToken(data)
    if (error) console.error('OAuth error:', error)
  }

  const handleSaveConfig = async () => {
    setSaving(true)
    const { data, error } = await (window as any).api.oauth.configs.create(newConfig)
    setSaving(false)
    if (data) {
      setConfigs((prev) => [...prev, data])
      onConfigChange({ ...authConfig, configId: data.id })
      setShowCreate(false)
      setNewConfig({ grantType: 'authorization_code' })
    }
    if (error) console.error('Save config error:', error)
  }

  const isExpired = token?.expiresAt ? token.expiresAt < Date.now() : false

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Select
          value={authConfig.configId ?? ''}
          onValueChange={(v) => onConfigChange({ ...authConfig, configId: v })}
        >
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="Select OAuth config..." />
          </SelectTrigger>
          <SelectContent>
            {configs.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button onClick={handleAuthorize} disabled={!authConfig.configId || authorizing} size="sm">
          {authorizing ? 'Authorizing...' : 'Authorize'}
        </Button>
      </div>

      {token && (
        <div className="flex items-center gap-2 rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs">
          <span className={cn('flex-1', isExpired ? 'text-rose-400' : 'text-emerald-400')}>
            {isExpired ? 'Token expired' : 'Token active'}
            {token.expiresAt && ` · expires ${new Date(token.expiresAt).toLocaleString()}`}
          </span>
          <button
            onClick={() => { setToken(null); onConfigChange({ ...authConfig, configId: authConfig.configId }) }}
            className="text-neutral-500 hover:text-neutral-300"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Create new config */}
      <button
        onClick={() => setShowCreate(!showCreate)}
        className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-300"
      >
        {showCreate ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Create new config
      </button>

      {showCreate && (
        <div className="flex flex-col gap-2 rounded border border-neutral-800 p-3">
          <Input placeholder="Config name" value={newConfig.name ?? ''} onChange={(e) => setNewConfig({ ...newConfig, name: e.target.value })} />
          <Select value={newConfig.grantType} onValueChange={(v) => setNewConfig({ ...newConfig, grantType: v as GrantType })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="authorization_code">Authorization Code</SelectItem>
              <SelectItem value="client_credentials">Client Credentials</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder="Client ID" value={newConfig.clientId ?? ''} onChange={(e) => setNewConfig({ ...newConfig, clientId: e.target.value })} />
          <Input type="password" placeholder="Client Secret" value={newConfig.clientSecret ?? ''} onChange={(e) => setNewConfig({ ...newConfig, clientSecret: e.target.value })} />
          {newConfig.grantType === 'authorization_code' && (
            <>
              <Input placeholder="Auth URL" value={newConfig.authUrl ?? ''} onChange={(e) => setNewConfig({ ...newConfig, authUrl: e.target.value })} />
              <Input placeholder="Redirect URI" value={newConfig.redirectUri ?? ''} onChange={(e) => setNewConfig({ ...newConfig, redirectUri: e.target.value })} />
            </>
          )}
          <Input placeholder="Token URL" value={newConfig.tokenUrl ?? ''} onChange={(e) => setNewConfig({ ...newConfig, tokenUrl: e.target.value })} />
          <Input placeholder="Scopes (space-separated)" value={newConfig.scopes ?? ''} onChange={(e) => setNewConfig({ ...newConfig, scopes: e.target.value })} />
          <Button size="sm" onClick={handleSaveConfig} disabled={saving}>
            {saving ? 'Saving...' : 'Save Config'}
          </Button>
        </div>
      )}
    </div>
  )
}

export function AuthTab({ authType, authConfig, onTypeChange, onConfigChange }: AuthTabProps) {
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex gap-1">
        {AUTH_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => onTypeChange(t)}
            className={cn(
              'rounded px-3 py-1.5 text-xs transition-colors focus:outline-none',
              authType === t
                ? 'bg-neutral-700 text-neutral-100'
                : 'text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300'
            )}
          >
            {t === 'none' ? 'None' : t === 'bearer' ? 'Bearer Token' : 'OAuth 2.0'}
          </button>
        ))}
      </div>

      {authType === 'bearer' && (
        <div>
          <label className="mb-1 block text-xs text-neutral-500">Token</label>
          <Input
            type="password"
            placeholder="Bearer token..."
            value={authConfig.token ?? ''}
            onChange={(e) => onConfigChange({ ...authConfig, token: e.target.value })}
          />
        </div>
      )}

      {authType === 'oauth2' && (
        <OAuthPanel authConfig={authConfig} onConfigChange={onConfigChange} />
      )}
    </div>
  )
}
