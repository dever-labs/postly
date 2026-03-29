import mqtt, { MqttClient } from 'mqtt'
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
}

const connections = new Map<string, MqttConnection>()

export function connectMqtt(
  connectionId: string,
  brokerUrl: string,
  options: MqttConnectOptions,
  sender: WebContents
): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = connections.get(connectionId)
    if (existing) {
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
    })

    client.on('connect', () => {
      connections.set(connectionId, { client, sender })
      sender.send('postly:mqtt:event', { connectionId, type: 'connect' })
      resolve()
    })

    client.on('message', (topic: string, payload: Buffer) => {
      sender.send('postly:mqtt:event', {
        connectionId,
        type: 'message',
        topic,
        payload: payload.toString('utf8'),
        timestamp: Date.now(),
      })
    })

    client.on('disconnect', () => {
      sender.send('postly:mqtt:event', { connectionId, type: 'disconnect' })
    })

    client.on('close', () => {
      connections.delete(connectionId)
      sender.send('postly:mqtt:event', { connectionId, type: 'close' })
    })

    client.on('error', (err: Error) => {
      connections.delete(connectionId)
      sender.send('postly:mqtt:event', { connectionId, type: 'error', message: err.message })
      reject(err)
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
    conn.client.end()
    connections.delete(connectionId)
  }
}

export function isMqttConnected(connectionId: string): boolean {
  return connections.get(connectionId)?.client.connected ?? false
}
