import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import https from 'https'
import { EventEmitter, PassThrough } from 'stream'
import { streamAiResponse, cancelAiStream, type AiStreamRequest } from '../ai'

// api.openai.com / api.anthropic.com are hard-coded, so https.request is the only seam.
class FakeReq extends EventEmitter {
  written = ''
  destroyed = false
  write(chunk: string) { this.written += chunk; return true }
  end() {}
  destroy() { this.destroyed = true }
}

let req: FakeReq
let res: PassThrough
let reqOptions: https.RequestOptions

function mockHttps() {
  req = new FakeReq()
  res = new PassThrough()
  vi.spyOn(https, 'request').mockImplementation(((opts: https.RequestOptions, cb: (r: PassThrough) => void) => {
    reqOptions = opts
    cb(res)
    return req
  }) as never)
}

const base = (over: Partial<AiStreamRequest> = {}): AiStreamRequest => ({
  requestId: 'r1', provider: 'openai', apiKey: 'sk-test', model: '', messages: [{ role: 'user', content: 'hi' }], ...over,
})

function run(params: AiStreamRequest) {
  const chunks: string[] = []
  const done = vi.fn()
  streamAiResponse(params, (t) => chunks.push(t), done)
  return { chunks, done }
}

const sse = (...objs: unknown[]) => objs.map((o) => `data: ${typeof o === 'string' ? o : JSON.stringify(o)}\n\n`).join('')
const tick = () => new Promise((r) => setImmediate(r))

beforeEach(mockHttps)
afterEach(() => vi.restoreAllMocks())

describe('streamAiResponse — openai', () => {
  it('posts to the chat completions endpoint with a bearer key and default model', () => {
    run(base())
    expect(reqOptions).toMatchObject({ hostname: 'api.openai.com', path: '/v1/chat/completions', method: 'POST' })
    expect((reqOptions.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test')
    const body = JSON.parse(req.written)
    expect(body).toMatchObject({ model: 'gpt-4o', stream: true, messages: [{ role: 'user', content: 'hi' }] })
  })

  it('sets Content-Length to the byte length of the body (multi-byte safe)', () => {
    run(base({ messages: [{ role: 'user', content: 'héllo 🌍' }] }))
    expect((reqOptions.headers as Record<string, number>)['Content-Length']).toBe(Buffer.byteLength(req.written))
  })

  it('emits delta content and completes on end, ignoring [DONE] and empty deltas', async () => {
    const { chunks, done } = run(base())
    res.write(sse({ choices: [{ delta: { content: 'Hel' } }] }, { choices: [{ delta: {} }] }, { choices: [{ delta: { content: 'lo' } }] }, '[DONE]'))
    res.end()
    await tick()
    expect(chunks).toEqual(['Hel', 'lo'])
    expect(done).toHaveBeenCalledWith()
  })

  it('reassembles events split across network chunks', async () => {
    const { chunks } = run(base())
    const line = sse({ choices: [{ delta: { content: 'split' } }] })
    res.write(line.slice(0, 15))
    await tick()
    expect(chunks).toEqual([])
    res.write(line.slice(15))
    res.end()
    await tick()
    expect(chunks).toEqual(['split'])
  })

  it('skips malformed JSON lines without failing the stream', async () => {
    const { chunks, done } = run(base())
    res.write(sse('{oops', { choices: [{ delta: { content: 'ok' } }] }))
    res.end()
    await tick()
    expect(chunks).toEqual(['ok'])
    expect(done).toHaveBeenCalledWith()
  })

  it('uses the supplied model', () => {
    run(base({ model: 'gpt-4.1' }))
    expect(JSON.parse(req.written).model).toBe('gpt-4.1')
  })
})

describe('streamAiResponse — anthropic', () => {
  it('sends the x-api-key header, hoists the system prompt, and filters it from messages', () => {
    run(base({
      provider: 'anthropic',
      messages: [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }],
    }))
    expect(reqOptions).toMatchObject({ hostname: 'api.anthropic.com', path: '/v1/messages' })
    const headers = reqOptions.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-test')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    const body = JSON.parse(req.written)
    expect(body.system).toBe('be brief')
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }])
    expect(body.max_tokens).toBe(4096)
  })

  it('omits "system" when no system message is given', () => {
    run(base({ provider: 'anthropic' }))
    expect(JSON.parse(req.written)).not.toHaveProperty('system')
  })

  it('emits only text_delta content blocks', async () => {
    const { chunks, done } = run(base({ provider: 'anthropic' }))
    res.write(sse(
      { type: 'message_start' },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'A' } },
      { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{}' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'B' } },
    ))
    res.end()
    await tick()
    expect(chunks).toEqual(['A', 'B'])
    expect(done).toHaveBeenCalledWith()
  })
})

describe('errors and cancellation', () => {
  it('reports request errors through onDone', () => {
    const { done } = run(base())
    req.emit('error', new Error('ECONNRESET'))
    expect(done).toHaveBeenCalledWith('ECONNRESET')
  })

  it('reports response errors through onDone', async () => {
    const { done } = run(base())
    res.destroy(new Error('stream broke'))
    await tick()
    expect(done).toHaveBeenCalledWith('stream broke')
  })

  it('cancelAiStream destroys the in-flight request', () => {
    run(base({ requestId: 'cancel-me' }))
    cancelAiStream('cancel-me')
    expect(req.destroyed).toBe(true)
  })

  it('cancelAiStream is a no-op for unknown or already-finished requests', async () => {
    expect(() => cancelAiStream('unknown')).not.toThrow()
    run(base({ requestId: 'finished' }))
    res.end()
    await tick()
    cancelAiStream('finished')
    expect(req.destroyed).toBe(false)
  })
})
