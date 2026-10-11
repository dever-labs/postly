/** Incremental parsers for Server-Sent Events and newline-delimited JSON streams. */

export interface StreamEvent {
  /** Position in the stream, starting at 1. */
  index: number
  id?: string
  event?: string
  data: string
  retry?: number
  /** Milliseconds since the stream started. */
  at: number
}

export type StreamKind = 'sse' | 'ndjson'

export const MAX_STREAM_EVENTS = 5000

export function streamKindOf(contentType: string | undefined): StreamKind | null {
  const type = (contentType ?? '').split(';')[0].trim().toLowerCase()
  if (type === 'text/event-stream') return 'sse'
  if (type === 'application/x-ndjson' || type === 'application/ndjson' || type === 'application/jsonl' || type === 'application/x-jsonlines' || type === 'application/stream+json') return 'ndjson'
  return null
}

type Emit = (event: Omit<StreamEvent, 'index' | 'at'>) => void

/** Splits text into lines on \n, \r\n or \r, even when a chunk ends mid-line or between \r and \n. */
function createLineSplitter(onLine: (line: string) => void) {
  let buffer = ''
  let pendingCr = false
  return {
    push(chunk: string) {
      let text = chunk
      if (pendingCr) {
        pendingCr = false
        if (text.startsWith('\n')) text = text.slice(1)
      }
      buffer += text
      let start = 0
      for (let i = 0; i < buffer.length; i++) {
        const c = buffer[i]
        if (c !== '\n' && c !== '\r') continue
        onLine(buffer.slice(start, i))
        if (c === '\r') {
          if (buffer[i + 1] === '\n') i++
          else if (i === buffer.length - 1) pendingCr = true
        }
        start = i + 1
      }
      buffer = buffer.slice(start)
    },
    rest(): string {
      const r = buffer
      buffer = ''
      return r
    },
  }
}

export function createSseParser(emit: Emit) {
  let data: string[] = []
  let event: string | undefined
  let id: string | undefined
  let retry: number | undefined
  let lastId: string | undefined
  let first = true

  const dispatch = () => {
    if (data.length > 0 || event !== undefined || retry !== undefined) {
      emit({ id: id ?? lastId, event, data: data.join('\n'), retry })
    }
    data = []
    event = undefined
    id = undefined
    retry = undefined
  }

  const onLine = (rawLine: string) => {
    let line = rawLine
    if (first) {
      first = false
      if (line.startsWith('\uFEFF')) line = line.slice(1)
    }
    if (line === '') return dispatch()
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') data.push(value)
    else if (field === 'event') event = value
    else if (field === 'id') {
      if (!value.includes('\0')) { id = value; lastId = value }
    } else if (field === 'retry' && /^\d+$/.test(value)) retry = Number(value)
  }

  const splitter = createLineSplitter(onLine)
  return {
    push: (chunk: string) => splitter.push(chunk),
    /** Drops an unterminated trailing event, as the SSE spec requires. */
    end: () => { splitter.rest() },
    get lastEventId() { return lastId },
  }
}

export function createNdjsonParser(emit: Emit) {
  const splitter = createLineSplitter((line) => { if (line.trim() !== '') emit({ data: line }) })
  return {
    push: (chunk: string) => splitter.push(chunk),
    end: () => { const r = splitter.rest(); if (r.trim() !== '') emit({ data: r }) },
  }
}
