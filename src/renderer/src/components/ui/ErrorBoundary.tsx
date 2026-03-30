import React from 'react'
import { AlertCircle } from 'lucide-react'

interface State { error: Error | null }

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-1 flex-col items-center justify-center gap-3 bg-th-bg p-8 text-th-text-faint">
          <AlertCircle className="h-10 w-10 text-rose-400" />
          <p className="text-sm font-medium text-th-text-primary">Something went wrong</p>
          <p className="max-w-sm text-center text-xs text-th-text-muted">{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-2 rounded-sm bg-th-surface px-4 py-1.5 text-xs text-th-text-secondary hover:bg-th-surface-raised"
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
