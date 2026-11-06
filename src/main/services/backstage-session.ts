/**
 * Keeps the OAuth tokens of Backstage sources (authProvider 'oauth') fresh.
 *
 * Tokens live in the integrations table next to the other integration
 * secrets: the database file is encrypted with a key held by the OS keychain
 * (safeStorage, see database/db-crypto.ts), and the renderer never sees them
 * (integrations IPC strips secret columns).
 */
import { queryOne, run } from '../database'
import {
  discoverAuthorizationServer, isUnauthorizedError, refreshAccessToken, revokeToken,
  type OAuthTokens,
} from './backstage-oauth'

/** Refresh this long before the access token expires. */
const REFRESH_SKEW_MS = 60_000

interface TokenRow {
  id: string
  base_url: string
  client_id?: string
  token?: string
  refresh_token?: string
  token_expires_at?: number
  ssl_verification?: string
}

function readRow(integrationId: string): TokenRow {
  const row = queryOne<TokenRow>(
    'SELECT id, base_url, client_id, token, refresh_token, token_expires_at, ssl_verification FROM integrations WHERE id = ?',
    [integrationId],
  )
  if (!row) throw new Error('Integration not found')
  return row
}

const sslOptions = (row: TokenRow) => ({ sslVerification: row.ssl_verification !== 'disabled' })

export function saveOAuthTokens(integrationId: string, tokens: OAuthTokens): void {
  run('UPDATE integrations SET token = ?, refresh_token = ?, token_expires_at = ?, updated_at = ? WHERE id = ?',
    [tokens.accessToken, tokens.refreshToken ?? '', tokens.expiresAt, Date.now(), integrationId])
}

export function clearOAuthTokens(integrationId: string): void {
  run('UPDATE integrations SET token = ?, refresh_token = ?, token_expires_at = ?, updated_at = ? WHERE id = ?',
    ['', '', 0, Date.now(), integrationId])
}

// Refresh tokens rotate, so two concurrent refreshes would invalidate each other: one at a time per source.
const inflight = new Map<string, Promise<string>>()

/** Exchanges the stored refresh token for a new access token (and rotated refresh token). */
export function refreshIntegrationToken(integrationId: string): Promise<string> {
  const pending = inflight.get(integrationId)
  if (pending) return pending
  const task = (async () => {
    const row = readRow(integrationId)
    if (!row.refresh_token) throw new Error('Signed out of Backstage — sign in again')
    const meta = await discoverAuthorizationServer(row.base_url, sslOptions(row))
    try {
      const tokens = await refreshAccessToken(meta, row.refresh_token, sslOptions(row))
      saveOAuthTokens(integrationId, tokens)
      return tokens.accessToken
    } catch (err) {
      if ((err as { oauthError?: string }).oauthError === 'invalid_grant') {
        // Expired or revoked: the session is gone, so don't keep retrying with it.
        clearOAuthTokens(integrationId)
        run('UPDATE integrations SET status = ?, error_message = ?, updated_at = ? WHERE id = ?',
          ['disconnected', 'Backstage session expired — sign in again', Date.now(), integrationId])
        throw new Error('Backstage session expired — sign in again', { cause: err })
      }
      throw err
    }
  })().finally(() => inflight.delete(integrationId))
  inflight.set(integrationId, task)
  return task
}

/** A usable access token for an OAuth source, refreshed first when it is (about to be) expired. */
export async function getBackstageAccessToken(integrationId: string, now = Date.now()): Promise<string> {
  const row = readRow(integrationId)
  const expiresAt = Number(row.token_expires_at ?? 0)
  const expiring = expiresAt > 0 && expiresAt - REFRESH_SKEW_MS <= now
  if (row.token && !expiring) return row.token
  if (row.refresh_token) return refreshIntegrationToken(integrationId)
  if (row.token) return row.token
  throw new Error('Not signed in to Backstage')
}

/** Runs `fn` with a fresh token; on a 401 refreshes once and retries. */
export async function withBackstageAccessToken<T>(integrationId: string, fn: (token: string) => Promise<T>): Promise<T> {
  const token = await getBackstageAccessToken(integrationId)
  try {
    return await fn(token)
  } catch (err) {
    if (!isUnauthorizedError(err) || !readRow(integrationId).refresh_token) throw err
    return fn(await refreshIntegrationToken(integrationId))
  }
}

/** Sign-out: revoke the refresh token at the server (best effort) and forget both tokens. */
export async function signOutBackstageOAuth(integrationId: string): Promise<void> {
  const row = queryOne<TokenRow>(
    'SELECT id, base_url, client_id, token, refresh_token, token_expires_at, ssl_verification FROM integrations WHERE id = ?',
    [integrationId],
  )
  if (!row) return
  if (row.refresh_token) {
    try {
      const meta = await discoverAuthorizationServer(row.base_url, sslOptions(row))
      await revokeToken(meta, row.refresh_token, sslOptions(row))
    } catch (err) {
      console.warn('[Backstage] token revocation failed:', err instanceof Error ? err.message : String(err))
    }
  }
  clearOAuthTokens(integrationId)
}
