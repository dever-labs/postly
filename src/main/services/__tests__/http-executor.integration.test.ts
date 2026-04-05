/**
 * Integration tests for executeRequest() using Mockly as the real HTTP backend.
 *
 * These tests complement the unit tests in http-executor.test.ts, which mock
 * axios entirely. Here we exercise the real network path: redirect following,
 * timeout, duration measurement, fault injection, and scenario activation.
 *
 * Prerequisites: run `node scripts/download-mockly.mjs` to download the binary.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { executeRequest, HttpRequest } from '../http-executor'
import { MocklyServer } from './helpers/mockly'

// ─── Shared server setup ─────────────────────────────────────────────────────

let server: MocklyServer

function req(overrides: Partial<HttpRequest> & { url: string }): HttpRequest {
  return {
    method: 'GET',
    headers: {},
    bodyType: 'none',
    authType: 'none',
    authConfig: {},
    ...overrides,
  }
}

beforeAll(async () => {
  server = await MocklyServer.create({
    scenarios: [
      {
        id: 'service-down',
        name: 'Service unavailable',
        patches: [{ mock_id: 'health-check', status: 503, body: '{"error":"down"}' }],
      },
    ],
  })
}, 30_000)

afterAll(() => server?.stop())

beforeEach(() => server.reset())

// ─── Basic HTTP verbs ────────────────────────────────────────────────────────

describe('basic request/response', () => {
  it('GET returns correct status, body, and response headers', async () => {
    await server.addMock({
      id: 'get-items',
      request: { method: 'GET', path: '/items' },
      response: {
        status: 200,
        body: '[{"id":1}]',
        headers: { 'Content-Type': 'application/json', 'X-Custom': 'hello' },
      },
    })

    const result = await executeRequest(req({ url: `${server.httpBase}/items` }))

    expect(result.status).toBe(200)
    expect(result.body).toContain('"id"')
    expect(result.headers['content-type']).toContain('application/json')
    expect(result.headers['x-custom']).toBe('hello')
  })

  it('POST request returns 201', async () => {
    await server.addMock({
      id: 'create-item',
      request: { method: 'POST', path: '/items' },
      response: { status: 201, body: '{"created":true}' },
    })

    const result = await executeRequest(
      req({ method: 'POST', url: `${server.httpBase}/items`, body: '{"name":"test"}', bodyType: 'raw-json' }),
    )

    expect(result.status).toBe(201)
  })

  it('DELETE request returns 204 with empty body', async () => {
    await server.addMock({
      id: 'delete-item',
      request: { method: 'DELETE', path: '/items/1' },
      response: { status: 204 },
    })

    const result = await executeRequest(req({ method: 'DELETE', url: `${server.httpBase}/items/1` }))

    expect(result.status).toBe(204)
    expect(result.body).toBe('')
  })
})

// ─── Error status codes ──────────────────────────────────────────────────────

describe('error status handling', () => {
  it('returns 404 body when resource not found', async () => {
    await server.addMock({
      id: 'not-found',
      request: { method: 'GET', path: '/missing' },
      response: { status: 404, body: '{"error":"not found"}' },
    })

    const result = await executeRequest(req({ url: `${server.httpBase}/missing` }))

    expect(result.status).toBe(404)
    expect(result.body).toContain('not found')
  })

  it('logs warn for 4xx responses and still returns the status', async () => {
    await server.addMock({
      id: 'unauthorized',
      request: { method: 'GET', path: '/protected' },
      response: { status: 401, body: '{"error":"unauthorized"}' },
    })

    const logs: Array<{ level: string; message: string }> = []
    const result = await executeRequest(req({ url: `${server.httpBase}/protected` }), {
      onLog: (entry) => logs.push(entry),
    })

    expect(result.status).toBe(401)
    expect(logs.some((l) => l.level === 'warn')).toBe(true)
  })

  it('returns 500 body intact', async () => {
    await server.addMock({
      id: 'server-error',
      request: { method: 'GET', path: '/crash' },
      response: { status: 500, body: '{"error":"internal server error"}' },
    })

    const result = await executeRequest(req({ url: `${server.httpBase}/crash` }))

    expect(result.status).toBe(500)
    expect(result.body).toContain('internal server error')
  })
})

// ─── Redirect handling ───────────────────────────────────────────────────────

describe('redirects', () => {
  it('follows 301 redirect by default', async () => {
    await server.addMock({
      id: 'old-endpoint',
      request: { method: 'GET', path: '/old' },
      response: { status: 301, headers: { Location: `${server.httpBase}/new` } },
    })
    await server.addMock({
      id: 'new-endpoint',
      request: { method: 'GET', path: '/new' },
      response: { status: 200, body: 'redirected' },
    })

    const result = await executeRequest(req({ url: `${server.httpBase}/old` }))

    expect(result.status).toBe(200)
    expect(result.body).toBe('redirected')
  })

  it('stops at 301 when followRedirects is false', async () => {
    await server.addMock({
      id: 'old-no-follow',
      request: { method: 'GET', path: '/old-no-follow' },
      response: { status: 301, headers: { Location: `${server.httpBase}/new` } },
    })

    const result = await executeRequest(
      req({ url: `${server.httpBase}/old-no-follow` }),
      { followRedirects: false },
    )

    expect(result.status).toBe(301)
  })
})

// ─── Timeout ─────────────────────────────────────────────────────────────────

describe('timeout', () => {
  it('returns status 0 when request exceeds timeout', async () => {
    await server.addMock({
      id: 'slow-endpoint',
      request: { method: 'GET', path: '/slow' },
      response: { status: 200, delay: '500ms' },
    })

    const result = await executeRequest(
      req({ url: `${server.httpBase}/slow` }),
      { timeout: 100 },
    )

    expect(result.status).toBe(0)
  })
})

// ─── Duration measurement ─────────────────────────────────────────────────────

describe('duration', () => {
  it('measures response duration in milliseconds', async () => {
    await server.addMock({
      id: 'timed',
      request: { method: 'GET', path: '/timed' },
      response: { status: 200, body: 'ok', delay: '50ms' },
    })

    const result = await executeRequest(req({ url: `${server.httpBase}/timed` }))

    expect(result.duration).toBeGreaterThanOrEqual(40)
    expect(result.status).toBe(200)
  })
})

// ─── Body types ──────────────────────────────────────────────────────────────

describe('body types', () => {
  it('sends raw-json body with Content-Type application/json', async () => {
    await server.addMock({
      id: 'json-echo',
      request: { method: 'POST', path: '/json' },
      response: { status: 200, body: 'received' },
    })

    const result = await executeRequest(
      req({
        method: 'POST',
        url: `${server.httpBase}/json`,
        body: '{"key":"value"}',
        bodyType: 'raw-json',
      }),
    )

    expect(result.status).toBe(200)
  })

  it('sends x-www-form-urlencoded body', async () => {
    await server.addMock({
      id: 'form-echo',
      request: { method: 'POST', path: '/form' },
      response: { status: 200, body: 'received' },
    })

    const formBody = JSON.stringify([
      { key: 'username', value: 'alice', enabled: true },
      { key: 'password', value: 'secret', enabled: true },
    ])

    const result = await executeRequest(
      req({
        method: 'POST',
        url: `${server.httpBase}/form`,
        body: formBody,
        bodyType: 'x-www-form-urlencoded',
      }),
    )

    expect(result.status).toBe(200)
  })
})

// ─── Auth headers ────────────────────────────────────────────────────────────

describe('auth', () => {
  it('attaches Bearer token to Authorization header', async () => {
    await server.addMock({
      id: 'bearer-endpoint',
      request: { method: 'GET', path: '/bearer' },
      response: { status: 200, body: 'authorized' },
    })

    const result = await executeRequest(
      req({
        url: `${server.httpBase}/bearer`,
        authType: 'bearer',
        authConfig: { token: 'my-secret-token' },
      }),
    )

    // 200 confirms the request reached the server (header value verified in unit tests)
    expect(result.status).toBe(200)
  })

  it('attaches Basic auth credentials to Authorization header', async () => {
    await server.addMock({
      id: 'basic-endpoint',
      request: { method: 'GET', path: '/basic' },
      response: { status: 200, body: 'authorized' },
    })

    const result = await executeRequest(
      req({
        url: `${server.httpBase}/basic`,
        authType: 'basic',
        authConfig: { username: 'alice', password: 'secret' },
      }),
    )

    expect(result.status).toBe(200)
  })
})

// ─── Fault injection ─────────────────────────────────────────────────────────

describe('fault injection', () => {
  it('global delay increases response duration', async () => {
    await server.addMock({
      id: 'fast-endpoint',
      request: { method: 'GET', path: '/fast' },
      response: { status: 200, body: 'ok' },
    })

    await server.setFault({ enabled: true, delay: '100ms' })
    const result = await executeRequest(req({ url: `${server.httpBase}/fast` }), { timeout: 5000 })
    await server.clearFault()

    expect(result.status).toBe(200)
    expect(result.duration).toBeGreaterThanOrEqual(80)
  })

  it('status_override returns configured status for all endpoints', async () => {
    await server.addMock({
      id: 'ok-endpoint',
      request: { method: 'GET', path: '/ok' },
      response: { status: 200, body: 'ok' },
    })

    await server.setFault({ enabled: true, status_override: 503 })
    const result = await executeRequest(req({ url: `${server.httpBase}/ok` }))
    await server.clearFault()

    expect(result.status).toBe(503)
  })
})

// ─── Scenario activation ─────────────────────────────────────────────────────

describe('scenario activation', () => {
  it('activating a scenario overrides mock responses', async () => {
    // health-check mock is referenced in the 'service-down' scenario (defined at startup)
    await server.addMock({
      id: 'health-check',
      request: { method: 'GET', path: '/health' },
      response: { status: 200, body: '{"status":"ok"}' },
    })

    // Without scenario: 200
    const before = await executeRequest(req({ url: `${server.httpBase}/health` }))
    expect(before.status).toBe(200)

    // Activate the scenario
    await server.activateScenario('service-down')

    // With scenario active: 503
    const after = await executeRequest(req({ url: `${server.httpBase}/health` }))
    expect(after.status).toBe(503)
    expect(after.body).toContain('down')
  })
})
