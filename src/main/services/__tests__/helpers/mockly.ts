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
   * Allocates free ports, writes a minimal YAML config (optionally including
   * a scenario definition), starts the binary, and waits until ready.
   */
  static async create(opts: { scenarios?: Scenario[] } = {}): Promise<MocklyServer> {
    const [httpPort, apiPort] = await Promise.all([getFreePort(), getFreePort()])
    const server = new MocklyServer(httpPort, apiPort)
    await server._start(opts.scenarios ?? [])
    return server
  }

  /** Stop the server process. */
  async stop(): Promise<void> {
    if (this.proc) {
      this.proc.kill()
      await new Promise<void>((r) => this.proc!.once('exit', r))
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

    const scenarioBlock = scenarios.length === 0 ? '' :
      'scenarios:\n' + scenarios.map((s) =>
        `  - id: ${s.id}\n    name: ${s.name}\n    patches:\n` +
        s.patches.map((p) =>
          `      - mock_id: ${p.mock_id}\n` +
          (p.status !== undefined ? `        status: ${p.status}\n` : '') +
          (p.body !== undefined ? `        body: '${p.body.replace(/'/g, "''")}'\n` : '') +
          (p.delay !== undefined ? `        delay: ${p.delay}\n` : '')
        ).join('')
      ).join('')

    const yaml = [
      `mockly:\n  api:\n    port: ${this.apiPort}`,
      `protocols:\n  http:\n    enabled: true\n    port: ${this.httpPort}`,
      scenarioBlock,
    ].filter(Boolean).join('\n')

    writeFileSync(cfgPath, yaml, 'utf-8')
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
