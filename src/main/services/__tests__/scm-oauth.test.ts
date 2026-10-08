import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const browserWindowBehavior = vi.hoisted(() => ({
  mode: 'success' as 'success' | 'state-mismatch' | 'missing-code' | 'closed',
}))

const mockOpenExternalSafe = vi.hoisted(() => vi.fn())

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

vi.mock('../../security', () => ({
  SECURE_WEB_PREFERENCES: { sandbox: true, contextIsolation: true },
  openExternalSafe: mockOpenExternalSafe,
}))

vi.mock('electron', () => {
  const BrowserWindow = vi.fn().mockImplementation(function (this: Record<string, unknown>, options: unknown) {
    const listeners: Record<string, Array<() => void>> = {}
    let destroyed = false

    const instance = {
      options,
      loadURL: vi.fn((url: string) => {
        const authUrl = new URL(url)
        const redirectUri = authUrl.searchParams.get('redirect_uri')
        const state = authUrl.searchParams.get('state') ?? ''

        if (browserWindowBehavior.mode === 'closed') {
          setTimeout(() => {
            listeners.closed?.forEach((handler) => handler())
          }, 5)
          return
        }

        if (!redirectUri) return

        const callbackUrl = new URL(redirectUri)
        if (browserWindowBehavior.mode !== 'missing-code') {
          callbackUrl.searchParams.set('code', 'oauth-code')
        }
        callbackUrl.searchParams.set(
          'state',
          browserWindowBehavior.mode === 'state-mismatch' ? 'wrong-state' : state,
        )

        setTimeout(async () => {
          const http = await import('http')
          const req = http.get(callbackUrl.toString())
          req.on('error', () => undefined)
        }, 5)
      }),
      on: vi.fn((event: string, handler: () => void) => {
        ;(listeners[event] ??= []).push(handler)
      }),
      isDestroyed: vi.fn(() => destroyed),
      close: vi.fn(() => {
        destroyed = true
      }),
    }

    return instance
  })

  return { BrowserWindow }
})

import axios from 'axios'
import { BrowserWindow } from 'electron'
import {
  BUNDLED_CLIENT_IDS,
  pollGitHubDeviceToken,
  pollGitLabDeviceToken,
  requestGitHubDeviceCode,
  requestGitLabDeviceCode,
  resolveClientId,
  startGitHubOAuth,
  startGitLabOAuth,
} from '../scm-oauth'

const mockGet = vi.mocked(axios.get)
const mockPost = vi.mocked(axios.post)

beforeEach(() => {
  vi.clearAllMocks()
  browserWindowBehavior.mode = 'success'
})

afterEach(() => {
  vi.useRealTimers()
})

describe('resolveClientId', () => {
  it('returns bundled IDs for known hosted providers', () => {
    expect(resolveClientId('github', 'https://GITHUB.com/', 'stored-id')).toBe(
      BUNDLED_CLIENT_IDS['https://github.com'],
    )
  })

  it('falls back to the stored client id for unknown hosts', () => {
    expect(resolveClientId('gitlab', 'https://gitlab.internal', 'stored-id')).toBe('stored-id')
  })
})

describe('requestGitHubDeviceCode', () => {
  it('requests a device code and opens the verification URL', async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        device_code: 'device-code',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://github.com/login/device',
        expires_in: 1200,
        interval: 7,
      },
    })

    const result = await requestGitHubDeviceCode({
      baseUrl: 'https://github.com/',
      clientId: 'client-id',
    })

    expect(result).toEqual({
      deviceCode: 'device-code',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 1200,
      interval: 7,
    })
    expect(mockPost).toHaveBeenCalledWith(
      'https://github.com/login/device/code',
      { client_id: 'client-id', scope: 'repo read:org' },
      { headers: { Accept: 'application/json' } },
    )
    expect(mockOpenExternalSafe).toHaveBeenCalledWith('https://github.com/login/device')
  })

  it('throws the provider error description for device code failures', async () => {
    mockPost.mockResolvedValueOnce({
      data: { error: 'invalid_client', error_description: 'OAuth app is disabled' },
    })

    await expect(
      requestGitHubDeviceCode({ baseUrl: 'https://github.com', clientId: 'client-id' }),
    ).rejects.toThrow('OAuth app is disabled')
  })
})

describe('requestGitLabDeviceCode', () => {
  it('uses verification_uri_complete when available', async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        device_code: 'device-code',
        user_code: 'CODE-123',
        verification_uri: 'https://gitlab.com/device',
        verification_uri_complete: 'https://gitlab.com/device?user_code=CODE-123',
      },
    })

    const result = await requestGitLabDeviceCode({
      baseUrl: 'https://gitlab.com/',
      clientId: 'client-id',
    })

    expect(result.verificationUri).toBe('https://gitlab.com/device?user_code=CODE-123')
    expect(mockPost.mock.calls[0][0]).toBe('https://gitlab.com/oauth/authorize_device')
    expect(String(mockPost.mock.calls[0][1])).toContain('client_id=client-id')
    expect(mockOpenExternalSafe).toHaveBeenCalledWith('https://gitlab.com/device?user_code=CODE-123')
  })
})

describe('pollGitHubDeviceToken', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('retries pending authorization and returns the authenticated user', async () => {
    mockPost
      .mockResolvedValueOnce({ data: { error: 'authorization_pending' } })
      .mockResolvedValueOnce({ data: { access_token: 'gh-token' } })
    mockGet.mockResolvedValueOnce({
      data: { login: 'monalisa', name: null, avatar_url: 'https://avatars.example/mona.png' },
    })

    const promise = pollGitHubDeviceToken({
      baseUrl: 'https://github.com',
      clientId: 'client-id',
      deviceCode: 'device-code',
      interval: 5,
      expiresIn: 20,
    })

    await vi.advanceTimersByTimeAsync(5000)
    expect(mockPost).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5000)

    await expect(promise).resolves.toEqual({
      token: 'gh-token',
      user: {
        login: 'monalisa',
        name: 'monalisa',
        avatarUrl: 'https://avatars.example/mona.png',
      },
    })
    expect(mockGet).toHaveBeenCalledWith(
      'https://api.github.com/user',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer gh-token' }),
      }),
    )
  })

  it('honors slow_down by extending the next polling interval', async () => {
    mockPost
      .mockResolvedValueOnce({ data: { error: 'authorization_pending' } })
      .mockResolvedValueOnce({ data: { error: 'slow_down' } })
      .mockResolvedValueOnce({ data: { access_token: 'gh-token' } })
    mockGet.mockResolvedValueOnce({
      data: { login: 'monalisa', name: 'Mona Lisa', avatar_url: 'https://avatars.example/mona.png' },
    })

    const promise = pollGitHubDeviceToken({
      baseUrl: 'https://github.enterprise.local',
      clientId: 'client-id',
      deviceCode: 'device-code',
      interval: 5,
      expiresIn: 30,
    })

    await vi.advanceTimersByTimeAsync(5000)
    expect(mockPost).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5000)
    expect(mockPost).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(9000)
    expect(mockPost).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1000)

    await expect(promise).resolves.toEqual({
      token: 'gh-token',
      user: {
        login: 'monalisa',
        name: 'Mona Lisa',
        avatarUrl: 'https://avatars.example/mona.png',
      },
    })
    expect(mockGet).toHaveBeenCalledWith(
      'https://github.enterprise.local/api/v3/user',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer gh-token' }),
      }),
    )
  })

  it('throws device-flow terminal errors', async () => {
    mockPost.mockResolvedValueOnce({
      data: { error: 'expired_token', error_description: 'Device code expired' },
    })

    const promise = pollGitHubDeviceToken({
      baseUrl: 'https://github.com',
      clientId: 'client-id',
      deviceCode: 'device-code',
      interval: 5,
      expiresIn: 20,
    })
    const rejection = expect(promise).rejects.toThrow('Device code expired')

    await vi.advanceTimersByTimeAsync(5000)

    await rejection
  })

  it('times out when authorization never completes', async () => {
    mockPost.mockResolvedValue({ data: { error: 'authorization_pending' } })

    const promise = pollGitHubDeviceToken({
      baseUrl: 'https://github.com',
      clientId: 'client-id',
      deviceCode: 'device-code',
      interval: 5,
      expiresIn: 10,
    })
    const rejection = expect(promise).rejects.toThrow('Device authorization timed out')

    await vi.advanceTimersByTimeAsync(10000)

    await rejection
  })
})

describe('pollGitLabDeviceToken', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('returns the user for a successful device flow exchange', async () => {
    mockPost.mockResolvedValueOnce({ data: { access_token: 'gl-token' } })
    mockGet.mockResolvedValueOnce({
      data: { username: 'gitlab-user', name: 'GitLab User', avatar_url: 'https://gitlab.example/avatar.png' },
    })

    const promise = pollGitLabDeviceToken({
      baseUrl: 'https://gitlab.example.com',
      clientId: 'client-id',
      deviceCode: 'device-code',
      interval: 5,
      expiresIn: 20,
    })

    await vi.advanceTimersByTimeAsync(5000)

    await expect(promise).resolves.toEqual({
      token: 'gl-token',
      user: {
        username: 'gitlab-user',
        name: 'GitLab User',
        avatarUrl: 'https://gitlab.example/avatar.png',
      },
    })
    expect(mockGet).toHaveBeenCalledWith(
      'https://gitlab.example.com/api/v4/user',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer gl-token' }),
      }),
    )
  })

  it('throws denied device-flow errors', async () => {
    mockPost.mockResolvedValueOnce({
      data: { error: 'access_denied', error_description: 'User denied access' },
    })

    const promise = pollGitLabDeviceToken({
      baseUrl: 'https://gitlab.example.com',
      clientId: 'client-id',
      deviceCode: 'device-code',
      interval: 5,
      expiresIn: 20,
    })
    const rejection = expect(promise).rejects.toThrow('User denied access')

    await vi.advanceTimersByTimeAsync(5000)

    await rejection
  })
})

describe('startGitHubOAuth', () => {
  it('exchanges the callback code and loads the GitHub user profile', async () => {
    mockPost.mockResolvedValueOnce({ data: { access_token: 'oauth-token' } })
    mockGet.mockResolvedValueOnce({
      data: { login: 'octocat', name: null, avatar_url: 'https://avatars.example/octocat.png' },
    })

    const result = await startGitHubOAuth({
      baseUrl: 'https://github.com',
      clientId: 'client-id',
      clientSecret: 'client-secret',
    })

    const windows = vi.mocked(BrowserWindow).mock.results
    const firstWindow = windows[0]?.value as { loadURL: ReturnType<typeof vi.fn> }
    const authorizeUrl = new URL(firstWindow.loadURL.mock.calls[0][0])

    expect(result).toEqual({
      token: 'oauth-token',
      user: {
        login: 'octocat',
        name: 'octocat',
        avatarUrl: 'https://avatars.example/octocat.png',
      },
    })
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(authorizeUrl.searchParams.get('client_id')).toBe('client-id')
    expect(authorizeUrl.searchParams.get('scope')).toBe('repo,read:org')
    expect(authorizeUrl.searchParams.get('state')).toBeTruthy()
    expect(mockPost).toHaveBeenCalledWith(
      'https://github.com/login/oauth/access_token',
      expect.objectContaining({
        client_id: 'client-id',
        client_secret: 'client-secret',
        code: 'oauth-code',
      }),
      { headers: { Accept: 'application/json' } },
    )
    expect(mockGet).toHaveBeenCalledWith(
      'https://api.github.com/user',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer oauth-token',
          Accept: 'application/vnd.github.v3+json',
        }),
      }),
    )
  })

  it('rejects mismatched OAuth state values', async () => {
    browserWindowBehavior.mode = 'state-mismatch'

    await expect(
      startGitHubOAuth({
        baseUrl: 'https://github.com',
        clientId: 'client-id',
        clientSecret: 'client-secret',
      }),
    ).rejects.toThrow('OAuth state mismatch')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('rejects when the OAuth window is closed before callback', async () => {
    browserWindowBehavior.mode = 'closed'

    await expect(
      startGitHubOAuth({
        baseUrl: 'https://github.com',
        clientId: 'client-id',
        clientSecret: 'client-secret',
      }),
    ).rejects.toThrow('OAuth window was closed')
  })

  it('rejects when token exchange returns no access token', async () => {
    mockPost.mockResolvedValueOnce({ data: {} })

    await expect(
      startGitHubOAuth({
        baseUrl: 'https://github.com',
        clientId: 'client-id',
        clientSecret: 'client-secret',
      }),
    ).rejects.toThrow('No access token in response')
  })
})

describe('startGitLabOAuth', () => {
  it('performs the PKCE token exchange and fetches the GitLab user', async () => {
    mockPost.mockResolvedValueOnce({ data: { access_token: 'gitlab-token' } })
    mockGet.mockResolvedValueOnce({
      data: { username: 'gitlab-user', name: 'GitLab User', avatar_url: 'https://gitlab.example/avatar.png' },
    })

    const result = await startGitLabOAuth({
      baseUrl: 'https://gitlab.example.com',
      clientId: 'client-id',
    })

    const windows = vi.mocked(BrowserWindow).mock.results
    const firstWindow = windows[0]?.value as { loadURL: ReturnType<typeof vi.fn> }
    const authorizeUrl = new URL(firstWindow.loadURL.mock.calls[0][0])

    expect(result).toEqual({
      token: 'gitlab-token',
      user: {
        username: 'gitlab-user',
        name: 'GitLab User',
        avatarUrl: 'https://gitlab.example/avatar.png',
      },
    })
    expect(authorizeUrl.origin + authorizeUrl.pathname).toBe('https://gitlab.example.com/oauth/authorize')
    expect(authorizeUrl.searchParams.get('response_type')).toBe('code')
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorizeUrl.searchParams.get('code_challenge')).toBeTruthy()
    expect(mockPost).toHaveBeenCalledWith(
      'https://gitlab.example.com/oauth/token',
      expect.objectContaining({
        grant_type: 'authorization_code',
        client_id: 'client-id',
        code: 'oauth-code',
        code_verifier: expect.any(String),
      }),
    )
    expect(mockGet).toHaveBeenCalledWith(
      'https://gitlab.example.com/api/v4/user',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer gitlab-token' }),
      }),
    )
  })

  it('rejects callback requests that omit the authorization code', async () => {
    browserWindowBehavior.mode = 'missing-code'

    await expect(
      startGitLabOAuth({
        baseUrl: 'https://gitlab.example.com',
        clientId: 'client-id',
      }),
    ).rejects.toThrow('No code in callback')
  })
})
