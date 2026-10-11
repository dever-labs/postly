import { RotateCcw } from 'lucide-react'
import type { StreamState } from '@/store/requests'
import { MAX_STREAM_EVENTS } from '../../../../../shared/stream'

interface StreamTabProps {
  stream: StreamState
  onResume: () => void
}

export function StreamTab({ stream, onResume }: StreamTabProps) {
  const lastId = [...stream.events].reverse().find((e) => e.id)?.id
  const canResume = stream.kind === 'sse' && !stream.active && lastId !== undefined

  return (
    <div data-testid="stream-tab" className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-th-border px-4 py-1.5 text-xs text-th-text-subtle">
        <span data-testid="stream-status">
          {stream.active ? 'Receiving' : 'Stream ended'} · {stream.dropped + stream.events.length} {stream.kind === 'sse' ? 'events' : 'lines'}
        </span>
        {canResume && (
          <button
            data-testid="stream-resume"
            onClick={onResume}
            title={`Reconnect with Last-Event-ID: ${lastId}`}
            className="flex items-center gap-1.5 rounded-sm px-2 py-1 hover:bg-th-surface-raised hover:text-th-text-secondary"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Resume from last event
          </button>
        )}
      </div>
      {stream.dropped > 0 && (
        <div data-testid="stream-truncated" className="border-b border-th-border bg-amber-900/10 px-4 py-1 text-xs text-amber-400">
          Showing the latest {MAX_STREAM_EVENTS.toLocaleString()} of {(stream.dropped + stream.events.length).toLocaleString()} events; {stream.dropped.toLocaleString()} earlier events were dropped.
        </div>
      )}
      <div className="flex-1 overflow-auto">
        {stream.events.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-th-text-faint">
            {stream.active ? 'Waiting for events...' : 'No events received'}
          </div>
        ) : (
          stream.events.map((e) => (
            <div key={e.index} data-testid="stream-event" className="flex items-start gap-3 border-b border-th-surface px-4 py-1.5 font-mono text-xs">
              <span className="w-10 shrink-0 text-right text-th-text-faint">{e.index}</span>
              <span className="w-14 shrink-0 text-th-text-faint">{(e.at / 1000).toFixed(2)}s</span>
              {e.event && <span className="shrink-0 rounded-sm bg-th-surface px-1 py-0.5 text-[10px] text-th-text-muted">{e.event}</span>}
              {e.id !== undefined && <span className="shrink-0 text-th-text-faint">id:{e.id}</span>}
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-all text-th-text-secondary">{e.data}</span>
              {e.retry !== undefined && <span className="shrink-0 text-th-text-faint">retry:{e.retry}</span>}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
