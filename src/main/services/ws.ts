import WebSocket from 'ws'
import type { WebContents } from 'electron'

interface WsConnection {
  ws: WebSocket
  sender: WebContents
}

const connections = new Map<string, WsConnection>()

export function connectWebSocket(
  connectionId: string,
  url: string,
  headers: Record<string, string>,
  sender: WebContents
): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = connections.get(connectionId)
    if (existing) {
      existing.ws.close()
      connections.delete(connectionId)
    }

    const ws = new WebSocket(url, { headers })

    ws.on('open', () => {
      connections.set(connectionId, { ws, sender })
      sender.send('postly:ws:event', { connectionId, type: 'open' })
      resolve()
    })

    ws.on('message', (data: WebSocket.RawData) => {
      const payload = data instanceof Buffer ? data.toString('utf8') : String(data)
      sender.send('postly:ws:event', {
        connectionId,
        type: 'message',
        data: payload,
        timestamp: Date.now(),
      })
    })

    ws.on('close', (code: number, reason: Buffer) => {
      connections.delete(connectionId)
      sender.send('postly:ws:event', {
        connectionId,
        type: 'close',
        code,
        reason: reason.toString('utf8'),
      })
    })

    ws.on('error', (err: Error) => {
      connections.delete(connectionId)
      sender.send('postly:ws:event', { connectionId, type: 'error', message: err.message })
      reject(err)
    })
  })
}

export function sendWebSocketMessage(connectionId: string, message: string): void {
  const conn = connections.get(connectionId)
  if (!conn) throw new Error('No active WebSocket connection')
  conn.ws.send(message)
}

export function disconnectWebSocket(connectionId: string): void {
  const conn = connections.get(connectionId)
  if (conn) {
    conn.ws.close(1000, 'Client disconnected')
    connections.delete(connectionId)
  }
}

export function isWebSocketConnected(connectionId: string): boolean {
  const conn = connections.get(connectionId)
  return conn?.ws.readyState === WebSocket.OPEN
}
