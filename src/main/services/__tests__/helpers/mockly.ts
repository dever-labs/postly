/**
 * Mockly test helper — wraps the official @dever-labs/mockly-driver while
 * keeping the runtime load compatible with Playwright's CommonJS loader.
 */

import { createServer } from 'node:net'
import type {
  CallEntry,
  CallSummary,
  FaultConfig,
  HttpMock as DriverHttpMock,
  MocklyServerOptions,
  Scenario,
} from '@dever-labs/mockly-driver'

type DriverModule = typeof import('@dever-labs/mockly-driver')
type DriverServer = import('@dever-labs/mockly-driver').MocklyServer

let driverPromise: Promise<DriverModule> | null = null

function loadMocklyDriver(): Promise<DriverModule> {
  driverPromise ??= import('@dever-labs/mockly-driver')
  return driverPromise
}

export type { Scenario, CallEntry, CallSummary, FaultConfig, MocklyServerOptions }

/** Extends the official HttpMock.request with query and auth fields. */
export interface HttpMock extends Omit<DriverHttpMock, 'request'> {
  request: DriverHttpMock['request'] & {
    /** Query parameter matchers. Use "*" as a value for wildcard matching. */
    query?: Record<string, string>
    /** Typed auth requirement. Mockly drives the full handshake automatically. */
    auth?: { type: 'ntlm' | 'bearer' | 'basic' | 'digest'; token?: string }
  }
}

export async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not determine a free port')))
        return
      }
      server.close((err) => {
        if (err) reject(err)
        else resolve(address.port)
      })
    })
  })
}

export class MocklyServer {
  private constructor(private readonly inner: DriverServer) {}

  get httpBase() { return this.inner.httpBase }
  get apiBase() { return this.inner.apiBase }

  static async create(opts: MocklyServerOptions = {}): Promise<MocklyServer> {
    const { MocklyServer: DriverMocklyServer } = await loadMocklyDriver()
    return new MocklyServer(await DriverMocklyServer.create(opts))
  }

  static async ensure(opts: MocklyServerOptions = {}): Promise<MocklyServer> {
    const { MocklyServer: DriverMocklyServer } = await loadMocklyDriver()
    return new MocklyServer(await DriverMocklyServer.ensure(opts))
  }

  stop() { return this.inner.stop() }
  addMock(mock: HttpMock) { return this.inner.addMock(mock as DriverHttpMock) }
  deleteMock(id: string) { return this.inner.deleteMock(id) }
  activateScenario(id: string) { return this.inner.activateScenario(id) }
  deactivateScenario(id: string) { return this.inner.deactivateScenario(id) }
  reset() { return this.inner.reset() }
  getCalls(mockId: string): Promise<CallSummary> { return this.inner.getCalls(mockId) }
  clearCalls(mockId: string) { return this.inner.clearCalls(mockId) }
  clearAllCalls() { return this.inner.clearAllCalls() }
  waitForCalls(mockId: string, count?: number, timeout?: string): Promise<CallSummary> {
    return this.inner.waitForCalls(mockId, count, timeout)
  }
  setFault(config: FaultConfig) { return this.inner.setFault(config) }
  clearFault() { return this.inner.clearFault() }
}
