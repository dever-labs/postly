import https from 'https'
import http from 'http'

export interface AiChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface AiStreamRequest {
  requestId: string
  provider: 'openai' | 'anthropic'
  apiKey: string
  model: string
  messages: AiChatMessage[]
}

const activeRequests = new Map<string, http.ClientRequest>()

export function cancelAiStream(requestId: string): void {
  const req = activeRequests.get(requestId)
  if (req) { req.destroy(); activeRequests.delete(requestId) }
}

export function streamAiResponse(
  params: AiStreamRequest,
  onChunk: (text: string) => void,
  onDone: (error?: string) => void
): void {
  const { requestId, provider, apiKey, model, messages } = params

  if (provider === 'openai') {
    const body = JSON.stringify({
      model: model || 'gpt-4o',
      messages,
      stream: true,
    })
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let buffer = ''
      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed === 'data: [DONE]') continue
          if (trimmed.startsWith('data: ')) {
            try {
              const json = JSON.parse(trimmed.slice(6))
              const text = json.choices?.[0]?.delta?.content
              if (text) onChunk(text)
            } catch {}
          }
        }
      })
      res.on('end', () => { activeRequests.delete(requestId); onDone() })
      res.on('error', (err) => { activeRequests.delete(requestId); onDone(err.message) })
    })
    req.on('error', (err) => { activeRequests.delete(requestId); onDone(err.message) })
    req.write(body)
    req.end()
    activeRequests.set(requestId, req)

  } else { // anthropic
    const anthropicMessages = messages.filter(m => m.role !== 'system')
    const systemMsg = messages.find(m => m.role === 'system')?.content
    const body = JSON.stringify({
      model: model || 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      ...(systemMsg ? { system: systemMsg } : {}),
      messages: anthropicMessages,
      stream: true,
    })
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let buffer = ''
      res.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed.startsWith('data: ')) {
            try {
              const json = JSON.parse(trimmed.slice(6))
              if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') {
                onChunk(json.delta.text)
              }
            } catch {}
          }
        }
      })
      res.on('end', () => { activeRequests.delete(requestId); onDone() })
      res.on('error', (err) => { activeRequests.delete(requestId); onDone(err.message) })
    })
    req.on('error', (err) => { activeRequests.delete(requestId); onDone(err.message) })
    req.write(body)
    req.end()
    activeRequests.set(requestId, req)
  }
}
