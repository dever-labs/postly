import { ipcMain } from 'electron'
import { connectWebSocket, sendWebSocketMessage, disconnectWebSocket, isWebSocketConnected } from '../services/ws'

export function registerWsHandlers(): void {
  ipcMain.handle('postly:ws:connect', async (event, args: {
    connectionId: string
    url: string
    headers?: Record<string, string>
  }) => {
    try {
      await connectWebSocket(args.connectionId, args.url, args.headers ?? {}, event.sender)
      return { data: { connectionId: args.connectionId } }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('postly:ws:send', async (_, args: { connectionId: string; message: string }) => {
    try {
      sendWebSocketMessage(args.connectionId, args.message)
      return { data: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('postly:ws:disconnect', async (_, args: { connectionId: string }) => {
    try {
      disconnectWebSocket(args.connectionId)
      return { data: true }
    } catch (err) {
      return { error: String(err) }
    }
  })

  ipcMain.handle('postly:ws:status', async (_, args: { connectionId: string }) => {
    return { data: { connected: isWebSocketConnected(args.connectionId) } }
  })
}
