import { describe, it, expect } from 'vitest'
import { createNdjsonParser, createSseParser, streamKindOf, type StreamEvent } from '../stream'

type Raw = Omit<StreamEvent, 'index' | 'at'>
const collect = (kind: 'sse' | 'ndjson') => {
  const out: Raw[] = []
  const parser = kind === 'sse' ? createSseParser((e) => out.push(e)) : createNdjsonParser((e) => out.push(e))
  return { out, parser: parser as ReturnType<typeof createSseParser> }
}

describe('streamKindOf', () => {
  it('detects event streams and ndjson, ignoring parameters and case', () => {
    expect(streamKindOf('text/event-stream; charset=utf-8')).toBe('sse')
    expect(streamKindOf('Application/X-NDJSON')).toBe('ndjson')
    expect(streamKindOf('application/json')).toBeNull()
    expect(streamKindOf(undefined)).toBeNull()
  })
})

describe('createSseParser', () => {
  it('parses id, event, data and retry', () => {
    const { out, parser } = collect('sse')
    parser.push('id: 7\nevent: tick\nretry: 3000\ndata: hello\n\n')
    expect(out).toEqual([{ id: '7', event: 'tick', data: 'hello', retry: 3000 }])
  })

  it('joins multi-line data and ignores comments', () => {
    const { out, parser } = collect('sse')
    parser.push(': keepalive\ndata: a\ndata: b\n\n')
    expect(out).toEqual([{ id: undefined, event: undefined, data: 'a\nb', retry: undefined }])
  })

  it('handles CRLF and CR line endings', () => {
    const { out, parser } = collect('sse')
    parser.push('data: one\r\n\r\ndata: two\r\r')
    expect(out.map((e) => e.data)).toEqual(['one', 'two'])
  })

  it('handles chunks split mid-line and between CR and LF', () => {
    const { out, parser } = collect('sse')
    for (const chunk of ['da', 'ta: he', 'llo\r', '\n\r', '\ndata: next\n', '\n']) parser.push(chunk)
    expect(out.map((e) => e.data)).toEqual(['hello', 'next'])
  })

  it('carries the last event id forward and exposes it', () => {
    const { out, parser } = collect('sse')
    parser.push('id: 1\ndata: a\n\ndata: b\n\n')
    expect(out.map((e) => e.id)).toEqual(['1', '1'])
    expect(parser.lastEventId).toBe('1')
  })

  it('drops an unterminated trailing event and strips a BOM', () => {
    const { out, parser } = collect('sse')
    parser.push('\uFEFFdata: x\n\ndata: partial')
    parser.end()
    expect(out.map((e) => e.data)).toEqual(['x'])
  })

  it('ignores invalid retry values and unknown fields', () => {
    const { out, parser } = collect('sse')
    parser.push('retry: soon\nfoo: bar\ndata\n\n')
    expect(out).toEqual([{ id: undefined, event: undefined, data: '', retry: undefined }])
  })
})

describe('createNdjsonParser', () => {
  it('emits one event per non-empty line, including an unterminated last line', () => {
    const { out, parser } = collect('ndjson')
    parser.push('{"a":1}\n\n{"b"')
    parser.push(':2}\n{"c":3}')
    parser.end()
    expect(out.map((e) => e.data)).toEqual(['{"a":1}', '{"b":2}', '{"c":3}'])
  })
})
