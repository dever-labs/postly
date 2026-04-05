#!/usr/bin/env node
/**
 * Downloads the mockly binary for the current platform into ./bin/.
 * Run before integration tests: node scripts/download-mockly.mjs
 */

import { createWriteStream, mkdirSync, chmodSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import https from 'https'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const BIN_DIR = join(ROOT, 'bin')
const MOCKLY_VERSION = 'v0.1.0'

const ARCH_MAP = { 'x64': 'amd64', 'arm64': 'arm64' }
const PLATFORM_MAP = { 'win32': 'windows', 'darwin': 'darwin', 'linux': 'linux' }

const arch = ARCH_MAP[process.arch]
if (!arch) {
  console.error(`Unsupported architecture: ${process.arch}. Supported: x64 (amd64), arm64`)
  process.exit(1)
}

const platform = PLATFORM_MAP[process.platform]
if (!platform) {
  console.error(`Unsupported platform: ${process.platform}. Supported: win32, darwin, linux`)
  process.exit(1)
}

function assetName() {
  const ext = process.platform === 'win32' ? '.exe' : ''
  return `mockly-${platform}-${arch}${ext}`
}

const binName = process.platform === 'win32' ? 'mockly.exe' : 'mockly'
const binPath = join(BIN_DIR, binName)

if (existsSync(binPath)) {
  console.log(`mockly already present at ${binPath}`)
  process.exit(0)
}

mkdirSync(BIN_DIR, { recursive: true })

const url = `https://github.com/dever-labs/mockly/releases/download/${MOCKLY_VERSION}/${assetName()}`
console.log(`Downloading ${assetName()} …`)

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const get = (u, redirectsLeft = 10) => {
      https.get(u, { headers: { 'User-Agent': 'postly-test-setup' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          res.resume() // consume body to free the socket
          const location = res.headers.location
          if (!location) { reject(new Error('Redirect with no Location header')); return }
          if (redirectsLeft <= 0) { reject(new Error('Too many redirects')); return }
          get(location, redirectsLeft - 1)
          return
        }
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return }
        const ws = createWriteStream(dest)
        res.pipe(ws)
        ws.on('finish', resolve)
        ws.on('error', reject)
      }).on('error', reject)
    }
    get(url)
  })
}

try {
  await download(url, binPath)
  if (process.platform !== 'win32') chmodSync(binPath, 0o755)
  console.log(`mockly downloaded to ${binPath}`)
} catch (err) {
  console.error(`Failed to download mockly: ${err.message}`)
  process.exit(1)
}
