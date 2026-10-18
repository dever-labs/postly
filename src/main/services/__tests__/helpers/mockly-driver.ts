import type { HttpMock as DriverHttpMock, MockRequest } from '@dever-labs/mockly-driver'

export type MocklyDriverModule = typeof import('@dever-labs/mockly-driver')
export type MocklyServer = import('@dever-labs/mockly-driver').MocklyServer
export type MocklyServerOptions = import('@dever-labs/mockly-driver').MocklyServerOptions
export type InstallOptions = import('@dever-labs/mockly-driver').InstallOptions

export type MocklyHttpMock = Omit<DriverHttpMock, 'request'> & {
  request: MockRequest & {
    query?: Record<string, string>
    auth?: { type: 'ntlm' | 'bearer' | 'basic' | 'digest'; token?: string }
  }
}

export async function loadMocklyDriver(): Promise<MocklyDriverModule> {
  return import('@dever-labs/mockly-driver')
}

export async function ensureMocklyServer(
  options: MocklyServerOptions & InstallOptions = {},
): Promise<MocklyServer> {
  const { MocklyServer } = await loadMocklyDriver()
  return MocklyServer.ensure(options)
}
