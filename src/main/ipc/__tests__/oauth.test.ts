import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers: Record<string, (ev: unknown, args: unknown) => Promise<Record<string, unknown>>> = {}

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (ev: unknown, args: unknown) => Promise<Record<string, unknown>>) => {
      handlers[channel] = handler
    })
  }
}))

vi.mock('../../database', () => ({
  queryOne: vi.fn(),
  queryAll: vi.fn(),
  run: vi.fn(),
  runTransaction: vi.fn(),
}))

vi.mock('../../services/oauth', () => ({
  authorizeAuthCode: vi.fn(),
  clientCredentials: vi.fn(),
  getValidToken: vi.fn(),
  getValidTokenForConfig: vi.fn(),
  authorizeInline: vi.fn(),
  configHashKey: vi.fn().mockReturnValue('hash-key'),
}))

vi.mock('../settings-utils', () => ({
  getGeneralSettings: vi.fn().mockReturnValue({ sslVerification: true, followRedirects: true, defaultTimeout: 30000, autoUpdate: true }),
}))

import { registerOAuthHandlers } from '../oauth'
import { queryAll, queryOne, run } from '../../database'
import { authorizeAuthCode, clientCredentials, getValidToken, getValidTokenForConfig, authorizeInline, configHashKey } from '../../services/oauth'
import { getGeneralSettings } from '../settings-utils'

const mockQ1 = vi.mocked(queryOne)
const mockQAll = vi.mocked(queryAll)
const mockRun = vi.mocked(run)
const mockAuthorizeAuthCode = vi.mocked(authorizeAuthCode)
const mockClientCredentials = vi.mocked(clientCredentials)
const mockGetValidToken = vi.mocked(getValidToken)
const mockGetValidTokenForConfig = vi.mocked(getValidTokenForConfig)
const mockAuthorizeInline = vi.mocked(authorizeInline)
const mockGetGeneralSettings = vi.mocked(getGeneralSettings)
const mockConfigHashKey = vi.mocked(configHashKey)

const fakeToken = { id: 't1', oauthConfigId: 'cfg1', accessToken: 'tok', tokenType: 'Bearer', createdAt: Date.now() }

const fakeConfigRow = {
  id: 'cfg1', name: 'Test', grant_type: 'authorization_code',
  client_id: 'cid', client_secret: null, auth_url: 'https://auth.example.com',
  token_url: 'https://token.example.com', scopes: 'read', redirect_uri: 'https://app.example.com/cb'
}

const fakeOAuthConfig = {
  id: 'cfg1', name: 'Test', grantType: 'authorization_code',
  clientId: 'cid', authUrl: 'https://auth.example.com',
  tokenUrl: 'https://token.example.com', scopes: 'read', redirectUri: 'https://app.example.com/cb'
}

function invoke(channel: string, args: unknown) {
  return handlers[channel](null, args)
}

describe('OAuth IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetGeneralSettings.mockReturnValue({ sslVerification: true, followRedirects: true, defaultTimeout: 30000, autoUpdate: true })
    registerOAuthHandlers()
  })

  describe('config CRUD', () => {
    it('lists configs mapped to renderer-friendly field names', async () => {
      mockQAll.mockReturnValueOnce([
        {
          id: 'cfg1',
          name: 'Client credentials',
          grant_type: 'client_credentials',
          client_id: 'client-id',
          client_secret: 'secret',
          auth_url: null,
          token_url: 'https://token.example.com',
          scopes: 'read write',
          redirect_uri: 'https://app.example.com/callback',
        },
      ] as never)

      await expect(invoke('postly:oauth:configs:list', undefined)).resolves.toEqual({
        data: [{
          id: 'cfg1',
          name: 'Client credentials',
          grantType: 'client_credentials',
          clientId: 'client-id',
          clientSecret: 'secret',
          authUrl: undefined,
          tokenUrl: 'https://token.example.com',
          scopes: 'read write',
          redirectUri: 'https://app.example.com/callback',
        }],
      })
    })

    it('creates a config after validating redirectUri', async () => {
      mockQ1.mockReturnValueOnce({
        id: 'cfg-created',
        name: 'Created',
        grant_type: 'authorization_code',
        client_id: 'client-id',
        client_secret: 'secret',
        auth_url: 'https://auth.example.com',
        token_url: 'https://token.example.com',
        scopes: 'openid profile',
        redirect_uri: 'https://app.example.com/callback',
      })

      await expect(invoke('postly:oauth:configs:create', {
        name: 'Created',
        grantType: 'authorization_code',
        clientId: 'client-id',
        clientSecret: 'secret',
        authUrl: 'https://auth.example.com',
        tokenUrl: 'https://token.example.com',
        scopes: 'openid profile',
        redirectUri: 'https://app.example.com/callback',
      })).resolves.toEqual({
        data: {
          id: 'cfg-created',
          name: 'Created',
          grantType: 'authorization_code',
          clientId: 'client-id',
          clientSecret: 'secret',
          authUrl: 'https://auth.example.com',
          tokenUrl: 'https://token.example.com',
          scopes: 'openid profile',
          redirectUri: 'https://app.example.com/callback',
        },
      })

      expect(mockRun).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO oauth_configs'),
        expect.arrayContaining(['Created', 'authorization_code', 'client-id', 'secret', 'https://auth.example.com', 'https://token.example.com', 'openid profile', 'https://app.example.com/callback']),
      )
    })

    it('rejects missing and invalid redirect URIs', async () => {
      await expect(invoke('postly:oauth:configs:create', {
        name: 'Broken',
        grantType: 'authorization_code',
        clientId: 'client-id',
        tokenUrl: 'https://token.example.com',
        redirectUri: '',
      })).resolves.toEqual({ error: 'redirectUri is required' })

      await expect(invoke('postly:oauth:configs:create', {
        name: 'Broken',
        grantType: 'authorization_code',
        clientId: 'client-id',
        tokenUrl: 'https://token.example.com',
        redirectUri: '/relative',
      })).resolves.toEqual({ error: 'redirectUri must be a valid absolute URL' })
    })

    it('deletes both tokens and configs for a config id', async () => {
      await expect(invoke('postly:oauth:configs:delete', { id: 'cfg1' })).resolves.toEqual({ data: true })
      expect(mockRun.mock.calls).toEqual([
        ['DELETE FROM tokens WHERE oauth_config_id = ?', ['cfg1']],
        ['DELETE FROM oauth_configs WHERE id = ?', ['cfg1']],
      ])
    })
  })

  // ── postly:oauth:authorize ─────────────────────────────────────────────────

  describe('postly:oauth:authorize', () => {
    it('passes sslVerification=true to authorizeAuthCode by default', async () => {
      mockQ1.mockReturnValue(fakeConfigRow)
      mockAuthorizeAuthCode.mockResolvedValue(fakeToken)
      await invoke('postly:oauth:authorize', { configId: 'cfg1' })
      expect(mockAuthorizeAuthCode).toHaveBeenCalledWith(expect.anything(), true)
    })

    it('passes sslVerification=false to authorizeAuthCode when global SSL is disabled', async () => {
      mockGetGeneralSettings.mockReturnValue({ sslVerification: false, followRedirects: true, defaultTimeout: 30000, autoUpdate: true })
      mockQ1.mockReturnValue(fakeConfigRow)
      mockAuthorizeAuthCode.mockResolvedValue(fakeToken)
      await invoke('postly:oauth:authorize', { configId: 'cfg1' })
      expect(mockAuthorizeAuthCode).toHaveBeenCalledWith(expect.anything(), false)
    })

    it('passes sslVerification=false to clientCredentials when global SSL is disabled', async () => {
      mockGetGeneralSettings.mockReturnValue({ sslVerification: false, followRedirects: true, defaultTimeout: 30000, autoUpdate: true })
      mockQ1.mockReturnValue({ ...fakeConfigRow, grant_type: 'client_credentials' })
      mockClientCredentials.mockResolvedValue(fakeToken)
      await invoke('postly:oauth:authorize', { configId: 'cfg1' })
      expect(mockClientCredentials).toHaveBeenCalledWith(expect.anything(), false)
    })

    it('returns error when config is not found', async () => {
      mockQ1.mockReturnValue(null)
      const result = await invoke('postly:oauth:authorize', { configId: 'missing' })
      expect(result).toEqual({ error: 'OAuth config not found' })
    })

    it('redacts token secrets from authorize responses', async () => {
      mockQ1.mockReturnValue(fakeConfigRow)
      mockAuthorizeAuthCode.mockResolvedValue({ ...fakeToken, refreshToken: 'refresh-token', scope: 'read write' })

      const result = await invoke('postly:oauth:authorize', { configId: 'cfg1' })

      expect(result).toEqual({
        data: {
          id: 't1',
          oauthConfigId: 'cfg1',
          tokenType: 'Bearer',
          createdAt: fakeToken.createdAt,
          expiresAt: undefined,
          scope: 'read write',
          hasRefreshToken: true,
        },
      })
      expect(JSON.stringify(result)).not.toContain('refresh-token')
      expect(JSON.stringify(result)).not.toContain('accessToken')
    })
  })

  // ── postly:oauth:token:get ─────────────────────────────────────────────────

  describe('postly:oauth:token:get', () => {
    it('passes sslVerification=true to getValidToken by default', async () => {
      mockGetValidToken.mockResolvedValue(fakeToken)
      await invoke('postly:oauth:token:get', { configId: 'cfg1' })
      expect(mockGetValidToken).toHaveBeenCalledWith('cfg1', true)
    })

    describe('token clearing', () => {
      it('deletes stored tokens for a saved config', async () => {
        await expect(invoke('postly:oauth:token:clear', { configId: 'cfg1' })).resolves.toEqual({ data: true })
        expect(mockRun).toHaveBeenCalledWith('DELETE FROM tokens WHERE oauth_config_id = ?', ['cfg1'])
      })
    })

    it('passes sslVerification=false to getValidToken when global SSL is disabled', async () => {
      mockGetGeneralSettings.mockReturnValue({ sslVerification: false, followRedirects: true, defaultTimeout: 30000, autoUpdate: true })
      mockGetValidToken.mockResolvedValue(fakeToken)
      await invoke('postly:oauth:token:get', { configId: 'cfg1' })
      expect(mockGetValidToken).toHaveBeenCalledWith('cfg1', false)
    })

    it('returns only token metadata', async () => {
      mockGetValidToken.mockResolvedValue({ ...fakeToken, refreshToken: 'refresh-token' })
      const result = await invoke('postly:oauth:token:get', { configId: 'cfg1' })
      expect(result).toEqual({
        data: {
          id: 't1',
          oauthConfigId: 'cfg1',
          tokenType: 'Bearer',
          createdAt: fakeToken.createdAt,
          expiresAt: undefined,
          scope: undefined,
          hasRefreshToken: true,
        },
      })
    })
  })

  // ── postly:oauth:inline:authorize ─────────────────────────────────────────

  describe('postly:oauth:inline:authorize', () => {
    it('passes sslVerification=true to authorizeInline by default', async () => {
      mockAuthorizeInline.mockResolvedValue(fakeToken)
      await invoke('postly:oauth:inline:authorize', fakeOAuthConfig)
      expect(mockAuthorizeInline).toHaveBeenCalledWith(fakeOAuthConfig, true)
    })

    it('passes sslVerification=false to authorizeInline when global SSL is disabled', async () => {
      mockGetGeneralSettings.mockReturnValue({ sslVerification: false, followRedirects: true, defaultTimeout: 30000, autoUpdate: true })
      mockAuthorizeInline.mockResolvedValue(fakeToken)
      await invoke('postly:oauth:inline:authorize', fakeOAuthConfig)
      expect(mockAuthorizeInline).toHaveBeenCalledWith(fakeOAuthConfig, false)
    })
  })

  // ── postly:oauth:inline:token:get ─────────────────────────────────────────

  describe('postly:oauth:inline:token:get', () => {
    it('passes sslVerification=true to getValidTokenForConfig by default', async () => {
      mockGetValidTokenForConfig.mockResolvedValue(fakeToken)
      await invoke('postly:oauth:inline:token:get', fakeOAuthConfig)
      expect(mockGetValidTokenForConfig).toHaveBeenCalledWith(fakeOAuthConfig, true)
    })

    describe('inline token clearing', () => {
      it('clears tokens by the inline config hash key', async () => {
        mockConfigHashKey.mockReturnValueOnce('inline-hash')
        await expect(invoke('postly:oauth:inline:token:clear', fakeOAuthConfig)).resolves.toEqual({ data: true })
        expect(mockRun).toHaveBeenCalledWith('DELETE FROM tokens WHERE oauth_config_id = ?', ['inline-hash'])
      })
    })

    it('passes sslVerification=false to getValidTokenForConfig when global SSL is disabled', async () => {
      mockGetGeneralSettings.mockReturnValue({ sslVerification: false, followRedirects: true, defaultTimeout: 30000, autoUpdate: true })
      mockGetValidTokenForConfig.mockResolvedValue(fakeToken)
      await invoke('postly:oauth:inline:token:get', fakeOAuthConfig)
      expect(mockGetValidTokenForConfig).toHaveBeenCalledWith(fakeOAuthConfig, false)
    })
  })

  // ── error message formatting (toMessage helper) ───────────────────────────

  describe('error message formatting', () => {
    it('returns err.message (not "Error: msg") when authorize throws an Error', async () => {
      mockQ1.mockReturnValue(fakeConfigRow)
      mockAuthorizeAuthCode.mockRejectedValue(new Error('Token endpoint returned 401: invalid_client'))
      const { error } = await invoke('postly:oauth:authorize', { configId: 'cfg1' })
      expect(error).toBe('Token endpoint returned 401: invalid_client')
      expect(error).not.toMatch(/^Error:/)
    })

    it('returns String(value) when a non-Error is thrown', async () => {
      mockQ1.mockReturnValue(fakeConfigRow)
      mockAuthorizeAuthCode.mockRejectedValue('plain string error')
      const { error } = await invoke('postly:oauth:authorize', { configId: 'cfg1' })
      expect(error).toBe('plain string error')
    })

    it('returns err.message for inline authorize errors', async () => {
      mockAuthorizeInline.mockRejectedValue(new Error('Cannot connect to token endpoint — connection refused'))
      const { error } = await invoke('postly:oauth:inline:authorize', fakeOAuthConfig)
      expect(error).toBe('Cannot connect to token endpoint — connection refused')
      expect(error).not.toMatch(/^Error:/)
    })
  })
})
