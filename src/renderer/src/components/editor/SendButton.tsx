import { Loader2 } from 'lucide-react'
import React from 'react'
import { cn } from '@/lib/utils'

interface SendButtonProps {
  onClick: () => void
  isLoading: boolean
}

export function SendButton({ onClick, isLoading }: SendButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={isLoading}
      className={cn(
        'flex h-8 shrink-0 items-center gap-2 rounded px-4 text-sm font-medium text-white transition-colors focus:outline-none focus:ring-1 focus:ring-blue-400',
        isLoading ? 'cursor-not-allowed bg-blue-700 opacity-80' : 'bg-blue-600 hover:bg-blue-500'
      )}
    >
      {isLoading ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Sending</span>
        </>
      ) : (
        'Send'
      )}
    </button>
  )
}
