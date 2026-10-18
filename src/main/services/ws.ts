import type WebSocket from 'ws'
import type { WebContents } from 'electron'
import type { TlsOptions } from './certificates'

interface WsConnection {
  ws: WebSocket
  sender: WebContents
  detachSenderDestroyed: () => void
}

const connections = new Map<string, WsConnection>()

function canSendTo(sender: WebContents): boolean {
  return !sender.isDestroyed()
}

function safeSend(sender: WebContents, payload: Record<string, unknown>): void {
  if (canSendTo(sender)) sender.send('postly:ws:event', payload)
}

function detachSenderDestroyed(sender: WebContents, handler: () => void): () => void {
  sender.once('destroyed', handler)
  return () => {
    sender.off('destroyed', handler)
  }
}

export async function connectWebSocket(
  connectionId: string,
  url: string,
  headers: Record<string, string>,
  sender: WebContents,
  tls: TlsOptions = {}
): Promise<void> {
  const { default: WebSocketCtor } = await import('ws')
  return new Promise((resolve, reject) => {
    let settled = false
    const existing = connections.get(connectionId)
    if (existing) {
      existing.detachSenderDestroyed()
      // Drop the old socket's listeners so its late 'close' can neither emit a stale
      // event to the renderer nor evict the replacement connection from the map.
      existing.ws.removeAllListeners()
      existing.ws.on('error', () => {})
      existing.ws.close()
      connections.delete(connectionId)
    }

    const ws = new WebSocketCtor(url, { headers, ...tls })
    const forget = () => {
      if (connections.get(connectionId)?.ws === ws) {
        connections.get(connectionId)?.detachSenderDestroyed()
        connections.delete(connectionId)
      }
    }
    const onSenderDestroyed = () => {
      const mapped = connections.get(connectionId)
      if (mapped && mapped.ws !== ws) return
      forget()
      ws.removeAllListeners()
      ws.on('error', () => {})
      ws.close(1001, 'Renderer destroyed')
      if (!settled) {
        settled = true
        reject(new Error('Renderer was destroyed before the connection opened'))
      }
    }
    const detachDestroyed = detachSenderDestroyed(sender, onSenderDestroyed)

    ws.on('open', () => {
      if (!canSendTo(sender)) {
        detachDestroyed()
        ws.removeAllListeners()
        ws.on('error', () => {})
        ws.close(1001, 'Renderer destroyed')
        settled = true
        reject(new Error('Renderer was destroyed before the connection opened'))
        return
      }
      connections.set(connectionId, { ws, sender, detachSenderDestroyed: detachDestroyed })
      safeSend(sender, { connectionId, type: 'open' })
      settled = true
      resolve()
    })

    ws.on('message', (data: WebSocket.RawData) => {
      const payload = data instanceof Buffer ? data.toString('utf8') : String(data)
      safeSend(sender, {
        connectionId,
        type: 'message',
        data: payload,
        timestamp: Date.now(),
      })
    })

    ws.on('close', (code: number, reason: Buffer) => {
      forget()
      safeSend(sender, {
        connectionId,
        type: 'close',
        code,
        reason: reason.toString('utf8'),
      })
    })

    ws.on('error', (err: Error) => {
      forget()
      safeSend(sender, { connectionId, type: 'error', message: err.message })
      if (!settled) {
        settled = true
        reject(err)
      }
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
    conn.detachSenderDestroyed()
    conn.ws.close(1000, 'Client disconnected')
    connections.delete(connectionId)
  }
}

export function isWebSocketConnected(connectionId: string): boolean {
  const conn = connections.get(connectionId)
  return conn?.ws.readyState === 1 /* WebSocket.OPEN */
}
