import { X } from 'lucide-react'
import React, { useEffect } from 'react'
import { useUIStore } from '@/store/ui'
import { cn } from '@/lib/utils'

const TOAST_DURATION = 3000

function ToastItem({ id, message, type }: { id: string; message: string; type: 'success' | 'error' | 'info' }) {
  const removeToast = useUIStore((s) => s.removeToast)

  useEffect(() => {
    const timer = setTimeout(() => removeToast(id), TOAST_DURATION)
    return () => clearTimeout(timer)
  }, [id, removeToast])

  const borderColor = {
    success: 'border-l-emerald-500',
    error: 'border-l-rose-500',
    info: 'border-l-blue-500',
  }[type]

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded border border-neutral-800 bg-neutral-900 px-4 py-3 shadow-lg border-l-4',
        borderColor
      )}
    >
      <p className="flex-1 text-sm text-neutral-200">{message}</p>
      <button
        onClick={() => removeToast(id)}
        className="shrink-0 text-neutral-500 hover:text-neutral-300 focus:outline-none"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function Toaster() {
  const toasts = useUIStore((s) => s.toasts)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex max-w-sm flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} {...toast} />
      ))}
    </div>
  )
}
