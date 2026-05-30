import React from 'react'
import { cn } from '@/lib/utils'

interface SendButtonProps {
  onClick: () => void
  onCancel?: () => void
  isLoading: boolean
}

export function SendButton({ onClick, onCancel, isLoading }: SendButtonProps) {
  if (isLoading) {
    return (
      <button
        data-testid="cancel-button"
        onClick={onCancel}
        className={cn(
          'flex h-8 shrink-0 items-center gap-2 rounded-sm px-4 text-sm font-medium text-white transition-colors focus:outline-hidden focus:ring-1 focus:ring-red-400',
          onCancel ? 'bg-red-600 hover:bg-red-500 cursor-pointer' : 'cursor-not-allowed bg-blue-700 opacity-80'
        )}
      >
        Cancel
      </button>
    )
  }

  return (
    <button
      data-testid="send-button"
      onClick={onClick}
      className="flex h-8 shrink-0 items-center gap-2 rounded-sm px-4 text-sm font-medium text-white transition-colors focus:outline-hidden focus:ring-1 focus:ring-blue-400 bg-blue-600 hover:bg-blue-500"
    >
      Send
    </button>
  )
}
