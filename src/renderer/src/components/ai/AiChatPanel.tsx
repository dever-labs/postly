import React, { useEffect, useRef, useState } from 'react'
import { Send, Sparkles, Plus, Loader2, StopCircle } from 'lucide-react'
import { useCollectionsStore } from '@/store/collections'
import { useSettingsStore } from '@/store/settings'
import { buildSystemPrompt } from '@/lib/aiContext'
import type { AiContext } from '@/lib/aiContext'
import { cn } from '@/lib/utils'

interface EndpointDraft {
  name: string
  protocol: string
  method: string
  url: string
  description: string
  params: { id: string; key: string; value: string; enabled: boolean }[]
  headers: { id: string; key: string; value: string; enabled: boolean }[]
  bodyType: string
  bodyContent: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  endpoints?: EndpointDraft[]
}

interface Props {
  context: AiContext
  folderId?: string
}

function parseEndpoints(content: string): { text: string; endpoints: EndpointDraft[] } {
  const match = content.match(/```endpoints\n([\s\S]*?)```/)
  if (!match) return { text: content, endpoints: [] }
  try {
    const endpoints = JSON.parse(match[1])
    const text = content.replace(/```endpoints\n[\s\S]*?```/, '').trim()
    return { text, endpoints: Array.isArray(endpoints) ? endpoints : [] }
  } catch {
    return { text: content, endpoints: [] }
  }
}

const STARTERS_BY_TYPE: Record<string, string[]> = {
  collection: [
    'Create a CRUD REST API for a blog',
    'Add a GraphQL API for user queries',
    'Design a WebSocket chat endpoint',
  ],
  group: [
    'Add endpoints for this feature area',
    'Create authentication endpoints',
    'Generate CRUD for a resource',
  ],
  request: [
    'Review this endpoint for best practices',
    'What improvements can I make?',
    'Suggest related endpoints I should add',
  ],
}

export function AiChatPanel({ context, folderId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [addedMap, setAddedMap] = useState<Record<number, Set<number>>>({})
  const scrollRef = useRef<HTMLDivElement>(null)
  const requestIdRef = useRef<string>('')
  const streamBufferRef = useRef<string>('')

  const createLocalRequest = useCollectionsStore((state) => state.createLocalRequest)
  const aiSettings = useSettingsStore((state) => state.ai)

  useEffect(() => {
    const unsub = window.api.ai.onChunk((payload) => {
      if (payload.requestId !== requestIdRef.current) return
      if (payload.done) {
        setStreaming(false)
        const final = streamBufferRef.current
        const { text, endpoints } = parseEndpoints(final)
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: text, endpoints }
          return next
        })
        streamBufferRef.current = ''
      } else {
        streamBufferRef.current += payload.text
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: streamBufferRef.current }
          return next
        })
      }
    })
    return () => { unsub() }
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const send = async () => {
    if (!input.trim() || streaming) return
    const userMsg = input.trim()
    setInput('')
    const newMessages: ChatMessage[] = [...messages, { role: 'user', content: userMsg }]
    setMessages([...newMessages, { role: 'assistant', content: '' }])
    setStreaming(true)
    streamBufferRef.current = ''
    const provider = aiSettings?.provider || 'openai'
    const model = aiSettings?.model || ''
    const requestId = crypto.randomUUID()
    requestIdRef.current = requestId
    const systemPrompt = buildSystemPrompt(context)
    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...newMessages.map((message) => ({ role: message.role, content: message.content })),
    ]
    await window.api.ai.chat({ requestId, provider, model, messages: apiMessages })
  }

  const cancel = () => { window.api.ai.cancel({ requestId: requestIdRef.current }); setStreaming(false) }

  const addEndpoint = async (msgIdx: number, epIdx: number, ep: EndpointDraft) => {
    const targetFolderId = folderId ?? context.folderId ?? context.collectionId
    if (!targetFolderId) return
    const beforeIds = new Set(useCollectionsStore.getState().requests.map((request) => request.id))
    await createLocalRequest(targetFolderId)
    await new Promise((resolve) => setTimeout(resolve, 150))
    const newReq = useCollectionsStore.getState().requests.find((request) => !beforeIds.has(request.id) && request.folderId === targetFolderId)
    if (newReq) {
      await window.api.requests.update({
        id: newReq.id, name: ep.name, protocol: ep.protocol, method: ep.method, url: ep.url,
        description: ep.description,
        params: JSON.stringify(ep.params.map((param) => ({ ...param, id: param.id || crypto.randomUUID() }))),
        headers: JSON.stringify(ep.headers.map((header) => ({ ...header, id: header.id || crypto.randomUUID() }))),
        bodyType: ep.bodyType, bodyContent: ep.bodyContent,
      })
      await useCollectionsStore.getState().load()
    }
    setAddedMap((prev) => ({ ...prev, [msgIdx]: new Set([...(prev[msgIdx] ?? []), epIdx]) }))
  }

  const starters = STARTERS_BY_TYPE[context.type] ?? STARTERS_BY_TYPE.collection
  const contextLabel = context.type === 'request'
    ? `${context.currentRequest?.method ?? ''} ${context.name}`
    : context.name

  return (
    <div className="flex h-full w-full flex-col bg-th-bg">
      <div className="drag-region flex shrink-0 items-center border-b border-th-border px-6 pt-8 pb-4">
        <div className="no-drag">
          <div className="mb-0.5 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-blue-400" />
            <h1 className="text-sm font-semibold text-th-text-primary">AI Assistant</h1>
          </div>
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-th-text-muted">
            <span>{context.type === 'request' ? '🔍 Reviewing' : '✨ Building'}</span>
            {context.collectionName && (
              <>
                <span className="text-th-text-faint">·</span>
                <span className="text-th-text-subtle">{context.collectionName}</span>
              </>
            )}
            {context.folderName && (
              <>
                <span className="text-th-text-faint">/</span>
                <span className="text-th-text-subtle">{context.folderName}</span>
              </>
            )}
            <span className="text-th-text-faint">·</span>
            <span className="font-medium text-th-text-secondary">{contextLabel}</span>
          </p>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto py-6">
        <div className="mx-auto w-full max-w-3xl space-y-5 px-8">
          {messages.length === 0 && (
            <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-4 text-center">
              <Sparkles className="h-10 w-10 text-blue-400/50" />
              <div>
                <p className="mb-1 text-base font-medium text-th-text-secondary">
                  {context.type === 'request' ? 'Review or extend this endpoint' : 'What would you like to build?'}
                </p>
                <p className="text-sm text-th-text-faint">
                  {context.type === 'request'
                    ? 'Ask for a review, improvements, or generate related endpoints.'
                    : 'Describe the API endpoints you need — REST, GraphQL, WebSocket, gRPC, or MQTT.'}
                </p>
              </div>
              <div className="mt-2 flex w-full flex-col gap-2">
                {starters.map((starter) => (
                  <button
                    key={starter}
                    onClick={() => setInput(starter)}
                    className="rounded-lg border border-th-border px-4 py-2.5 text-left text-sm text-th-text-muted transition-colors hover:border-blue-500/50 hover:bg-blue-500/5 hover:text-th-text-primary"
                  >
                    {starter}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, msgIdx) => (
            <div key={msgIdx} className={cn('flex flex-col gap-2', msg.role === 'user' ? 'items-end' : 'items-start')}>
              <div className={cn(
                'max-w-[80%] whitespace-pre-wrap rounded-xl px-4 py-2.5 text-sm leading-relaxed',
                msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-th-surface-raised text-th-text-primary'
              )}>
                {msg.content || (streaming && msgIdx === messages.length - 1
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin text-th-text-faint" />
                  : '')}
              </div>

              {msg.endpoints && msg.endpoints.length > 0 && (
                <div className="mt-1 w-full max-w-[80%] space-y-2">
                  <p className="px-1 text-xs text-th-text-faint">{msg.endpoints.length} endpoint{msg.endpoints.length !== 1 ? 's' : ''} generated</p>
                  {msg.endpoints.map((ep, epIdx) => {
                    const isAdded = addedMap[msgIdx]?.has(epIdx)
                    return (
                      <div key={epIdx} className="flex items-start justify-between gap-3 rounded-lg border border-th-border bg-th-surface px-4 py-3">
                        <div className="min-w-0">
                          <div className="mb-1 flex items-center gap-2">
                            <span className={cn(
                              'shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-bold uppercase',
                              ep.protocol === 'http'
                                ? ep.method === 'GET' ? 'bg-emerald-900/40 text-emerald-400'
                                  : ep.method === 'POST' ? 'bg-blue-900/40 text-blue-400'
                                    : ep.method === 'PUT' || ep.method === 'PATCH' ? 'bg-amber-900/40 text-amber-400'
                                      : ep.method === 'DELETE' ? 'bg-rose-900/40 text-rose-400'
                                        : 'bg-th-surface-raised text-th-text-muted'
                                : 'bg-purple-900/40 text-purple-400'
                            )}>
                              {ep.protocol === 'http' ? ep.method : ep.protocol.toUpperCase()}
                            </span>
                            <span className="truncate text-sm font-medium text-th-text-primary">{ep.name}</span>
                          </div>
                          <p className="truncate font-mono text-xs text-th-text-faint">{ep.url}</p>
                          {ep.description && <p className="mt-1 line-clamp-2 text-xs text-th-text-subtle">{ep.description}</p>}
                        </div>
                        <button
                          onClick={() => addEndpoint(msgIdx, epIdx, ep)}
                          disabled={isAdded}
                          className={cn(
                            'flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus:outline-hidden',
                            isAdded ? 'cursor-default bg-emerald-900/30 text-emerald-500' : 'bg-blue-600 text-white hover:bg-blue-500'
                          )}
                        >
                          {isAdded ? '✓ Added' : <><Plus className="h-3 w-3" /> Add</>}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="shrink-0 border-t border-th-border py-4">
        <div className="mx-auto w-full max-w-3xl px-8">
          <div className="flex items-end gap-3">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder={context.type === 'request' ? 'Ask for a review or request changes…' : 'Describe the endpoints you need…'}
              rows={2}
              className="flex-1 resize-none rounded-lg border border-th-border bg-th-surface px-4 py-2.5 text-sm text-th-text-primary placeholder:text-th-text-faint focus:border-blue-500/50 focus:outline-hidden focus:ring-1 focus:ring-blue-500/30"
            />
            <button
              onClick={streaming ? cancel : send}
              disabled={!streaming && !input.trim()}
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors focus:outline-hidden',
                streaming ? 'bg-rose-600 text-white hover:bg-rose-500' : 'bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40'
              )}
            >
              {streaming ? <StopCircle className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-th-text-faint">Enter to send · Shift+Enter for new line · Configure API key in Settings → AI</p>
        </div>
      </div>
    </div>
  )
}
