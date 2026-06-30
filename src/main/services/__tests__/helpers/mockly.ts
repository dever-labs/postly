/**
 * Mockly test helper — wraps the official @dever-labs/mockly-driver and
 * extends it with `query` and `auth` fields on HttpMock.request (not yet in
 * published types).
 *
 * The binary is bundled via the package's optionalDependencies — no manual
 * download step is required.
 */

import {
  MocklyServer as _MocklyServer,
  type MocklyServerOptions,
  type HttpMock as _HttpMock,
  type FaultConfig,
} from '@dever-labs/mockly-driver'

export {
  type Scenario,
  type CallEntry,
  type CallSummary,
  type FaultConfig,
  getFreePort,
} from '@dever-labs/mockly-driver'

// ─── Extended types ───────────────────────────────────────────────────────────

/** Extends the official HttpMock.request with query and auth fields. */
export interface HttpMock extends Omit<_HttpMock, 'request'> {
  request: _HttpMock['request'] & {
    /** Query parameter matchers. Use "*" as a value for wildcard matching. */
    query?: Record<string, string>
    /** Typed auth requirement. Mockly drives the full handshake (e.g. NTLM) automatically. */
    auth?: { type: 'ntlm' | 'bearer' | 'basic' | 'digest'; token?: string }
  }
}

// ─── Wrapped MocklyServer ─────────────────────────────────────────────────────

export class MocklyServer {
  private constructor(private readonly _inner: _MocklyServer) {}

  get httpBase() { return this._inner.httpBase }
  get apiBase()  { return this._inner.apiBase }

  static async create(opts: MocklyServerOptions = {}): Promise<MocklyServer> {
    return new MocklyServer(await _MocklyServer.create(opts))
  }

  static async ensure(opts: MocklyServerOptions = {}): Promise<MocklyServer> {
    return new MocklyServer(await _MocklyServer.ensure(opts))
  }

  stop()                                              { return this._inner.stop() }
  addMock(mock: HttpMock)                             { return this._inner.addMock(mock as _HttpMock) }
  deleteMock(id: string)                              { return this._inner.deleteMock(id) }
  activateScenario(id: string)                        { return this._inner.activateScenario(id) }
  deactivateScenario(id: string)                      { return this._inner.deactivateScenario(id) }
  reset()                                             { return this._inner.reset() }
  getCalls(mockId: string)                            { return this._inner.getCalls(mockId) }
  clearCalls(mockId: string)                          { return this._inner.clearCalls(mockId) }
  clearAllCalls()                                     { return this._inner.clearAllCalls() }
  waitForCalls(mockId: string, count?: number, timeout?: string) {
    return this._inner.waitForCalls(mockId, count, timeout)
  }
  setFault(config: FaultConfig)                       { return this._inner.setFault(config) }
  clearFault()                                        { return this._inner.clearFault() }
}
