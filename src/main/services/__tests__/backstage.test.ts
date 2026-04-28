import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}))

vi.mock('../../database', () => ({
  queryOne: vi.fn(),
  run: vi.fn(),
}))

vi.mock('electron', () => ({ BrowserWindow: vi.fn() }))

import axios from 'axios'
import { syncCatalog, authenticateWithBackstageGuest } from '../backstage'

const mockGet = vi.mocked(axios.get)
const mockPost = vi.mocked(axios.post)

const EMPTY_CATALOG = { data: [] }

const GUEST_RESPONSE = {
  data: {
    backstageIdentity: { token: 'guest-token' },
    profile: { displayName: 'Guest User', email: 'guest@example.com', picture: 'https://example.com/pic.png' },
  },
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── syncCatalog — SSL verification ──────────────────────────────────────────

describe('syncCatalog — SSL verification', () => {
  it('omits httpsAgent when sslVerification is true', async () => {
    mockGet.mockResolvedValue(EMPTY_CATALOG)
    await syncCatalog({ baseUrl: 'https://backstage.example.com', token: 'tok', autoSync: false, sslVerification: true })
    const config = mockGet.mock.calls[0][1] as Record<string, unknown>
    expect(config.httpsAgent).toBeUndefined()
  })

  it('omits httpsAgent when sslVerification is omitted (safe default)', async () => {
    mockGet.mockResolvedValue(EMPTY_CATALOG)
    await syncCatalog({ baseUrl: 'https://backstage.example.com', token: 'tok', autoSync: false })
    const config = mockGet.mock.calls[0][1] as Record<string, unknown>
    expect(config.httpsAgent).toBeUndefined()
  })

  it('sets httpsAgent on all axios.get calls when sslVerification is false', async () => {
    mockGet.mockResolvedValue(EMPTY_CATALOG)
    await syncCatalog({ baseUrl: 'https://backstage.example.com', token: 'tok', autoSync: false, sslVerification: false })
    // Both parallel calls (APIs + Components) must carry the agent
    expect(mockGet.mock.calls).toHaveLength(2)
    for (const call of mockGet.mock.calls) {
      expect((call[1] as Record<string, unknown>).httpsAgent).toBeDefined()
    }
  })

  it('sets Authorization header with token', async () => {
    mockGet.mockResolvedValue(EMPTY_CATALOG)
    await syncCatalog({ baseUrl: 'https://backstage.example.com', token: 'my-token', autoSync: false })
    const config = mockGet.mock.calls[0][1] as { headers: Record<string, string> }
    expect(config.headers['Authorization']).toBe('Bearer my-token')
  })

  it('calls the correct catalog endpoints', async () => {
    mockGet.mockResolvedValue(EMPTY_CATALOG)
    await syncCatalog({ baseUrl: 'https://backstage.example.com', token: 'tok', autoSync: false })
    const urls = mockGet.mock.calls.map((c) => c[0] as string)
    expect(urls).toContain('https://backstage.example.com/api/catalog/entities?filter=kind=API')
    expect(urls).toContain('https://backstage.example.com/api/catalog/entities?filter=kind=Component')
  })

  it('throws when baseUrl is empty', async () => {
    await expect(
      syncCatalog({ baseUrl: '', token: 'tok', autoSync: false }),
    ).rejects.toThrow('Backstage base URL is not configured')
  })

  it('throws when token provider requires a token but none is set', async () => {
    await expect(
      syncCatalog({ baseUrl: 'https://backstage.example.com', token: '', autoSync: false, authProvider: 'token' }),
    ).rejects.toThrow('Backstage token is not configured')
  })

  it('returns entitiesFound=0 when the catalog is empty', async () => {
    mockGet.mockResolvedValue(EMPTY_CATALOG)
    const result = await syncCatalog({ baseUrl: 'https://backstage.example.com', token: 'tok', autoSync: false })
    expect(result.entitiesFound).toBe(0)
    expect(result.synced).toBe(0)
    expect(result.errors).toHaveLength(0)
  })
})

// ── authenticateWithBackstageGuest — SSL verification ───────────────────────

describe('authenticateWithBackstageGuest — SSL verification', () => {
  it('omits httpsAgent when sslVerification is true', async () => {
    mockPost.mockResolvedValue(GUEST_RESPONSE)
    await authenticateWithBackstageGuest('https://backstage.example.com', { sslVerification: true })
    const config = mockPost.mock.calls[0][2] as Record<string, unknown>
    expect(config.httpsAgent).toBeUndefined()
  })

  it('omits httpsAgent when options are omitted (safe default)', async () => {
    mockPost.mockResolvedValue(GUEST_RESPONSE)
    await authenticateWithBackstageGuest('https://backstage.example.com')
    const config = mockPost.mock.calls[0][2] as Record<string, unknown>
    expect(config.httpsAgent).toBeUndefined()
  })

  it('sets httpsAgent when sslVerification is false', async () => {
    mockPost.mockResolvedValue(GUEST_RESPONSE)
    await authenticateWithBackstageGuest('https://backstage.example.com', { sslVerification: false })
    const config = mockPost.mock.calls[0][2] as Record<string, unknown>
    expect(config.httpsAgent).toBeDefined()
  })

  it('calls the guest/refresh endpoint on the correct base URL', async () => {
    mockPost.mockResolvedValue(GUEST_RESPONSE)
    await authenticateWithBackstageGuest('https://backstage.example.com/')
    expect(mockPost.mock.calls[0][0]).toBe('https://backstage.example.com/api/auth/guest/refresh')
  })

  it('returns token and user from response', async () => {
    mockPost.mockResolvedValue(GUEST_RESPONSE)
    const result = await authenticateWithBackstageGuest('https://backstage.example.com')
    expect(result.token).toBe('guest-token')
    expect(result.user.name).toBe('Guest User')
    expect(result.user.email).toBe('guest@example.com')
    expect(result.user.picture).toBe('https://example.com/pic.png')
  })

  it('throws when response has no token', async () => {
    mockPost.mockResolvedValue({ data: { backstageIdentity: {} } })
    await expect(
      authenticateWithBackstageGuest('https://backstage.example.com'),
    ).rejects.toThrow('Guest refresh did not return a token')
  })
})
