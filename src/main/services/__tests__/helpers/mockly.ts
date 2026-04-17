/**
 * Mockly test helper — starts/stops the Mockly HTTP mock server binary
 * and exposes a simple management API client for use in integration tests.
 *
 * Mockly binary must exist at <repo-root>/bin/mockly[.exe].
 * Run `node scripts/download-mockly.mjs` once to download it.
 */

import { spawn, ChildProcess } from 'child_process'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import net from 'net'
import yaml from 'js-yaml'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface HttpMock {
  id: string
  request: {
    method: string
    path: string
    headers?: Record<string, string>
  }
  response: {
    status: number
    body?: string
    headers?: Record<string, string>
    delay?: string
  }
}

export interface Scenario {
  id: string
  name: string
  patches: Array<{
    mock_id: string
    status?: number
    body?: string
    delay?: string
  }>
}

export interface FaultConfig {
  enabled: boolean
  delay?: string
  status_override?: number
  error_rate?: number
}

// ─── Port utility ─────────────────────────────────────────────────────────────

export function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port
      srv.close(() => resolve(port))
    })
  })
}

// ─── MocklyServer ─────────────────────────────────────────────────────────────

export class MocklyServer {
  private proc: ChildProcess | null = null

  private constructor(
    readonly httpPort: number,
    readonly apiPort: number,
  ) {}

  get httpBase() { return `http://127.0.0.1:${this.httpPort}` }
  get apiBase()  { return `http://127.0.0.1:${this.apiPort}` }

  /**
   * Allocates free ports sequentially (avoids TOCTOU race with parallel
   * allocation), writes config, starts the binary, and waits until ready.
   * Cleans up the spawned process if startup fails.
   */
  static async create(opts: { scenarios?: Scenario[] } = {}): Promise<MocklyServer> {
    // Sequential allocation: parallel Promise.all risks both calls getting the
    // same port before either is bound.
    const httpPort = await getFreePort()
    const apiPort = await getFreePort()
    const server = new MocklyServer(httpPort, apiPort)
    try {
      await server._start(opts.scenarios ?? [])
    } catch (err) {
      await server.stop()
      throw err
    }
    return server
  }

  /** Stop the server process. */
  async stop(): Promise<void> {
    if (this.proc) {
      const proc = this.proc
      proc.kill()
      await new Promise<void>((r) => proc.once('exit', r))
      this.proc = null
    }
  }

  // ── Management API ──────────────────────────────────────────────────────────

  /** Add a mock via the management API. */
  async addMock(mock: HttpMock): Promise<void> {
    const res = await this._post('/api/mocks/http', mock)
    if (!res.ok) throw new Error(`addMock failed: ${res.status}`)
  }

  /** Delete a single mock by id. */
  async deleteMock(id: string): Promise<void> {
    await fetch(`${this.apiBase}/api/mocks/http/${id}`, { method: 'DELETE' })
  }

  /** Activate a scenario (defined in startup config). */
  async activateScenario(id: string): Promise<void> {
    const res = await this._post(`/api/scenarios/${id}/activate`, null)
    if (!res.ok) throw new Error(`activateScenario failed: ${res.status}`)
  }

  /** Deactivate a scenario. */
  async deactivateScenario(id: string): Promise<void> {
    await fetch(`${this.apiBase}/api/scenarios/${id}/activate`, { method: 'DELETE' })
  }

  /** Set global fault injection. */
  async setFault(config: FaultConfig): Promise<void> {
    const res = await this._post('/api/fault', config)
    if (!res.ok) throw new Error(`setFault failed: ${res.status}`)
  }

  /** Clear fault injection. */
  async clearFault(): Promise<void> {
    await fetch(`${this.apiBase}/api/fault`, { method: 'DELETE' })
  }

  /**
   * Reset all state: removes dynamic mocks, deactivates scenarios, clears faults.
   * NOTE: mocks defined in the startup YAML are NOT removed on reset.
   */
  async reset(): Promise<void> {
    await this._post('/api/reset', null)
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private async _start(scenarios: Scenario[]): Promise<void> {
    const bin = resolveBinary()
    const cfgPath = this._writeConfig(scenarios)

    this.proc = spawn(bin, ['start', '--config', cfgPath, `--api-port=${this.apiPort}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.proc.on('error', (err) => { throw new Error(`mockly spawn error: ${err.message}`) })

    await this._waitReady()
  }

  private _writeConfig(scenarios: Scenario[]): string {
    const dir = join(tmpdir(), `mockly-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const cfgPath = join(dir, 'mockly.yaml')

    // Use js-yaml to serialize — avoids YAML injection from special characters
    // in body strings (colons, quotes, newlines, etc.)
    const config: Record<string, unknown> = {
      mockly: { api: { port: this.apiPort } },
      protocols: { http: { enabled: true, port: this.httpPort } },
    }

    if (scenarios.length > 0) {
      config.scenarios = scenarios.map((s) => ({
        id: s.id,
        name: s.name,
        patches: s.patches.map((p) => {
          const patch: Record<string, unknown> = { mock_id: p.mock_id }
          if (p.status !== undefined) patch.status = p.status
          if (p.body !== undefined) patch.body = p.body
          if (p.delay !== undefined) patch.delay = p.delay
          return patch
        }),
      }))
    }

    writeFileSync(cfgPath, yaml.dump(config), 'utf-8')
    return cfgPath
  }

  private async _waitReady(maxMs = 10_000): Promise<void> {
    const deadline = Date.now() + maxMs
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${this.apiBase}/api/protocols`, { signal: AbortSignal.timeout(300) })
        if (res.ok) return
      } catch { /* not ready yet */ }
      await sleep(50)
    }
    throw new Error(`Mockly did not become ready on port ${this.apiPort} within ${maxMs}ms`)
  }

  private _post(path: string, body: unknown): Promise<Response> {
    return fetch(`${this.apiBase}${path}`, {
      method: 'POST',
      headers: body !== null ? { 'Content-Type': 'application/json' } : {},
      body: body !== null ? JSON.stringify(body) : undefined,
    })
  }
}

function resolveBinary(): string {
  const binName = process.platform === 'win32' ? 'mockly.exe' : 'mockly'
  const fromBinDir = resolve(process.cwd(), 'bin', binName)
  if (existsSync(fromBinDir)) return fromBinDir
  return binName
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
