import React, { useEffect, useRef, useState } from 'react'
import { Send, Plug, PlugZap, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { KeyValuePair } from '@/types'
import { HeadersTab } from './tabs/HeadersTab'

interface WsMessage {
  id: string
  direction: 'in' | 'out'
  data: string
  timestamp: number
}

interface WebSocketViewProps {
  url: string
  headers: KeyValuePair[]
  onHeadersChange: (h: KeyValuePair[]) => void
}

export function WebSocketView({ url, headers, onHeadersChange }: WebSocketViewProps) {
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [messages, setMessages] = useState<WsMessage[]>([])
  const [sendText, setSendText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const connectionId = useRef(`ws-${Date.now()}`)
  const logRef = useRef<HTMLDivElement>(null)
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const unsub = window.api.ws.onEvent((rawEvent) => {
      const event = rawEvent as {
        connectionId: string
        type: 'open' | 'message' | 'close' | 'error'
        data?: string
        message?: string
        timestamp?: number
      }
      if (event.connectionId !== connectionId.current) return
      if (event.type === 'open') {
        setConnected(true)
        setConnecting(false)
        setError(null)
      } else if (event.type === 'message') {
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), direction: 'in', data: event.data ?? '', timestamp: event.timestamp ?? Date.now() },
        ])
      } else if (event.type === 'close') {
        setConnected(false)
        setConnecting(false)
      } else if (event.type === 'error') {
        setConnected(false)
        setConnecting(false)
        setError(event.message ?? null)
      }
    })
    unsubRef.current = unsub
    return () => { unsub(); unsubRef.current = null }
  }, [])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [messages])

  const connect = async () => {
    if (!url.trim()) return
    setConnecting(true)
    setError(null)
    const hdrs: Record<string, string> = {}
    headers.filter((h) => h.enabled && h.key).forEach((h) => { hdrs[h.key] = h.value })
    const { error: err } = await window.api.ws.connect({
      connectionId: connectionId.current,
      url,
      headers: hdrs,
    })
    if (err) {
      setConnecting(false)
      setError(String(err))
    }
  }

  const disconnect = async () => {
    await window.api.ws.disconnect({ connectionId: connectionId.current })
    setConnected(false)
  }

  const send = async () => {
    if (!sendText.trim() || !connected) return
    const msg = sendText
    setSendText('')
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), direction: 'out', data: msg, timestamp: Date.now() },
    ])
    await window.api.ws.send({ connectionId: connectionId.current, message: msg })
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Status bar */}
      <div className="flex items-center gap-2 border-b border-th-border px-3 py-2">
        <span className={cn('h-2 w-2 rounded-full', connected ? 'bg-emerald-400' : connecting ? 'bg-amber-400 animate-pulse' : 'bg-th-text-faint')} />
        <span className="text-xs text-th-text-subtle">
          {connected ? 'Connected' : connecting ? 'Connecting…' : 'Disconnected'}
        </span>
        {error && <span className="flex-1 truncate text-xs text-rose-400">{error}</span>}
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setMessages([])}
            className="rounded p-1 text-th-text-faint hover:text-th-text-subtle focus:outline-none"
            title="Clear messages"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          {connected ? (
            <button
              onClick={disconnect}
              className="flex items-center gap-1.5 rounded bg-rose-600/80 px-3 py-1 text-xs font-medium text-white hover:bg-rose-600 focus:outline-none"
            >
              <PlugZap className="h-3.5 w-3.5" /> Disconnect
            </button>
          ) : (
            <button
              onClick={connect}
              disabled={connecting || !url.trim()}
              className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50 focus:outline-none"
            >
              <Plug className="h-3.5 w-3.5" /> Connect
            </button>
          )}
        </div>
      </div>

      {/* Message log */}
      <div ref={logRef} className="flex-1 overflow-y-auto p-2 font-mono text-xs">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-th-text-faint">
            No messages yet
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={cn(
                'mb-1 flex gap-2 rounded px-2 py-1',
                m.direction === 'in' ? 'bg-blue-500/5 text-blue-300' : 'bg-emerald-500/5 text-emerald-300'
              )}
            >
              <span className="shrink-0 select-none text-th-text-faint">
                {new Date(m.timestamp).toLocaleTimeString()}
              </span>
              <span className={cn('shrink-0 font-bold', m.direction === 'in' ? 'text-blue-400' : 'text-emerald-400')}>
                {m.direction === 'in' ? '↓' : '↑'}
              </span>
              <span className="flex-1 break-all whitespace-pre-wrap text-th-text-primary">{m.data}</span>
            </div>
          ))
        )}
      </div>

      {/* Send bar */}
      <div className="flex items-center gap-2 border-t border-th-border px-2 py-2">
        <textarea
          rows={1}
          className="flex-1 resize-none rounded border border-th-border bg-th-surface px-3 py-1.5 font-mono text-sm text-th-text-primary placeholder-th-text-faint focus:border-th-border-strong focus:outline-none"
          placeholder={connected ? 'Type a message…' : 'Connect first'}
          value={sendText}
          disabled={!connected}
          onChange={(e) => setSendText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
        />
        <button
          onClick={send}
          disabled={!connected || !sendText.trim()}
          className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 focus:outline-none"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Handshake headers */}
      <details className="border-t border-th-border">
        <summary className="cursor-pointer px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-th-text-subtle hover:text-th-text-secondary">
          Handshake Headers
        </summary>
        <HeadersTab params={headers} onChange={onHeadersChange} />
      </details>
    </div>
  )
}
