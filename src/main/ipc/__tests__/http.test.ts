import { describe, it, expect, vi, beforeEach } from 'vitest'

// Capture registered handlers by channel so tests can call them directly.
// The object must be declared before vi.mock so the factory closes over the reference.
const state: {
  handlers: Record<string, (ev: unknown, req: unknown) => Promise<Record<string, unknown>>>
} = { handlers: {} }

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((ch: string, handler: (ev: unknown, req: unknown) => Promise<Record<string, unknown>>) => {
      state.handlers[ch] = handler
    })
  }
}))

vi.mock('../../database', () => ({
  queryOne: vi.fn(),
  queryAll: vi.fn()
}))

vi.mock('../../services/http-executor', () => ({
  executeRequest: vi.fn()
}))

vi.mock('../../services/oauth', () => ({
  getValidTokenForConfig: vi.fn(),
  authorizeInline: vi.fn()
}))

import { registerHttpHandlers } from '../http'
import { queryOne, queryAll } from '../../database'
import { executeRequest } from '../../services/http-executor'
import { getValidTokenForConfig, authorizeInline } from '../../services/oauth'

const mockQ1 = vi.mocked(queryOne)
const mockQA = vi.mocked(queryAll)
const mockExec = vi.mocked(executeRequest)
const mockGetToken = vi.mocked(getValidTokenForConfig)
const mockAuthorize = vi.mocked(authorizeInline)

type LogEntry = { level: string; message: string; detail?: string }
type Result = { data?: Record<string, unknown> & { logs: LogEntry[] }; error?: string; logs?: LogEntry[] }

// ── Helpers ──────────────────────────────────────────────────────────────────

function setupDb({
  envName = null as string | null,
  envVars = [] as { key: string; value: string }[],
  folder = null as Record<string, unknown> | null,
  collection = null as Record<string, unknown> | null,
  integration = null as Record<string, unknown> | null,
  settings = null as string | null,
} = {}) {
  mockQ1.mockImplementation((sql: string) => {
    if (sql.includes('environments')) return envName ? { id: 'e1', name: envName } : null
    if (sql.includes('integrations')) return integration
    if (sql.includes('settings')) return settings ? { value: settings } : null
    return null
  })
  mockQA.mockImplementation((sql: string) => {
    if (sql.includes('env_vars')) return envVars
    if (sql.includes('WITH RECURSIVE lineage')) {
      if (!folder) return []
      // Build a lineage array: [direct folder, ..., root collection]
      // If folder == collection (or collection is null), just one row as root
      const rows: { id: string; name: string; parent_id: string | null; auth_type: string | null; auth_config: string | null; ssl_verification: string | null; integration_id: string | null }[] = []
      if (collection && collection.id !== folder.id) {
        rows.push({
          id: String(folder.id ?? 'f1'),
          name: String(folder.name ?? 'Folder'),
          parent_id: String(collection.id ?? 'c1'),
          auth_type: (folder.auth_type as string | null) ?? null,
          auth_config: (folder.auth_config as string | null) ?? null,
          ssl_verification: (folder.ssl_verification as string | null) ?? null,
          integration_id: null,
        })
        rows.push({
          id: String(collection.id ?? 'c1'),
          name: String(collection.name ?? 'Collection'),
          parent_id: null,
          auth_type: (collection.auth_type as string | null) ?? null,
          auth_config: (collection.auth_config as string | null) ?? null,
          ssl_verification: (collection.ssl_verification as string | null) ?? null,
          integration_id: (collection.integration_id as string | null) ?? null,
        })
      } else {
        rows.push({
          id: String(folder.id ?? 'c1'),
          name: String(folder.name ?? 'Collection'),
          parent_id: null,
          auth_type: ((folder.auth_type ?? collection?.auth_type) as string | null) ?? null,
          auth_config: ((folder.auth_config ?? collection?.auth_config) as string | null) ?? null,
          ssl_verification: ((folder.ssl_verification ?? collection?.ssl_verification) as string | null) ?? null,
          integration_id: (collection?.integration_id as string | null) ?? null,
        })
      }
      return rows
    }
    return []
  })
}

function baseReq(overrides: Record<string, unknown> = {}) {
  return {
    method: 'GET',
    url: 'https://api.example.com/users',
    headers: {} as Record<string, string>,
    bodyType: 'none',
    authType: 'none',
    authConfig: {} as Record<string, string>,
    ...overrides
  }
}

function baseResp() {
  return { status: 200, statusText: 'OK', headers: {}, body: '{"ok":true}', duration: 50, size: 12 }
}

async function invoke(req: unknown): Promise<Result> {
  const handler = state.handlers['postly:http:execute']
  if (!handler) throw new Error('postly:http:execute handler not registered')
  return handler(null, req) as Promise<Result>
}

async function invokeCancel(): Promise<void> {
  const cancelHandler = state.handlers['postly:http:cancel']
  if (!cancelHandler) throw new Error('postly:http:cancel handler not registered')
  await cancelHandler(null, null as never)
}

/** Asserts the invocation succeeded and returns the data object (never null). */
async function invokeOk(req: unknown): Promise<Record<string, unknown> & { logs: LogEntry[] }> {
  const result = await invoke(req)
  if (result.error || !result.data) throw new Error(result.error ?? 'No data returned')
  return result.data
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('http IPC handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.handlers = {}
    setupDb()
    mockExec.mockResolvedValue(baseResp())
    registerHttpHandlers()
  })

  // ── Environment ────────────────────────────────────────────────────────────

  describe('environment variables', () => {
    it('logs "No active environment" when none is active', async () => {
      const data = await invokeOk(baseReq())
      expect(data.logs).toContainEqual(expect.objectContaining({ level: 'info', message: 'No active environment' }))
    })

    it('logs environment name and plural variable count', async () => {
      setupDb({
        envName: 'Staging',
        envVars: [{ key: 'A', value: '1' }, { key: 'B', value: '2' }]
      })
      const data = await invokeOk(baseReq())
      expect(data.logs).toContainEqual(expect.objectContaining({ message: 'Environment: "Staging" (2 variables)' }))
    })

    it('uses singular "variable" for one var', async () => {
      setupDb({ envName: 'Dev', envVars: [{ key: 'X', value: 'y' }] })
      const data = await invokeOk(baseReq())
      expect(data.logs).toContainEqual(expect.objectContaining({ message: 'Environment: "Dev" (1 variable)' }))
    })

    it('interpolates {{VAR}} in the URL before executing', async () => {
      setupDb({ envName: 'Dev', envVars: [{ key: 'HOST', value: 'https://dev.api.com' }] })
      await invoke(baseReq({ url: '{{HOST}}/users' }))
      const [calledReq] = mockExec.mock.calls[0]
      expect(calledReq.url).toBe('https://dev.api.com/users')
    })

    it('interpolates {{VAR}} in header values', async () => {
      setupDb({ envName: 'Dev', envVars: [{ key: 'TOKEN', value: 'secret-123' }] })
      await invoke(baseReq({ headers: { Authorization: 'Bearer {{TOKEN}}' } }))
      const [calledReq] = mockExec.mock.calls[0]
      expect(calledReq.headers['Authorization']).toBe('Bearer secret-123')
    })

    it('logs the total interpolated variable count across URL and headers', async () => {
      setupDb({ envName: 'Dev', envVars: [{ key: 'HOST', value: 'h' }, { key: 'TOKEN', value: 't' }] })
      const data = await invokeOk(baseReq({
        url: '{{HOST}}/path',
        headers: { Authorization: 'Bearer {{TOKEN}}' }
      }))
      expect(data.logs).toContainEqual(expect.objectContaining({ message: 'Interpolated 2 environment variables' }))
    })

    it('leaves unresolved {{VAR}} in URL unchanged', async () => {
      setupDb({ envName: 'Dev', envVars: [] })
      await invoke(baseReq({ url: '{{MISSING}}/path' }))
      const [calledReq] = mockExec.mock.calls[0]
      expect(calledReq.url).toBe('{{MISSING}}/path')
    })
  })

  // ── Auth resolution ────────────────────────────────────────────────────────

  describe('auth resolution', () => {
    it('logs "Auth: none" when authType is none', async () => {
      const data = await invokeOk(baseReq({ authType: 'none' }))
      expect(data.logs).toContainEqual(expect.objectContaining({ message: 'Auth: none' }))
    })

    it('logs auth type when set directly on the request', async () => {
      const data = await invokeOk(baseReq({ authType: 'bearer', authConfig: { token: 'tok' } }))
      expect(data.logs).toContainEqual(expect.objectContaining({ message: 'Auth: bearer' }))
    })

    it('inherits bearer auth from the folder when request is "inherit"', async () => {
      setupDb({
        folder: {
          id: 'f1', name: 'My Folder', auth_type: 'bearer',
          auth_config: '{"token":"grp-tok"}', parent_id: null
        }
      })
      const data = await invokeOk(baseReq({ authType: 'inherit', folderId: 'f1' }))
      expect(data.logs).toContainEqual(expect.objectContaining({
        message: 'Auth: bearer (inherited from folder "My Folder")'
      }))
      const [calledReq] = mockExec.mock.calls[0]
      expect(calledReq.authConfig.token).toBe('grp-tok')
    })

    it('inherits auth from collection when folder has no auth', async () => {
      setupDb({
        folder: { id: 'f1', name: 'F', auth_type: 'inherit', parent_id: 'c1' },
        collection: {
          id: 'c1', name: 'My API', auth_type: 'bearer',
          auth_config: '{"token":"col-tok"}', integration_id: null
        }
      })
      const data = await invokeOk(baseReq({ authType: 'inherit', folderId: 'f1' }))
      expect(data.logs).toContainEqual(expect.objectContaining({
        message: 'Auth: bearer (inherited from collection "My API")'
      }))
      const [calledReq] = mockExec.mock.calls[0]
      expect(calledReq.authConfig.token).toBe('col-tok')
    })

    it('inherits auth from the nearest non-inherit ancestor in a 3-level lineage', async () => {
      const lineage = [
        {
          id: 'leaf-1',
          name: 'Leaf Folder',
          parent_id: 'mid-1',
          auth_type: 'inherit',
          auth_config: null,
          ssl_verification: null,
          integration_id: null,
        },
        {
          id: 'mid-1',
          name: 'Intermediate Folder',
          parent_id: 'root-1',
          auth_type: 'bearer',
          auth_config: '{"token":"mid-tok"}',
          ssl_verification: null,
          integration_id: null,
        },
        {
          id: 'root-1',
          name: 'Root Collection',
          parent_id: null,
          auth_type: 'basic',
          auth_config: '{"username":"root","password":"secret"}',
          ssl_verification: null,
          integration_id: null,
        },
      ]

      mockQA.mockImplementation((sql: string) => {
        if (sql.includes('env_vars')) return []
        if (sql.includes('WITH RECURSIVE lineage')) return lineage
        return []
      })

      const data = await invokeOk(baseReq({ authType: 'inherit', folderId: 'leaf-1' }))
      expect(data.logs).toContainEqual(expect.objectContaining({
        message: 'Auth: bearer (inherited from folder "Intermediate Folder")'
      }))
      const [calledReq] = mockExec.mock.calls[0]
      expect(calledReq.authType).toBe('bearer')
      expect(calledReq.authConfig.token).toBe('mid-tok')
    })

    it('uses the nearest non-inherit SSL setting from an intermediate folder in a 3-level lineage', async () => {
      const lineage = [
        {
          id: 'leaf-1',
          name: 'Leaf Folder',
          parent_id: 'mid-1',
          auth_type: null,
          auth_config: null,
          ssl_verification: 'inherit',
          integration_id: null,
        },
        {
          id: 'mid-1',
          name: 'Intermediate Folder',
          parent_id: 'root-1',
          auth_type: null,
          auth_config: null,
          ssl_verification: 'disabled',
          integration_id: null,
        },
        {
          id: 'root-1',
          name: 'Root Collection',
          parent_id: null,
          auth_type: null,
          auth_config: null,
          ssl_verification: 'enabled',
          integration_id: null,
        },
      ]

      mockQA.mockImplementation((sql: string) => {
        if (sql.includes('env_vars')) return []
        if (sql.includes('WITH RECURSIVE lineage')) return lineage
        return []
      })

      const data = await invokeOk(baseReq({ folderId: 'leaf-1', sslVerification: 'inherit' }))
      expect(mockExec).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ sslVerification: false })
      )
      expect(data.logs).toContainEqual(expect.objectContaining({
        level: 'warn',
        message: 'SSL verification disabled (folder "Intermediate Folder")'
      }))
    })

    it('labels an intermediate inherited auth source as a folder, not a collection', async () => {
      const lineage = [
        {
          id: 'leaf-1',
          name: 'Leaf Folder',
          parent_id: 'mid-1',
          auth_type: 'inherit',
          auth_config: null,
          ssl_verification: null,
          integration_id: null,
        },
        {
          id: 'mid-1',
          name: 'Intermediate Folder',
          parent_id: 'root-1',
          auth_type: 'bearer',
          auth_config: '{"token":"mid-tok"}',
          ssl_verification: null,
          integration_id: null,
        },
        {
          id: 'root-1',
          name: 'Root Collection',
          parent_id: null,
          auth_type: 'basic',
          auth_config: '{"username":"root","password":"secret"}',
          ssl_verification: null,
          integration_id: null,
        },
      ]

      mockQA.mockImplementation((sql: string) => {
        if (sql.includes('env_vars')) return []
        if (sql.includes('WITH RECURSIVE lineage')) return lineage
        return []
      })

      const data = await invokeOk(baseReq({ authType: 'inherit', folderId: 'leaf-1' }))
      expect(data.logs).toContainEqual(expect.objectContaining({
        message: 'Auth: bearer (inherited from folder "Intermediate Folder")'
      }))
      expect(data.logs).not.toContainEqual(expect.objectContaining({
        message: 'Auth: bearer (inherited from collection "Intermediate Folder")'
      }))
    })

    it('uses integration bearer token when collection has an integration', async () => {
      setupDb({
        folder: { id: 'f1', name: 'F', auth_type: null, parent_id: 'c1' },
        collection: { id: 'c1', name: 'Coll', auth_type: null, integration_id: 'i1' },
        integration: { id: 'i1', name: 'GitHub', token: 'int-tok' }
      })
      const data = await invokeOk(baseReq({ authType: 'inherit', folderId: 'f1' }))
      expect(data.logs).toContainEqual(expect.objectContaining({
        message: 'Auth: bearer (inherited from integration "GitHub")'
      }))
      const [calledReq] = mockExec.mock.calls[0]
      expect(calledReq.authConfig.token).toBe('int-tok')
    })

    it('falls back to "Auth: none" when full inherit chain has no auth', async () => {
      setupDb({ folder: { id: 'f1', name: 'F', auth_type: null, parent_id: null } })
      const data = await invokeOk(baseReq({ authType: 'inherit', folderId: 'f1' }))
      expect(data.logs).toContainEqual(expect.objectContaining({ message: 'Auth: none' }))
    })
  })

  // ── OAuth token resolution ─────────────────────────────────────────────────

  describe('OAuth token resolution', () => {
    const oauthCfg = {
      grantType: 'client_credentials',
      clientId: 'my-client',
      clientSecret: 'secret',
      tokenUrl: 'https://auth.example.com/token',
      scopes: 'openid',
      redirectUri: 'http://localhost:9876/callback'
    }

    it('returns error when clientId is missing', async () => {
      const { error } = await invoke(baseReq({ authType: 'oauth2', authConfig: { tokenUrl: 'https://auth.example.com/token' } }))
      expect(error).toContain('clientId and tokenUrl are required')
    })

    it('uses cached token without calling authorizeInline', async () => {
      mockGetToken.mockResolvedValue({
        id: 't1', oauthConfigId: '', accessToken: 'cached-tok',
        tokenType: 'Bearer', expiresAt: Date.now() + 3_600_000, createdAt: Date.now()
      })
      const data = await invokeOk(baseReq({ authType: 'oauth2', authConfig: oauthCfg }))
      expect(data.logs).toContainEqual(expect.objectContaining({
        level: 'info', message: expect.stringContaining('using cached token')
      }))
      expect(mockAuthorize).not.toHaveBeenCalled()
    })

    it('fetches a new token when nothing is cached', async () => {
      mockGetToken.mockResolvedValue(null)
      mockAuthorize.mockResolvedValue({ id: 't1', oauthConfigId: '', accessToken: 'fresh-tok', tokenType: 'Bearer', createdAt: Date.now() })
      const data = await invokeOk(baseReq({ authType: 'oauth2', authConfig: oauthCfg }))
      expect(data.logs).toContainEqual(expect.objectContaining({
        message: expect.stringContaining('no cached token')
      }))
      expect(data.logs).toContainEqual(expect.objectContaining({
        message: expect.stringContaining('new token obtained')
      }))
      const [calledReq] = mockExec.mock.calls[0]
      expect(calledReq.authConfig.token).toBe('fresh-tok')
    })

    it('returns error with logs when authorization throws', async () => {
      mockGetToken.mockResolvedValue(null)
      mockAuthorize.mockRejectedValue(new Error('User cancelled'))
      const { error, logs } = await invoke(baseReq({ authType: 'oauth2', authConfig: oauthCfg }))
      expect(error).toContain('OAuth authorization failed')
      expect(error).toContain('User cancelled')
      expect(logs).toContainEqual(expect.objectContaining({
        level: 'error', message: expect.stringContaining('User cancelled')
      }))
    })

    it('resolves token to bearer before executing request', async () => {
      mockGetToken.mockResolvedValue({ id: 't1', oauthConfigId: '', accessToken: 'my-tok', tokenType: 'Bearer', createdAt: Date.now() })
      await invoke(baseReq({ authType: 'oauth2', authConfig: oauthCfg }))
      const [calledReq] = mockExec.mock.calls[0]
      expect(calledReq.authType).toBe('bearer')
      expect(calledReq.authConfig.token).toBe('my-tok')
    })

    it('forwards sslVerification=true to getValidTokenForConfig by default', async () => {
      mockGetToken.mockResolvedValue({ id: 't1', oauthConfigId: '', accessToken: 'tok', tokenType: 'Bearer', createdAt: Date.now() })
      await invoke(baseReq({ authType: 'oauth2', authConfig: oauthCfg }))
      expect(mockGetToken).toHaveBeenCalledWith(expect.anything(), true)
    })

    it('forwards sslVerification=false to getValidTokenForConfig when global SSL is disabled', async () => {
      setupDb({ settings: '{"sslVerification":false}' })
      mockGetToken.mockResolvedValue({ id: 't1', oauthConfigId: '', accessToken: 'tok', tokenType: 'Bearer', createdAt: Date.now() })
      await invoke(baseReq({ authType: 'oauth2', authConfig: oauthCfg }))
      expect(mockGetToken).toHaveBeenCalledWith(expect.anything(), false)
    })

    it('forwards sslVerification=false to authorizeInline when no cached token and SSL is disabled', async () => {
      setupDb({ settings: '{"sslVerification":false}' })
      mockGetToken.mockResolvedValue(null)
      mockAuthorize.mockResolvedValue({ id: 't1', oauthConfigId: '', accessToken: 'tok', tokenType: 'Bearer', createdAt: Date.now() })
      await invoke(baseReq({ authType: 'oauth2', authConfig: oauthCfg }))
      expect(mockAuthorize).toHaveBeenCalledWith(expect.anything(), false)
    })

    it('passes parsed extraParams to getValidTokenForConfig', async () => {
      const extraParams = { audience: 'https://api.example.com', resource: 'my-api' }
      mockGetToken.mockResolvedValue({ id: 't1', oauthConfigId: '', accessToken: 'tok', tokenType: 'Bearer', createdAt: Date.now() })
      await invoke(baseReq({
        authType: 'oauth2',
        authConfig: { ...oauthCfg, extraParams: JSON.stringify(extraParams) }
      }))
      expect(mockGetToken).toHaveBeenCalledWith(
        expect.objectContaining({ extraParams }),
        expect.anything()
      )
    })

    it('passes parsed extraParams to authorizeInline when no cached token', async () => {
      const extraParams = { audience: 'https://api.example.com' }
      mockGetToken.mockResolvedValue(null)
      mockAuthorize.mockResolvedValue({ id: 't1', oauthConfigId: '', accessToken: 'tok', tokenType: 'Bearer', createdAt: Date.now() })
      await invoke(baseReq({
        authType: 'oauth2',
        authConfig: { ...oauthCfg, extraParams: JSON.stringify(extraParams) }
      }))
      expect(mockAuthorize).toHaveBeenCalledWith(
        expect.objectContaining({ extraParams }),
        expect.anything()
      )
    })

    it('handles malformed extraParams JSON without crashing', async () => {
      mockGetToken.mockResolvedValue({ id: 't1', oauthConfigId: '', accessToken: 'tok', tokenType: 'Bearer', createdAt: Date.now() })
      const data = await invokeOk(baseReq({
        authType: 'oauth2',
        authConfig: { ...oauthCfg, extraParams: 'not-json' }
      }))
      expect(data).toBeDefined()
      expect(mockGetToken).toHaveBeenCalledWith(
        expect.objectContaining({ extraParams: undefined }),
        expect.anything()
      )
    })
  })

  // ── SSL resolution ─────────────────────────────────────────────────────────

  describe('SSL resolution', () => {
    it('passes sslVerification=true to executor by default', async () => {
      await invoke(baseReq())
      expect(mockExec).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ sslVerification: true })
      )
    })

    it('passes sslVerification=false and warns when global setting disables SSL', async () => {
      setupDb({ settings: '{"sslVerification":false}' })
      const data = await invokeOk(baseReq())
      expect(mockExec).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ sslVerification: false })
      )
      expect(data.logs).toContainEqual(expect.objectContaining({
        level: 'warn', message: expect.stringContaining('SSL verification disabled')
      }))
    })

    it('does not log a SSL warning when SSL is enabled', async () => {
      setupDb({ settings: '{"sslVerification":true}' })
      const data = await invokeOk(baseReq())
      const warnLogs = (data.logs as LogEntry[]).filter((l) => l.level === 'warn')
      expect(warnLogs).toHaveLength(0)
    })
  })

  // ── Response and log structure ─────────────────────────────────────────────

  describe('response and log structure', () => {
    it('merges response fields with logs array on success', async () => {
      const data = await invokeOk(baseReq())
      expect(data).toMatchObject({ status: 200, statusText: 'OK', body: '{"ok":true}' })
      expect(Array.isArray(data.logs)).toBe(true)
    })

    it('returns error string and logs array on unexpected throw', async () => {
      mockExec.mockRejectedValue(new Error('Connection refused'))
      const { error, logs } = await invoke(baseReq())
      expect(error).toContain('Connection refused')
      expect(Array.isArray(logs)).toBe(true)
    })

    it('applies custom timeout from settings to executeRequest', async () => {
      setupDb({ settings: '{"defaultTimeout":5000}' })
      await invoke(baseReq())
      expect(mockExec).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ timeout: 5000 })
      )
    })

    it('disables follow-redirects when settings say so', async () => {
      setupDb({ settings: '{"followRedirects":false}' })
      await invoke(baseReq())
      expect(mockExec).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ followRedirects: false })
      )
    })
  })

  // ── Request cancellation ───────────────────────────────────────────────────

  describe('request cancellation', () => {
    it('passes an AbortSignal to executeRequest', async () => {
      await invoke(baseReq())
      expect(mockExec).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ signal: expect.objectContaining({ aborted: false }) })
      )
    })

    it('aborts in-flight request when cancel is called', async () => {
      let capturedSignal: AbortSignal | undefined

      mockExec.mockImplementation(async (_req, opts) => {
        capturedSignal = opts?.signal
        // Simulate a slow request that checks the signal
        await new Promise<void>((resolve) => setTimeout(resolve, 10))
        return baseResp()
      })

      const executePromise = invoke(baseReq())
      // Cancel while execute is still in progress
      await invokeCancel()
      await executePromise

      expect(capturedSignal?.aborted).toBe(true)
    })

    it('is a no-op when no request is in flight', async () => {
      // Should not throw when cancel is called with nothing in flight
      await expect(invokeCancel()).resolves.toBeUndefined()
    })

    it('clears currentAbortController after successful execution', async () => {
      await invoke(baseReq())
      // Second cancel should be a no-op (controller was cleared after first execute)
      await expect(invokeCancel()).resolves.toBeUndefined()
    })
  })
})
