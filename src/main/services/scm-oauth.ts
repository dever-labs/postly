import { BrowserWindow, shell } from 'electron'
import http from 'http'
import crypto from 'crypto'
import axios from 'axios'

// ─── Shared helpers ───────────────────────────────────────────────────────────

async function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = http.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as { port: number }
      srv.close(() => resolve(addr.port))
    })
  })
}

async function waitForCallback(port: number, win: BrowserWindow): Promise<{ code: string; state: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:${port}`)
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<html><body><h2>Authentication successful! You can close this window.</h2></body></html>')
      server.close()
      if (code) resolve({ code, state: state ?? '' })
      else reject(new Error('No code in callback'))
    })
    server.listen(port, '127.0.0.1')
    server.on('error', reject)
    win.on('closed', () => { server.close(); reject(new Error('OAuth window was closed')) })
    setTimeout(() => { server.close(); reject(new Error('OAuth timeout')) }, 5 * 60 * 1000)
  })
}

// ─── Bundled Client IDs (registered once per product) ────────────────────────
// For github.com and gitlab.com, Postly ships with its own registered OAuth App
// client IDs so users never need to provide one. Self-hosted instances require
// the user to register Postly on their own server (shown in Advanced section).
//
// Replace these with your own registered app's Client IDs before distributing.
export const BUNDLED_CLIENT_IDS: Record<string, string> = {
  'https://github.com': process.env.POSTLY_GITHUB_CLIENT_ID ?? 'Ov23liYOURGITHUBCLIENTID',
  'https://gitlab.com': process.env.POSTLY_GITLAB_CLIENT_ID ?? 'YOUR_GITLAB_CLIENT_ID',
}

export function resolveClientId(_type: string, baseUrl: string, storedClientId: string): string {
  const normalized = baseUrl.replace(/\/$/, '').toLowerCase()
  return BUNDLED_CLIENT_IDS[normalized] ?? storedClientId
}

// ─── GitHub Device Flow ───────────────────────────────────────────────────────

export interface DeviceCodeInfo {
  deviceCode: string
  userCode: string
  verificationUri: string
  expiresIn: number
  interval: number
}

export async function requestGitHubDeviceCode(args: { baseUrl: string; clientId: string }): Promise<DeviceCodeInfo> {
  const base = args.baseUrl.replace(/\/$/, '')
  const res = await axios.post(
    `${base}/login/device/code`,
    { client_id: args.clientId, scope: 'repo read:org' },
    { headers: { Accept: 'application/json' } }
  )
  if (res.data.error) throw new Error(res.data.error_description ?? res.data.error)
  shell.openExternal(res.data.verification_uri)
  return {
    deviceCode: res.data.device_code,
    userCode: res.data.user_code,
    verificationUri: res.data.verification_uri,
    expiresIn: res.data.expires_in ?? 900,
    interval: res.data.interval ?? 5,
  }
}

export async function pollGitHubDeviceToken(args: {
  baseUrl: string; clientId: string; deviceCode: string; interval: number; expiresIn: number
}): Promise<{ token: string; user: { login: string; name: string; avatarUrl: string } }> {
  const base = args.baseUrl.replace(/\/$/, '')
  const deadline = Date.now() + args.expiresIn * 1000
  let interval = Math.max(args.interval, 5) * 1000

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval))
    const res = await axios.post(
      `${base}/login/oauth/access_token`,
      { client_id: args.clientId, device_code: args.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' },
      { headers: { Accept: 'application/json' } }
    )
    if (res.data.access_token) {
      const token = res.data.access_token as string
      const apiBase = base === 'https://github.com' ? 'https://api.github.com' : `${base}/api/v3`
      const u = (await axios.get(`${apiBase}/user`, { headers: { Authorization: `Bearer ${token}` } })).data
      return { token, user: { login: u.login, name: u.name ?? u.login, avatarUrl: u.avatar_url } }
    }
    if (res.data.error === 'slow_down') interval += 5000
    else if (res.data.error && res.data.error !== 'authorization_pending') {
      throw new Error(res.data.error_description ?? res.data.error)
    }
  }
  throw new Error('Device authorization timed out')
}

// ─── GitLab Device Flow ────────────────────────────────────────────────────────

export async function requestGitLabDeviceCode(args: { baseUrl: string; clientId: string }): Promise<DeviceCodeInfo> {
  const base = args.baseUrl.replace(/\/$/, '')
  const res = await axios.post(
    `${base}/oauth/authorize_device`,
    new URLSearchParams({ client_id: args.clientId, scope: 'api' }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' } }
  )
  if (res.data.error) throw new Error(res.data.error_description ?? res.data.error)
  const verificationUri = res.data.verification_uri_complete ?? res.data.verification_uri
  shell.openExternal(verificationUri)
  return {
    deviceCode: res.data.device_code,
    userCode: res.data.user_code,
    verificationUri,
    expiresIn: res.data.expires_in ?? 300,
    interval: res.data.interval ?? 5,
  }
}

export async function pollGitLabDeviceToken(args: {
  baseUrl: string; clientId: string; deviceCode: string; interval: number; expiresIn: number
}): Promise<{ token: string; user: { username: string; name: string; avatarUrl: string } }> {
  const base = args.baseUrl.replace(/\/$/, '')
  const deadline = Date.now() + args.expiresIn * 1000
  let interval = Math.max(args.interval, 5) * 1000

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval))
    const res = await axios.post(
      `${base}/oauth/token`,
      new URLSearchParams({ client_id: args.clientId, device_code: args.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, validateStatus: () => true }
    )
    if (res.data.access_token) {
      const token = res.data.access_token as string
      const u = (await axios.get(`${base}/api/v4/user`, { headers: { Authorization: `Bearer ${token}` } })).data
      return { token, user: { username: u.username, name: u.name, avatarUrl: u.avatar_url } }
    }
    if (res.data.error === 'slow_down') interval += 5000
    else if (res.data.error && res.data.error !== 'authorization_pending') {
      throw new Error(res.data.error_description ?? res.data.error)
    }
  }
  throw new Error('Device authorization timed out')
}

// ─── Legacy BrowserWindow OAuth (kept for fallback) ──────────────────────────

export async function startGitHubOAuth(args: {
  baseUrl: string; clientId: string; clientSecret: string
}): Promise<{ token: string; user: { login: string; name: string; avatarUrl: string } }> {
  const port = await getFreePort()
  const state = crypto.randomBytes(16).toString('hex')
  const redirectUri = `http://localhost:${port}/callback`
  const authorizeUrl = `${args.baseUrl}/login/oauth/authorize?client_id=${encodeURIComponent(args.clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo,read:org&state=${state}`
  const win = new BrowserWindow({ width: 900, height: 700, title: 'Connect to GitHub', autoHideMenuBar: true, webPreferences: { nodeIntegration: false, contextIsolation: true } })
  win.loadURL(authorizeUrl)
  let code: string
  try {
    const result = await waitForCallback(port, win)
    if (result.state !== state) throw new Error('OAuth state mismatch')
    code = result.code
  } finally { if (!win.isDestroyed()) win.close() }
  const tokenResponse = await axios.post(`${args.baseUrl}/login/oauth/access_token`, { client_id: args.clientId, client_secret: args.clientSecret, code, redirect_uri: redirectUri }, { headers: { Accept: 'application/json' } })
  const token = tokenResponse.data.access_token as string
  if (!token) throw new Error('No access token in response')
  const apiBase = args.baseUrl === 'https://github.com' ? 'https://api.github.com' : `${args.baseUrl}/api/v3`
  const u = (await axios.get(`${apiBase}/user`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' } })).data
  return { token, user: { login: u.login, name: u.name ?? u.login, avatarUrl: u.avatar_url } }
}

export async function startGitLabOAuth(args: {
  baseUrl: string; clientId: string
}): Promise<{ token: string; user: { username: string; name: string; avatarUrl: string } }> {
  const port = await getFreePort()
  const state = crypto.randomBytes(16).toString('hex')
  const redirectUri = `http://localhost:${port}/callback`
  const codeVerifier = crypto.randomBytes(64).toString('base64url')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')
  const authorizeUrl = `${args.baseUrl}/oauth/authorize?client_id=${encodeURIComponent(args.clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=api&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`
  const win = new BrowserWindow({ width: 900, height: 700, title: 'Connect to GitLab', autoHideMenuBar: true, webPreferences: { nodeIntegration: false, contextIsolation: true } })
  win.loadURL(authorizeUrl)
  let code: string
  try {
    const result = await waitForCallback(port, win)
    if (result.state !== state) throw new Error('OAuth state mismatch')
    code = result.code
  } finally { if (!win.isDestroyed()) win.close() }
  const tokenResponse = await axios.post(`${args.baseUrl}/oauth/token`, { grant_type: 'authorization_code', client_id: args.clientId, code, redirect_uri: redirectUri, code_verifier: codeVerifier })
  const token = tokenResponse.data.access_token as string
  if (!token) throw new Error('No access token in response')
  const u = (await axios.get(`${args.baseUrl}/api/v4/user`, { headers: { Authorization: `Bearer ${token}` } })).data
  return { token, user: { username: u.username, name: u.name, avatarUrl: u.avatar_url } }
}


