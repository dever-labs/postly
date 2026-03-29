import { ipcMain } from 'electron'
import { connectMqtt, subscribeMqtt, unsubscribeMqtt, publishMqtt, disconnectMqtt, isMqttConnected } from '../services/mqtt'

export function registerMqttHandlers(): void {
  ipcMain.handle('postly:mqtt:connect', async (event, args: {
    connectionId: string
    brokerUrl: string
    clientId?: string
    username?: string
    password?: string
    keepAlive?: number
    cleanSession?: boolean
  }) => {
    try {
      await connectMqtt(args.connectionId, args.brokerUrl, {
        clientId: args.clientId,
        username: args.username,
        password: args.password,
        keepAlive: args.keepAlive,
        cleanSession: args.cleanSession,
      }, event.sender)
      return { data: { connectionId: args.connectionId } }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('postly:mqtt:subscribe', async (_, args: {
    connectionId: string
    topic: string
    qos?: 0 | 1 | 2
  }) => {
    try {
      subscribeMqtt(args.connectionId, args.topic, args.qos ?? 0)
      return { data: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('postly:mqtt:unsubscribe', async (_, args: {
    connectionId: string
    topic: string
  }) => {
    try {
      unsubscribeMqtt(args.connectionId, args.topic)
      return { data: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('postly:mqtt:publish', async (_, args: {
    connectionId: string
    topic: string
    payload: string
    qos?: 0 | 1 | 2
    retain?: boolean
  }) => {
    try {
      publishMqtt(args.connectionId, args.topic, args.payload, args.qos ?? 0, args.retain ?? false)
      return { data: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('postly:mqtt:disconnect', async (_, args: { connectionId: string }) => {
    try {
      disconnectMqtt(args.connectionId)
      return { data: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('postly:mqtt:status', async (_, args: { connectionId: string }) => {
    return { data: { connected: isMqttConnected(args.connectionId) } }
  })
}
