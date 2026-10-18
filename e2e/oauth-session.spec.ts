import { test, expect } from './fixtures'
import http from 'http'
import type { AddressInfo } from 'net'
import type { StubHandle } from '../src/main/services/__tests__/helpers/http-stub'

interface AuthServer {
  url: string
  origin: string
  stop: () => void
}

function startAuthServer(): Promise<AuthServer> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url!, 'http://127.0.0.1')
        const redirectUri = url.searchParams.get('redirect_uri') ?? ''
        const state = url.searchParams.get('state') ?? ''
        const callback = new URL(redirectUri)
        callback.searchParams.set('code', 'e2e-auth-code')
        callback.searchParams.set('state', state)
        res.writeHead(302, {
          Location: callback.toString(),
          'Set-Cookie': 'idp-session=active; Path=/',
        })
      } catch {
        res.writeHead(500)
      }
      res.end()
    })

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${port}/authorize`,
        origin: `http://127.0.0.1:${port}`,
        stop: () => server.close(),
      })
    })
  })
}

let authServer: AuthServer
let tokenEndpoint: StubHandle

const REDIRECT_URI = 'http://localhost:19999/callback'

test.describe('OAuth session persistence', () => {
  test.beforeAll(async () => {
    authServer = await startAuthServer()
  })

  test.afterAll(async () => {
    authServer?.stop()
  })

  test.beforeEach(async ({ electronApp, stubServer }) => {
    tokenEndpoint = await stubServer.stub({
      method: 'POST',
      path: '/oauth2/token',
      response: {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: {
          access_token: 'e2e-access-token',
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: 'e2e-refresh-token',
          scope: 'read',
        },
      },
    })

    await electronApp.evaluate(async ({ session }) => {
      const allSessions = [
        'persist:oauth-e2e-ssl-a',
        'persist:oauth-e2e-ssl-b',
        'persist:oauth-e2e-config-a',
        'persist:oauth-e2e-config-b',
      ]
      await Promise.all(allSessions.map((partition) => session.fromPartition(partition).clearStorageData()))
    })
  })

  test('completes the authorization_code flow end-to-end via the stubbed provider', async ({ window, stubServer }) => {
    const configId = await window.evaluate(
      async (args: { name: string; grantType: string; clientId: string; tokenUrl: string; authUrl: string; redirectUri: string; scopes: string }) => {
        const res = await window.api.oauth.configs.create(args)
        return (res as { data: { id: string } }).data.id
      },
      {
        name: 'E2E Full Flow',
        grantType: 'authorization_code',
        clientId: 'e2e-client',
        tokenUrl: `${stubServer.baseUrl}/oauth2/token`,
        authUrl: authServer.url,
        redirectUri: REDIRECT_URI,
        scopes: 'read',
      },
    )

    const result = await window.evaluate(async (id: string) => {
      return window.api.oauth.authorize({ configId: id })
    }, configId)

    expect((result as { data: { accessToken: string; tokenType: string } }).data.accessToken).toBe('e2e-access-token')
    expect((result as { data: { accessToken: string; tokenType: string } }).data.tokenType).toBe('Bearer')

    const requests = await stubServer.waitForRequests(tokenEndpoint, 1)
    expect(requests).toHaveLength(1)

    await window.evaluate(async (id: string) => {
      await window.api.oauth.configs.delete({ id })
    }, configId)
  })

  test('IDP session cookie set during first auth is present before second auth', async ({ window, electronApp, stubServer }) => {
    const configId = await window.evaluate(
      async (args: { name: string; grantType: string; clientId: string; tokenUrl: string; authUrl: string; redirectUri: string; scopes: string }) => {
        const res = await window.api.oauth.configs.create(args)
        return (res as { data: { id: string } }).data.id
      },
      {
        name: 'E2E Persistence',
        grantType: 'authorization_code',
        clientId: 'e2e-client',
        tokenUrl: `${stubServer.baseUrl}/oauth2/token`,
        authUrl: authServer.url,
        redirectUri: REDIRECT_URI,
        scopes: 'read',
      },
    )

    await window.evaluate(async (id: string) => {
      await window.api.oauth.authorize({ configId: id })
    }, configId)

    const cookiesAfterFirst = await electronApp.evaluate(
      async ({ session }, id: string) => session.fromPartition(`persist:oauth-${id}`).cookies.get({ name: 'idp-session' }),
      configId,
    )
    expect(cookiesAfterFirst).toHaveLength(1)
    expect(cookiesAfterFirst[0].value).toBe('active')

    await window.evaluate(async (id: string) => {
      await window.api.oauth.authorize({ configId: id })
    }, configId)

    const cookiesAfterSecond = await electronApp.evaluate(
      async ({ session }, id: string) => session.fromPartition(`persist:oauth-${id}`).cookies.get({ name: 'idp-session' }),
      configId,
    )
    expect(cookiesAfterSecond).toHaveLength(1)
    expect(cookiesAfterSecond[0].value).toBe('active')

    const requests = await stubServer.waitForRequests(tokenEndpoint, 2)
    expect(requests).toHaveLength(2)

    await window.evaluate(async (id: string) => {
      await window.api.oauth.clearToken({ configId: id })
      await window.api.oauth.configs.delete({ id })
    }, configId)
  })

  test('surfaces the provider error when the token endpoint returns 503', async ({ window, stubServer }) => {
    const unavailableTokenEndpoint = await stubServer.stub({
      method: 'POST',
      path: '/oauth2/token-down',
      response: {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
        body: {
          error: 'temporarily_unavailable',
          error_description: 'Auth server down',
        },
      },
    })

    const configId = await window.evaluate(
      async (args: { name: string; grantType: string; clientId: string; tokenUrl: string; authUrl: string; redirectUri: string; scopes: string }) => {
        const res = await window.api.oauth.configs.create(args)
        return (res as { data: { id: string } }).data.id
      },
      {
        name: 'E2E Error Test',
        grantType: 'authorization_code',
        clientId: 'e2e-client',
        tokenUrl: `${stubServer.baseUrl}/oauth2/token-down`,
        authUrl: authServer.url,
        redirectUri: REDIRECT_URI,
        scopes: 'read',
      },
    )

    const result = await window.evaluate(async (id: string) => {
      return window.api.oauth.authorize({ configId: id })
    }, configId)

    expect((result as { error: string }).error).toContain('503')
    expect(await stubServer.waitForRequests(unavailableTokenEndpoint, 1)).toHaveLength(1)

    await window.evaluate(async (id: string) => {
      await window.api.oauth.configs.delete({ id })
    }, configId)
  })

  test('SSL-disabled config session is isolated from the SSL-enabled session', async ({ electronApp }) => {
    const id = 'e2e-ssl-a'
    const { enabledCookies, disabledCookies } = await electronApp.evaluate(
      async ({ session }, configId: string) => {
        await session.fromPartition(`persist:oauth-${configId}`).cookies.set({
          url: 'https://idp.example.com',
          name: 'sid',
          value: 'ssl-on',
        })
        return {
          enabledCookies: await session.fromPartition(`persist:oauth-${configId}`).cookies.get({ name: 'sid' }),
          disabledCookies: await session.fromPartition(`persist:oauth-ssl-disabled-${configId}`).cookies.get({ name: 'sid' }),
        }
      },
      id,
    )

    expect(enabledCookies).toHaveLength(1)
    expect(disabledCookies).toHaveLength(0)
  })

  test('different OAuth configs have completely isolated sessions', async ({ electronApp }) => {
    const { cookiesA, cookiesB } = await electronApp.evaluate(async ({ session }) => {
      await session.fromPartition('persist:oauth-e2e-config-a').cookies.set({
        url: 'https://idp.example.com',
        name: 'sid',
        value: 'config-a',
      })
      return {
        cookiesA: await session.fromPartition('persist:oauth-e2e-config-a').cookies.get({ name: 'sid' }),
        cookiesB: await session.fromPartition('persist:oauth-e2e-config-b').cookies.get({ name: 'sid' }),
      }
    })

    expect(cookiesA).toHaveLength(1)
    expect(cookiesA[0].value).toBe('config-a')
    expect(cookiesB).toHaveLength(0)
  })
})
