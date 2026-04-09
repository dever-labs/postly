import { ipcMain } from 'electron'
import crypto from 'crypto'
import { queryAll, queryOne, run } from '../database'
import { startGitHubOAuth, startGitLabOAuth, requestGitHubDeviceCode, pollGitHubDeviceToken, requestGitLabDeviceCode, pollGitLabDeviceToken } from '../services/scm-oauth'
import { testConnectivity } from '../services/git-local'

// Temporary store for in-progress device flows (integrationId → DeviceCodeInfo)
const pendingDeviceFlows = new Map<string, { deviceCode: string; interval: number; expiresIn: number; clientId: string; baseUrl: string; type: string }>()

export function registerIntegrationHandlers(): void {
  ipcMain.handle('postly:integrations:list', async () => {
    try {
      return { data: queryAll('SELECT * FROM integrations ORDER BY created_at ASC') }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:integrations:create', async (_, args: {
    type: string; name: string; baseUrl: string; clientId?: string; clientSecret?: string; repo?: string; branch?: string
  }) => {
    try {
      if (args.repo) {
        try { new URL(args.repo) } catch {
          return { error: 'Invalid repository URL' }
        }
      }
      if (args.baseUrl) {
        try { new URL(args.baseUrl) } catch {
          return { error: 'Invalid base URL' }
        }
      }
      const id = crypto.randomUUID()
      const now = Date.now()
      run(`INSERT INTO integrations (id, type, name, base_url, client_id, client_secret, repo, branch, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'disconnected', ?, ?)`,
        [id, args.type, args.name, args.baseUrl, args.clientId ?? '', args.clientSecret ?? '', args.repo ?? '', args.branch ?? 'main', now, now])
      return { data: queryOne('SELECT * FROM integrations WHERE id = ?', [id]) }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:integrations:update', async (_, args: { id: string; [key: string]: unknown }) => {
    try {
      const allowed = ['name', 'base_url', 'client_id', 'client_secret', 'repo', 'branch', 'token', 'connected_user', 'status', 'error_message']
      const fields: string[] = []
      const values: unknown[] = []
      for (const key of allowed) {
        const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
        if (args[key] !== undefined) { fields.push(`${key} = ?`); values.push(args[key]) }
        else if (args[camel] !== undefined) { fields.push(`${key} = ?`); values.push(args[camel]) }
      }
      if (fields.length === 0) return { data: true }
      fields.push('updated_at = ?'); values.push(Date.now(), args.id)
      run(`UPDATE integrations SET ${fields.join(', ')} WHERE id = ?`, values)
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:integrations:delete', async (_, args: { id: string }) => {
    try {
      run('DELETE FROM integrations WHERE id = ?', [args.id])
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:integrations:connect', async (_, args: { id: string }) => {
    try {
      const integration = queryOne<Record<string, unknown>>('SELECT * FROM integrations WHERE id = ?', [args.id])
      if (!integration) return { error: 'Integration not found' }

      const type = integration.type as string
      let token = '', connectedUserJson = ''

      if (type === 'git') {
        // Uses system git credentials — test connectivity and detect default branch
        const { name, defaultBranch } = await testConnectivity(integration.repo as string)
        connectedUserJson = JSON.stringify({ name, avatarUrl: '' })
        token = ''
        // Store the detected default branch so discoverAndImport uses the right one
        run('UPDATE integrations SET branch = ?, updated_at = ? WHERE id = ?',
          [defaultBranch, Date.now(), args.id])
      } else if (type === 'github') {
        const result = await startGitHubOAuth({
          baseUrl: integration.base_url as string,
          clientId: integration.client_id as string,
          clientSecret: integration.client_secret as string,
        })
        token = result.token
        connectedUserJson = JSON.stringify(result.user)
      } else if (type === 'gitlab') {
        const result = await startGitLabOAuth({
          baseUrl: integration.base_url as string,
          clientId: integration.client_id as string,
        })
        token = result.token
        connectedUserJson = JSON.stringify(result.user)
      } else if (type === 'backstage') {
        token = (integration.token as string) ?? ''
        connectedUserJson = JSON.stringify({ login: 'backstage', name: 'Backstage', avatarUrl: '' })
      }

      run('UPDATE integrations SET token = ?, connected_user = ?, status = ?, error_message = ?, updated_at = ? WHERE id = ?',
        [token, connectedUserJson, 'connected', '', Date.now(), args.id])
      return { data: queryOne('SELECT * FROM integrations WHERE id = ?', [args.id]) }
    } catch (err) {
      const message = String(err).includes('block timeout reached')
        ? 'Connection timed out. The credential dialog may have been cancelled or the server is unreachable.'
        : String(err)
      run('UPDATE integrations SET status = ?, error_message = ?, updated_at = ? WHERE id = ?',
        ['error', message, Date.now(), args.id])
      return { error: message }
    }
  })

  ipcMain.handle('postly:integrations:disconnect', async (_, args: { id: string }) => {
    try {
      run('UPDATE integrations SET token = ?, connected_user = ?, status = ?, updated_at = ? WHERE id = ?',
        ['', '', 'disconnected', Date.now(), args.id])
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })

  // ── Device Flow ──────────────────────────────────────────────────────────────

  ipcMain.handle('postly:integrations:device-init', async (_, args: { id: string }) => {
    try {
      const integration = queryOne<Record<string, unknown>>('SELECT * FROM integrations WHERE id = ?', [args.id])
      if (!integration) return { error: 'Integration not found' }

      const type = integration.type as string
      const baseUrl = integration.base_url as string
      const clientId = integration.client_id as string

      if (!clientId) return { error: 'Client ID is required for Device Flow' }

      let info
      if (type === 'github') info = await requestGitHubDeviceCode({ baseUrl, clientId })
      else if (type === 'gitlab') info = await requestGitLabDeviceCode({ baseUrl, clientId })
      else return { error: 'Device flow not supported for this integration type' }

      pendingDeviceFlows.set(args.id, { deviceCode: info.deviceCode, interval: info.interval, expiresIn: info.expiresIn, clientId, baseUrl, type })

      return { data: { userCode: info.userCode, verificationUri: info.verificationUri, expiresIn: info.expiresIn } }
    } catch (err) { return { error: String(err) } }
  })

  ipcMain.handle('postly:integrations:device-poll', async (_, args: { id: string }) => {
    try {
      const pending = pendingDeviceFlows.get(args.id)
      if (!pending) return { error: 'No pending device flow for this integration' }

      let token = '', connectedUserJson = ''

      if (pending.type === 'github') {
        const result = await pollGitHubDeviceToken({ baseUrl: pending.baseUrl, clientId: pending.clientId, deviceCode: pending.deviceCode, interval: pending.interval, expiresIn: pending.expiresIn })
        token = result.token
        connectedUserJson = JSON.stringify(result.user)
      } else if (pending.type === 'gitlab') {
        const result = await pollGitLabDeviceToken({ baseUrl: pending.baseUrl, clientId: pending.clientId, deviceCode: pending.deviceCode, interval: pending.interval, expiresIn: pending.expiresIn })
        token = result.token
        connectedUserJson = JSON.stringify(result.user)
      }

      pendingDeviceFlows.delete(args.id)
      run('UPDATE integrations SET token = ?, connected_user = ?, status = ?, error_message = ?, updated_at = ? WHERE id = ?',
        [token, connectedUserJson, 'connected', '', Date.now(), args.id])
      return { data: queryOne('SELECT * FROM integrations WHERE id = ?', [args.id]) }
    } catch (err) {
      pendingDeviceFlows.delete(args.id)
      run('UPDATE integrations SET status = ?, error_message = ?, updated_at = ? WHERE id = ?',
        ['error', String(err), Date.now(), args.id])
      return { error: String(err) }
    }
  })
}
