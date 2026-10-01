import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { WebSocketServer, type WebSocket as ServerSocket } from 'ws'
import type { AddressInfo } from 'net'
import { connectWebSocket, sendWebSocketMessage, disconnectWebSocket, isWebSocketConnected } from '../ws'

type Sender = Parameters<typeof connectWebSocket>[3]
type Event = { connectionId: string; type: string; data?: string; code?: number; reason?: string; message?: string }

let wss: WebSocketServer
let url: string
const serverSockets: ServerSocket[] = []
let lastHeaders: Record<string, string | string[] | undefined> = {}

function makeSender() {
  const events: Event[] = []
  const sender = { send: (_ch: string, e: Event) => { events.push(e) } } as unknown as Sender
  return { sender, events }
}

const until = async (cond: () => boolean, ms = 3000) => {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting for condition')
    await new Promise((r) => setTimeout(r, 10))
  }
}

beforeAll(async () => {
  wss = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise<void>((r) => wss.on('listening', () => r()))
  url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`
  wss.on('connection', (s, req) => {
    lastHeaders = req.headers
    serverSockets.push(s)
    s.on('message', (m) => s.send(`echo:${m.toString()}`))
  })
})

afterEach(() => {
  for (const id of ['a', 'b']) disconnectWebSocket(id)
  serverSockets.length = 0
})

afterAll(async () => {
  wss.clients.forEach((c) => c.terminate())
  await new Promise<void>((r) => wss.close(() => r()))
})

describe('websocket service', () => {
  it('connects, reports open, and forwards custom headers', async () => {
    const { sender, events } = makeSender()
    await connectWebSocket('a', url, { 'x-test': 'yes' }, sender)
    expect(events[0]).toEqual({ connectionId: 'a', type: 'open' })
    expect(isWebSocketConnected('a')).toBe(true)
    expect(lastHeaders['x-test']).toBe('yes')
  })

  it('sends messages and receives echoes as events', async () => {
    const { sender, events } = makeSender()
    await connectWebSocket('a', url, {}, sender)
    sendWebSocketMessage('a', 'hello')
    await until(() => events.some((e) => e.type === 'message'))
    const msg = events.find((e) => e.type === 'message')
    expect(msg?.data).toBe('echo:hello')
    expect(typeof (msg as unknown as { timestamp: number }).timestamp).toBe('number')
  })

  it('throws when sending without an active connection', () => {
    expect(() => sendWebSocketMessage('nope', 'x')).toThrow('No active WebSocket connection')
  })

  it('emits a close event with code and reason when the server closes', async () => {
    const { sender, events } = makeSender()
    await connectWebSocket('a', url, {}, sender)
    serverSockets[0].close(4001, 'bye')
    await until(() => events.some((e) => e.type === 'close'))
    expect(events.find((e) => e.type === 'close')).toMatchObject({ connectionId: 'a', code: 4001, reason: 'bye' })
    expect(isWebSocketConnected('a')).toBe(false)
  })

  it('disconnect closes the socket with 1000', async () => {
    const { sender, events } = makeSender()
    await connectWebSocket('a', url, {}, sender)
    disconnectWebSocket('a')
    await until(() => events.some((e) => e.type === 'close'))
    expect(events.find((e) => e.type === 'close')).toMatchObject({ code: 1000, reason: 'Client disconnected' })
    expect(isWebSocketConnected('a')).toBe(false)
  })

  it('disconnecting an unknown connection is a no-op', () => {
    expect(() => disconnectWebSocket('unknown')).not.toThrow()
  })

  it('replaces an existing connection that reuses the same id', async () => {
    const first = makeSender()
    await connectWebSocket('a', url, {}, first.sender)
    const second = makeSender()
    await connectWebSocket('a', url, {}, second.sender)
    await until(() => serverSockets[0].readyState === serverSockets[0].CLOSED)
    // The replaced socket's late close must not evict the new connection or notify the renderer
    expect(isWebSocketConnected('a')).toBe(true)
    expect(first.events.some((e) => e.type === 'close')).toBe(false)
    sendWebSocketMessage('a', 'still-works')
    await until(() => second.events.some((e) => e.type === 'message'))
    expect(second.events.find((e) => e.type === 'message')?.data).toBe('echo:still-works')
  })

  it('keeps connections with different ids independent', async () => {
    const a = makeSender()
    const b = makeSender()
    await connectWebSocket('a', url, {}, a.sender)
    await connectWebSocket('b', url, {}, b.sender)
    disconnectWebSocket('a')
    await until(() => a.events.some((e) => e.type === 'close'))
    expect(isWebSocketConnected('b')).toBe(true)
  })

  it('rejects and emits an error event when the server is unreachable', async () => {
    const { sender, events } = makeSender()
    await expect(connectWebSocket('a', 'ws://127.0.0.1:1', {}, sender)).rejects.toBeTruthy()
    expect(events.find((e) => e.type === 'error')?.message).toBeTruthy()
    expect(isWebSocketConnected('a')).toBe(false)
  })

  it('isWebSocketConnected is false for unknown ids', () => {
    expect(isWebSocketConnected('ghost')).toBe(false)
  })
})

