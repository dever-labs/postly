import { BrowserWindow } from 'electron'
import http from 'http'
import crypto from 'crypto'
import axios from 'axios'

async function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = http.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as { port: number }
      srv.close(() => resolve(addr.port))
    })
  })
}

async function waitForCallback(
  port: number,
  win: BrowserWindow
): Promise<{ code: string; state: string }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:${port}`)
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(
        '<html><body><h2>Authentication successful! You can close this window.</h2></body></html>'
      )
      server.close()
      if (code) resolve({ code, state: state ?? '' })
      else reject(new Error('No code in callback'))
    })

    server.listen(port, '127.0.0.1')
    server.on('error', reject)

    win.on('closed', () => {
      server.close()
      reject(new Error('OAuth window was closed'))
    })

    setTimeout(() => {
      server.close()
      reject(new Error('OAuth timeout'))
    }, 5 * 60 * 1000)
  })
}

export async function startGitHubOAuth(args: {
  baseUrl: string
  clientId: string
  clientSecret: string
}): Promise<{ token: string; user: { login: string; name: string; avatarUrl: string } }> {
  const port = await getFreePort()
  const state = crypto.randomBytes(16).toString('hex')
  const redirectUri = `http://localhost:${port}/callback`

  const authorizeUrl =
    `${args.baseUrl}/login/oauth/authorize` +
    `?client_id=${encodeURIComponent(args.clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=repo,read:org` +
    `&state=${state}`

  const win = new BrowserWindow({
    width: 900,
    height: 700,
    title: 'Connect to GitHub',
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  win.loadURL(authorizeUrl)

  let code: string
  try {
    const result = await waitForCallback(port, win)
    if (result.state !== state) throw new Error('OAuth state mismatch')
    code = result.code
  } finally {
    if (!win.isDestroyed()) win.close()
  }

  const tokenResponse = await axios.post(
    `${args.baseUrl}/login/oauth/access_token`,
    {
      client_id: args.clientId,
      client_secret: args.clientSecret,
      code,
      redirect_uri: redirectUri,
    },
    { headers: { Accept: 'application/json' } }
  )

  const token = tokenResponse.data.access_token as string
  if (!token) throw new Error('No access token in response')

  const apiBase =
    args.baseUrl === 'https://github.com' ? 'https://api.github.com' : `${args.baseUrl}/api/v3`

  const userResponse = await axios.get(`${apiBase}/user`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
  })

  const u = userResponse.data
  return {
    token,
    user: {
      login: u.login,
      name: u.name ?? u.login,
      avatarUrl: u.avatar_url,
    },
  }
}

export async function startGitLabOAuth(args: {
  baseUrl: string
  clientId: string
}): Promise<{ token: string; user: { username: string; name: string; avatarUrl: string } }> {
  const port = await getFreePort()
  const state = crypto.randomBytes(16).toString('hex')
  const redirectUri = `http://localhost:${port}/callback`

  const codeVerifier = crypto.randomBytes(64).toString('base64url')
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url')

  const authorizeUrl =
    `${args.baseUrl}/oauth/authorize` +
    `?client_id=${encodeURIComponent(args.clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=api` +
    `&state=${state}` +
    `&code_challenge=${codeChallenge}` +
    `&code_challenge_method=S256`

  const win = new BrowserWindow({
    width: 900,
    height: 700,
    title: 'Connect to GitLab',
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  win.loadURL(authorizeUrl)

  let code: string
  try {
    const result = await waitForCallback(port, win)
    if (result.state !== state) throw new Error('OAuth state mismatch')
    code = result.code
  } finally {
    if (!win.isDestroyed()) win.close()
  }

  const tokenResponse = await axios.post(`${args.baseUrl}/oauth/token`, {
    grant_type: 'authorization_code',
    client_id: args.clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  })

  const token = tokenResponse.data.access_token as string
  if (!token) throw new Error('No access token in response')

  const userResponse = await axios.get(`${args.baseUrl}/api/v4/user`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  const u = userResponse.data
  return {
    token,
    user: {
      username: u.username,
      name: u.name,
      avatarUrl: u.avatar_url,
    },
  }
}
