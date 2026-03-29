import React, { useEffect, useRef, useState } from 'react'
import { Plug, PlugZap, Plus, Send, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MqttSubscription {
  topic: string
  qos: 0 | 1 | 2
}

interface MqttMessage {
  id: string
  topic: string
  payload: string
  timestamp: number
  direction: 'in' | 'out'
}

interface MqttViewProps {
  clientId: string
  username: string
  password: string
  keepAlive: string
  cleanSession: string
  subscriptions: string
  onConfigChange: (key: string, value: string) => void
}

export function MqttView({
  clientId,
  username,
  password,
  keepAlive,
  cleanSession,
  subscriptions: subscriptionsJson,
  onConfigChange,
}: MqttViewProps) {
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [messages, setMessages] = useState<MqttMessage[]>([])
  const [subTopic, setSubTopic] = useState('')
  const [subQos, setSubQos] = useState<0 | 1 | 2>(0)
  const [pubTopic, setPubTopic] = useState('')
  const [pubPayload, setPubPayload] = useState('')
  const [pubQos, setPubQos] = useState<0 | 1 | 2>(0)
  const [pubRetain, setPubRetain] = useState(false)
  const connectionId = useRef(`mqtt-${Date.now()}`)
  const logRef = useRef<HTMLDivElement>(null)

  const subs: MqttSubscription[] = (() => {
    try { return JSON.parse(subscriptionsJson || '[]') } catch { return [] }
  })()

  const saveSubs = (next: MqttSubscription[]) => onConfigChange('subscriptions', JSON.stringify(next))

  useEffect(() => {
    const unsub = (window as any).api.mqtt.onEvent((event: any) => {
      if (event.connectionId !== connectionId.current) return
      if (event.type === 'connect') { setConnected(true); setConnecting(false); setError(null) }
      else if (event.type === 'close' || event.type === 'disconnect') { setConnected(false); setConnecting(false) }
      else if (event.type === 'error') { setConnected(false); setConnecting(false); setError(event.message) }
      else if (event.type === 'message') {
        setMessages((prev) => [...prev, {
          id: crypto.randomUUID(),
          topic: event.topic,
          payload: event.payload,
          timestamp: event.timestamp,
          direction: 'in',
        }])
      }
    })
    return unsub
  }, [])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [messages])

  const connect = async (brokerUrl: string) => {
    if (!brokerUrl) return
    setConnecting(true); setError(null)
    const { error: err } = await (window as any).api.mqtt.connect({
      connectionId: connectionId.current,
      brokerUrl,
      clientId: clientId || undefined,
      username: username || undefined,
      password: password || undefined,
      keepAlive: keepAlive ? Number(keepAlive) : undefined,
      cleanSession: cleanSession !== 'false',
    })
    if (err) { setConnecting(false); setError(String(err)) }
    else {
      // re-subscribe to saved topics
      for (const s of subs) {
        await (window as any).api.mqtt.subscribe({ connectionId: connectionId.current, topic: s.topic, qos: s.qos })
      }
    }
  }

  const disconnect = async () => {
    await (window as any).api.mqtt.disconnect({ connectionId: connectionId.current })
    setConnected(false)
  }

  const subscribe = async () => {
    if (!subTopic.trim()) return
    const newSub = { topic: subTopic.trim(), qos: subQos }
    saveSubs([...subs, newSub])
    setSubTopic('')
    if (connected) {
      await (window as any).api.mqtt.subscribe({ connectionId: connectionId.current, topic: newSub.topic, qos: newSub.qos })
    }
  }

  const unsubscribe = async (topic: string) => {
    saveSubs(subs.filter((s) => s.topic !== topic))
    if (connected) {
      await (window as any).api.mqtt.unsubscribe({ connectionId: connectionId.current, topic })
    }
  }

  const publish = async () => {
    if (!pubTopic.trim()) return
    setMessages((prev) => [...prev, {
      id: crypto.randomUUID(), topic: pubTopic, payload: pubPayload, timestamp: Date.now(), direction: 'out',
    }])
    await (window as any).api.mqtt.publish({
      connectionId: connectionId.current, topic: pubTopic, payload: pubPayload, qos: pubQos, retain: pubRetain,
    })
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Connection status bar */}
      <div className="flex items-center gap-2 border-b border-th-border px-3 py-2">
        <span className={cn('h-2 w-2 rounded-full', connected ? 'bg-emerald-400' : connecting ? 'bg-amber-400 animate-pulse' : 'bg-th-text-faint')} />
        <span className="text-xs text-th-text-subtle">
          {connected ? 'Connected' : connecting ? 'Connecting…' : 'Disconnected'}
        </span>
        {error && <span className="flex-1 truncate text-xs text-rose-400">{error}</span>}
        <div className="ml-auto">
          {connected ? (
            <button onClick={disconnect} className="flex items-center gap-1.5 rounded bg-rose-600/80 px-3 py-1 text-xs font-medium text-white hover:bg-rose-600 focus:outline-none">
              <PlugZap className="h-3.5 w-3.5" /> Disconnect
            </button>
          ) : (
            <button onClick={() => connect('')} disabled className="flex items-center gap-1.5 rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white focus:outline-none opacity-50 cursor-not-allowed">
              <Plug className="h-3.5 w-3.5" /> Connect
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden lg:flex-row lg:divide-x lg:divide-th-border">
        {/* Left panel */}
        <div className="flex w-full flex-col gap-3 overflow-y-auto p-3 lg:w-72 lg:shrink-0">
          {/* Connection settings */}
          <details open>
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-th-text-subtle mb-2">Connection</summary>
            <div className="flex flex-col gap-1.5">
              {[
                { label: 'Client ID', key: 'clientId', value: clientId, placeholder: 'postly-client' },
                { label: 'Username', key: 'username', value: username, placeholder: '' },
                { label: 'Password', key: 'password', value: password, placeholder: '', type: 'password' },
                { label: 'Keep Alive (s)', key: 'keepAlive', value: keepAlive, placeholder: '60' },
              ].map(({ label, key, value, placeholder, type }) => (
                <div key={key}>
                  <div className="mb-0.5 text-[11px] text-th-text-faint">{label}</div>
                  <input
                    type={type ?? 'text'}
                    className="w-full rounded border border-th-border bg-th-surface px-2 py-1 text-xs text-th-text-primary placeholder-th-text-faint focus:border-th-border-strong focus:outline-none"
                    placeholder={placeholder}
                    value={value}
                    onChange={(e) => onConfigChange(key, e.target.value)}
                  />
                </div>
              ))}
              <div className="flex items-center gap-2">
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-th-text-subtle">
                  <input type="checkbox" checked={cleanSession !== 'false'} onChange={(e) => onConfigChange('cleanSession', e.target.checked ? 'true' : 'false')} />
                  Clean Session
                </label>
              </div>
              {!connected && (
                <button
                  onClick={() => connect('')}
                  disabled={connecting}
                  className="mt-1 flex items-center justify-center gap-1.5 rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-50 focus:outline-none"
                >
                  <Plug className="h-3.5 w-3.5" /> {connecting ? 'Connecting…' : 'Connect to broker'}
                </button>
              )}
            </div>
          </details>

          {/* Subscriptions */}
          <details open>
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-th-text-subtle mb-2">Subscriptions</summary>
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-1">
                <input
                  className="flex-1 rounded border border-th-border bg-th-surface px-2 py-1 text-xs text-th-text-primary placeholder-th-text-faint focus:outline-none"
                  placeholder="topic/# or sensor/+/data"
                  value={subTopic}
                  onChange={(e) => setSubTopic(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') subscribe() }}
                />
                <select
                  className="rounded border border-th-border bg-th-surface px-1 py-1 text-xs text-th-text-primary focus:outline-none"
                  value={subQos}
                  onChange={(e) => setSubQos(Number(e.target.value) as 0|1|2)}
                >
                  <option value={0}>QoS 0</option>
                  <option value={1}>QoS 1</option>
                  <option value={2}>QoS 2</option>
                </select>
                <button onClick={subscribe} className="rounded bg-th-surface-raised px-2 py-1 text-th-text-subtle hover:text-th-text-primary focus:outline-none">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
              {subs.length === 0 ? (
                <p className="text-xs text-th-text-faint">No subscriptions</p>
              ) : (
                subs.map((s) => (
                  <div key={s.topic} className="flex items-center gap-1 rounded bg-th-surface px-2 py-1">
                    <span className="flex-1 truncate font-mono text-xs text-th-text-primary">{s.topic}</span>
                    <span className="text-[10px] text-th-text-faint">QoS {s.qos}</span>
                    <button onClick={() => unsubscribe(s.topic)} className="text-th-text-faint hover:text-rose-400 focus:outline-none">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </details>

          {/* Publish */}
          <details open>
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-th-text-subtle mb-2">Publish</summary>
            <div className="flex flex-col gap-1.5">
              <input
                className="w-full rounded border border-th-border bg-th-surface px-2 py-1 text-xs text-th-text-primary placeholder-th-text-faint focus:outline-none"
                placeholder="topic"
                value={pubTopic}
                onChange={(e) => setPubTopic(e.target.value)}
              />
              <textarea
                rows={3}
                className="w-full resize-y rounded border border-th-border bg-th-surface px-2 py-1 font-mono text-xs text-th-text-primary placeholder-th-text-faint focus:outline-none"
                placeholder="payload"
                value={pubPayload}
                onChange={(e) => setPubPayload(e.target.value)}
              />
              <div className="flex items-center gap-2">
                <select
                  className="rounded border border-th-border bg-th-surface px-1 py-0.5 text-xs text-th-text-primary focus:outline-none"
                  value={pubQos}
                  onChange={(e) => setPubQos(Number(e.target.value) as 0|1|2)}
                >
                  <option value={0}>QoS 0</option>
                  <option value={1}>QoS 1</option>
                  <option value={2}>QoS 2</option>
                </select>
                <label className="flex cursor-pointer items-center gap-1 text-xs text-th-text-subtle">
                  <input type="checkbox" checked={pubRetain} onChange={(e) => setPubRetain(e.target.checked)} />
                  Retain
                </label>
                <button
                  onClick={publish}
                  disabled={!connected || !pubTopic.trim()}
                  className="ml-auto flex items-center gap-1 rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-50 focus:outline-none"
                >
                  <Send className="h-3 w-3" /> Publish
                </button>
              </div>
            </div>
          </details>
        </div>

        {/* Right: message log */}
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-th-border px-3 py-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-th-text-subtle">Messages</span>
            <button onClick={() => setMessages([])} className="text-th-text-faint hover:text-th-text-subtle focus:outline-none">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <div ref={logRef} className="flex-1 overflow-y-auto p-2 font-mono text-xs">
            {messages.length === 0 ? (
              <div className="flex h-full items-center justify-center text-th-text-faint">No messages</div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className={cn('mb-1 rounded px-2 py-1', m.direction === 'out' ? 'bg-amber-500/5' : 'bg-blue-500/5')}>
                  <div className="flex items-center gap-2">
                    <span className="text-th-text-faint">{new Date(m.timestamp).toLocaleTimeString()}</span>
                    <span className={cn('font-bold', m.direction === 'out' ? 'text-amber-400' : 'text-blue-400')}>
                      {m.direction === 'out' ? '↑' : '↓'}
                    </span>
                    <span className="font-semibold text-th-text-subtle">{m.topic}</span>
                  </div>
                  <div className="mt-0.5 break-all whitespace-pre-wrap text-th-text-primary">{m.payload}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
