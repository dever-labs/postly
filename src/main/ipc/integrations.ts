import { ipcMain } from 'electron'
import crypto from 'crypto'
import { queryAll, queryOne, run } from '../database'
import { startGitHubOAuth, startGitLabOAuth } from '../services/scm-oauth'

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

      if (type === 'github') {
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
      run('UPDATE integrations SET status = ?, error_message = ?, updated_at = ? WHERE id = ?',
        ['error', String(err), Date.now(), args.id])
      return { error: String(err) }
    }
  })

  ipcMain.handle('postly:integrations:disconnect', async (_, args: { id: string }) => {
    try {
      run('UPDATE integrations SET token = ?, connected_user = ?, status = ?, updated_at = ? WHERE id = ?',
        ['', '', 'disconnected', Date.now(), args.id])
      return { data: true }
    } catch (err) { return { error: String(err) } }
  })
}
