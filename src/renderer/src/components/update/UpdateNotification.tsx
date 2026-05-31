import { Download, RefreshCw, X } from 'lucide-react'
import React, { useEffect, useState } from 'react'

type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; percent: number }
  | { status: 'downloaded'; version: string }
  | { status: 'error'; message: string }

export function UpdateNotification() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' })

  useEffect(() => {
    const off = window.api.updater.onEvent((event) => {
      if (event.type === 'checking') {
        setState({ status: 'checking' })
      } else if (event.type === 'available') {
        setState({ status: 'available', version: event.version ?? '' })
      } else if (event.type === 'not-available') {
        setState({ status: 'idle' })
      } else if (event.type === 'progress') {
        setState({ status: 'downloading', percent: event.percent ?? 0 })
      } else if (event.type === 'downloaded') {
        setState({ status: 'downloaded', version: event.version ?? '' })
      } else if (event.type === 'error') {
        setState({ status: 'error', message: event.error ?? 'Unknown error' })
      }
    })
    return () => { off() }
  }, [])

  if (state.status === 'idle' || state.status === 'checking') return null

  const dismiss = () => setState({ status: 'idle' })

  if (state.status === 'available') {
    return (
      <Banner color="blue" onDismiss={dismiss}>
        <span>Update <strong>{state.version}</strong> is available.</span>
        <BannerButton onClick={() => window.api.updater.download()} icon={<Download className="h-3.5 w-3.5" />}>
          Download
        </BannerButton>
      </Banner>
    )
  }

  if (state.status === 'downloading') {
    return (
      <Banner color="blue">
        <span>Downloading update… {state.percent}%</span>
        <div className="h-1.5 w-32 rounded-full bg-blue-900 overflow-hidden">
          <div className="h-full rounded-full bg-blue-400 transition-all" style={{ width: `${state.percent}%` }} />
        </div>
      </Banner>
    )
  }

  if (state.status === 'downloaded') {
    return (
      <Banner color="green" onDismiss={dismiss}>
        <span>Update <strong>{state.version}</strong> ready to install.</span>
        <BannerButton onClick={() => window.api.updater.install()} icon={<RefreshCw className="h-3.5 w-3.5" />}>
          Restart &amp; Install
        </BannerButton>
      </Banner>
    )
  }

  if (state.status === 'error') {
    return (
      <Banner color="red" onDismiss={dismiss}>
        <span>Update check failed: {state.message}</span>
      </Banner>
    )
  }

  return null
}

function Banner({
  children,
  color,
  onDismiss,
}: {
  children: React.ReactNode
  color: 'blue' | 'green' | 'red'
  onDismiss?: () => void
}) {
  const bg = { blue: 'bg-blue-950 border-blue-800 text-blue-200', green: 'bg-emerald-950 border-emerald-800 text-emerald-200', red: 'bg-rose-950 border-rose-800 text-rose-200' }[color]
  return (
    <div className={`flex items-center justify-between gap-3 border-b px-4 py-1.5 text-xs ${bg}`}>
      <div className="flex items-center gap-3 flex-1">{children}</div>
      {onDismiss && (
        <button onClick={onDismiss} className="shrink-0 opacity-60 hover:opacity-100 focus:outline-hidden">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

function BannerButton({ children, onClick, icon }: { children: React.ReactNode; onClick: () => void; icon?: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-sm border border-current/30 px-2.5 py-0.5 font-medium opacity-90 hover:opacity-100 focus:outline-hidden"
    >
      {icon}
      {children}
    </button>
  )
}
