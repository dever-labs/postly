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
  getGeneralSettings: vi.fn().mockReturnValue({ sslVerification: true, followRedirects: true, defaultTimeout: 30000 }),
}))

import { registerOAuthHandlers } from '../oauth'
import { queryOne } from '../../database'
import { authorizeAuthCode, clientCredentials, getValidToken, getValidTokenForConfig, authorizeInline } from '../../services/oauth'
import { getGeneralSettings } from '../settings-utils'

const mockQ1 = vi.mocked(queryOne)
const mockAuthorizeAuthCode = vi.mocked(authorizeAuthCode)
const mockClientCredentials = vi.mocked(clientCredentials)
const mockGetValidToken = vi.mocked(getValidToken)
const mockGetValidTokenForConfig = vi.mocked(getValidTokenForConfig)
const mockAuthorizeInline = vi.mocked(authorizeInline)
const mockGetGeneralSettings = vi.mocked(getGeneralSettings)

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
    mockGetGeneralSettings.mockReturnValue({ sslVerification: true, followRedirects: true, defaultTimeout: 30000 })
    registerOAuthHandlers()
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
      mockGetGeneralSettings.mockReturnValue({ sslVerification: false, followRedirects: true, defaultTimeout: 30000 })
      mockQ1.mockReturnValue(fakeConfigRow)
      mockAuthorizeAuthCode.mockResolvedValue(fakeToken)
      await invoke('postly:oauth:authorize', { configId: 'cfg1' })
      expect(mockAuthorizeAuthCode).toHaveBeenCalledWith(expect.anything(), false)
    })

    it('passes sslVerification=false to clientCredentials when global SSL is disabled', async () => {
      mockGetGeneralSettings.mockReturnValue({ sslVerification: false, followRedirects: true, defaultTimeout: 30000 })
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
  })

  // ── postly:oauth:token:get ─────────────────────────────────────────────────

  describe('postly:oauth:token:get', () => {
    it('passes sslVerification=true to getValidToken by default', async () => {
      mockGetValidToken.mockResolvedValue(fakeToken)
      await invoke('postly:oauth:token:get', { configId: 'cfg1' })
      expect(mockGetValidToken).toHaveBeenCalledWith('cfg1', true)
    })

    it('passes sslVerification=false to getValidToken when global SSL is disabled', async () => {
      mockGetGeneralSettings.mockReturnValue({ sslVerification: false, followRedirects: true, defaultTimeout: 30000 })
      mockGetValidToken.mockResolvedValue(fakeToken)
      await invoke('postly:oauth:token:get', { configId: 'cfg1' })
      expect(mockGetValidToken).toHaveBeenCalledWith('cfg1', false)
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
      mockGetGeneralSettings.mockReturnValue({ sslVerification: false, followRedirects: true, defaultTimeout: 30000 })
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

    it('passes sslVerification=false to getValidTokenForConfig when global SSL is disabled', async () => {
      mockGetGeneralSettings.mockReturnValue({ sslVerification: false, followRedirects: true, defaultTimeout: 30000 })
      mockGetValidTokenForConfig.mockResolvedValue(fakeToken)
      await invoke('postly:oauth:inline:token:get', fakeOAuthConfig)
      expect(mockGetValidTokenForConfig).toHaveBeenCalledWith(fakeOAuthConfig, false)
    })
  })
})
