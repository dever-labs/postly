import type { MqttClient } from 'mqtt'
import type { TlsOptions } from './certificates'
import type { WebContents } from 'electron'

export interface MqttConnectOptions {
  clientId?: string
  username?: string
  password?: string
  keepAlive?: number
  cleanSession?: boolean
}

interface MqttConnection {
  client: MqttClient
  sender: WebContents
  detachSenderDestroyed: () => void
}

const connections = new Map<string, MqttConnection>()

function canSendTo(sender: WebContents): boolean {
  return !sender.isDestroyed()
}

function safeSend(sender: WebContents, payload: Record<string, unknown>): void {
  if (canSendTo(sender)) sender.send('postly:mqtt:event', payload)
}

function detachSenderDestroyed(sender: WebContents, handler: () => void): () => void {
  sender.once('destroyed', handler)
  return () => {
    sender.off('destroyed', handler)
  }
}

export async function connectMqtt(
  connectionId: string,
  brokerUrl: string,
  options: MqttConnectOptions,
  sender: WebContents,
  tls: TlsOptions = {}
): Promise<void> {
  const { default: mqtt } = await import('mqtt')
  return new Promise((resolve, reject) => {
    let settled = false
    const existing = connections.get(connectionId)
    if (existing) {
      existing.detachSenderDestroyed()
      existing.client.end(true)
      connections.delete(connectionId)
    }

    const client = mqtt.connect(brokerUrl, {
      clientId: options.clientId || `postly-${Date.now()}`,
      username: options.username || undefined,
      password: options.password || undefined,
      keepalive: options.keepAlive ?? 60,
      clean: options.cleanSession ?? true,
      reconnectPeriod: 0, // don't auto-reconnect
      ...tls,
    })

    const forget = () => {
      if (connections.get(connectionId)?.client === client) {
        connections.get(connectionId)?.detachSenderDestroyed()
        connections.delete(connectionId)
      }
    }
    const onSenderDestroyed = () => {
      const mapped = connections.get(connectionId)
      if (mapped && mapped.client !== client) return
      forget()
      client.removeAllListeners()
      client.on('error', () => {})
      client.end(true)
      if (!settled) {
        settled = true
        reject(new Error('Renderer was destroyed before the connection opened'))
      }
    }
    const detachDestroyed = detachSenderDestroyed(sender, onSenderDestroyed)

    client.on('connect', () => {
      if (!canSendTo(sender)) {
        detachDestroyed()
        client.removeAllListeners()
        client.on('error', () => {})
        client.end(true)
        settled = true
        reject(new Error('Renderer was destroyed before the connection opened'))
        return
      }
      connections.set(connectionId, { client, sender, detachSenderDestroyed: detachDestroyed })
      safeSend(sender, { connectionId, type: 'connect' })
      settled = true
      resolve()
    })

    client.on('message', (topic: string, payload: Buffer) => {
      safeSend(sender, {
        connectionId,
        type: 'message',
        topic,
        payload: payload.toString('utf8'),
        timestamp: Date.now(),
      })
    })

    client.on('disconnect', () => {
      safeSend(sender, { connectionId, type: 'disconnect' })
    })

    client.on('close', () => {
      forget()
      safeSend(sender, { connectionId, type: 'close' })
    })

    client.on('error', (err: Error) => {
      forget()
      safeSend(sender, { connectionId, type: 'error', message: err.message })
      if (!settled) {
        settled = true
        reject(err)
      }
    })
  })
}

export function subscribeMqtt(connectionId: string, topic: string, qos: 0 | 1 | 2): void {
  const conn = connections.get(connectionId)
  if (!conn) throw new Error('No active MQTT connection')
  conn.client.subscribe(topic, { qos })
}

export function unsubscribeMqtt(connectionId: string, topic: string): void {
  const conn = connections.get(connectionId)
  if (!conn) throw new Error('No active MQTT connection')
  conn.client.unsubscribe(topic)
}

export function publishMqtt(
  connectionId: string,
  topic: string,
  payload: string,
  qos: 0 | 1 | 2,
  retain: boolean
): void {
  const conn = connections.get(connectionId)
  if (!conn) throw new Error('No active MQTT connection')
  conn.client.publish(topic, payload, { qos, retain })
}

export function disconnectMqtt(connectionId: string): void {
  const conn = connections.get(connectionId)
  if (conn) {
    conn.detachSenderDestroyed()
    conn.client.end()
    connections.delete(connectionId)
  }
}

export function isMqttConnected(connectionId: string): boolean {
  return connections.get(connectionId)?.client.connected ?? false
}
