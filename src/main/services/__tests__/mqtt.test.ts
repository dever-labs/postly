import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

class FakeClient extends EventEmitter {
  connected = false
  end = vi.fn()
  subscribe = vi.fn()
  unsubscribe = vi.fn()
  publish = vi.fn()
}

const state: { clients: FakeClient[]; lastOpts: Record<string, unknown> | null } = { clients: [], lastOpts: null }

vi.mock('mqtt', () => ({
  default: {
    connect: (_url: string, opts: Record<string, unknown>) => {
      const c = new FakeClient()
      state.clients.push(c)
      state.lastOpts = opts
      return c
    }
  }
}))

import {
  connectMqtt,
  subscribeMqtt,
  unsubscribeMqtt,
  publishMqtt,
  disconnectMqtt,
  isMqttConnected
} from '../mqtt'

function makeSender() {
  const listeners = new Map<string, Map<() => void, () => void>>()
  let destroyed = false
  const listenersFor = (event: string) => {
    const existing = listeners.get(event)
    if (existing) return existing
    const next = new Map<() => void, () => void>()
    listeners.set(event, next)
    return next
  }
  return {
    send: vi.fn(),
    isDestroyed: () => destroyed,
    once: (event: string, handler: () => void) => {
      const wrapped = () => {
        listeners.get(event)?.delete(handler)
        handler()
      }
      listenersFor(event).set(handler, wrapped)
    },
    off: (event: string, handler: () => void) => {
      listeners.get(event)?.delete(handler)
    },
    destroy: () => {
      destroyed = true
      for (const handler of [...(listeners.get('destroyed')?.values() ?? [])]) handler()
    },
  }
}

let sender = makeSender()
let asSender = sender as never

// The mqtt module is loaded lazily, so the client only exists after the dynamic import resolves.
async function startConnect(id: string, options = {}) {
  const before = state.clients.length
  const p = connectMqtt(id, 'mqtt://broker', options, asSender)
  await vi.waitFor(() => expect(state.clients.length).toBe(before + 1))
  return { p, client: state.clients[state.clients.length - 1] }
}

async function connect(id = 'c1', options = {}) {
  const { p, client } = await startConnect(id, options)
  client.connected = true
  client.emit('connect')
  await p
  return client
}

beforeEach(() => {
  state.clients = []
  state.lastOpts = null
  sender = makeSender()
  asSender = sender as never
  for (const id of ['c1', 'c2']) disconnectMqtt(id)
})

describe('mqtt service', () => {
  it('connects with defaults and notifies the renderer', async () => {
    await connect()
    expect(state.lastOpts).toMatchObject({ keepalive: 60, clean: true, reconnectPeriod: 0 })
    expect(String(state.lastOpts?.clientId)).toMatch(/^postly-/)
    expect(sender.send).toHaveBeenCalledWith('postly:mqtt:event', { connectionId: 'c1', type: 'connect' })
    expect(isMqttConnected('c1')).toBe(true)
  })

  it('passes through explicit options and omits empty credentials', async () => {
    await connect('c1', { clientId: 'me', username: '', password: '', keepAlive: 10, cleanSession: false })
    expect(state.lastOpts).toMatchObject({ clientId: 'me', keepalive: 10, clean: false })
    expect(state.lastOpts?.username).toBeUndefined()
    expect(state.lastOpts?.password).toBeUndefined()
  })

  it('forwards messages as utf8 strings', async () => {
    const client = await connect()
    client.emit('message', 't/1', Buffer.from('héllo'))
    expect(sender.send).toHaveBeenCalledWith(
      'postly:mqtt:event',
      expect.objectContaining({ type: 'message', topic: 't/1', payload: 'héllo', connectionId: 'c1' })
    )
  })

  it('rejects and drops the connection on error', async () => {
    const { p, client } = await startConnect('c2')
    client.emit('error', new Error('refused'))
    await expect(p).rejects.toThrow('refused')
    expect(sender.send).toHaveBeenCalledWith('postly:mqtt:event', { connectionId: 'c2', type: 'error', message: 'refused' })
    expect(() => subscribeMqtt('c2', 't', 0)).toThrow(/No active/)
  })

  it('removes the connection on close', async () => {
    const client = await connect()
    client.emit('close')
    expect(() => publishMqtt('c1', 't', 'x', 0, false)).toThrow(/No active/)
  })

  it('replaces an existing connection with the same id', async () => {
    const first = await connect()
    await connect()
    expect(first.end).toHaveBeenCalledWith(true)
  })

  it('subscribes, unsubscribes and publishes with the given options', async () => {
    const client = await connect()
    subscribeMqtt('c1', 'a/#', 1)
    unsubscribeMqtt('c1', 'a/#')
    publishMqtt('c1', 'a/b', 'p', 2, true)
    expect(client.subscribe).toHaveBeenCalledWith('a/#', { qos: 1 })
    expect(client.unsubscribe).toHaveBeenCalledWith('a/#')
    expect(client.publish).toHaveBeenCalledWith('a/b', 'p', { qos: 2, retain: true })
  })

  it('throws for operations on unknown connections', () => {
    expect(() => subscribeMqtt('nope', 't', 0)).toThrow(/No active/)
    expect(() => unsubscribeMqtt('nope', 't')).toThrow(/No active/)
    expect(isMqttConnected('nope')).toBe(false)
  })

  it('disconnect ends the client and forgets it', async () => {
    const client = await connect()
    disconnectMqtt('c1')
    expect(client.end).toHaveBeenCalled()
    expect(isMqttConnected('c1')).toBe(false)
  })

  it('tears down the connection when the renderer is destroyed', async () => {
    const client = await connect()
    sender.destroy()
    expect(client.end).toHaveBeenCalledWith(true)
    expect(isMqttConnected('c1')).toBe(false)
    expect(sender.send).toHaveBeenCalledTimes(1)
  })

  it('still tears down a reconnecting client after close when the renderer is destroyed', async () => {
    const { p, client } = await startConnect('c1')
    client.emit('close')
    sender.destroy()
    await expect(p).rejects.toThrow('Renderer was destroyed before the connection opened')
    expect(client.end).toHaveBeenCalledWith(true)
  })
})
