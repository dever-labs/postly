import React from 'react'
import { Sparkles } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/Tooltip'
import { useSettingsStore } from '@/store/settings'
import { cn } from '@/lib/utils'

interface Props {
  onClick: () => void
  label?: string
  /** Extra classes for the button */
  className?: string
  /** Render as a dropdown-menu item row (icon + text) instead of an icon-only button */
  variant?: 'icon' | 'menu-item'
}

export function AiActionButton({ onClick, label = 'Build with AI', className, variant = 'icon' }: Props) {
  const apiKey = useSettingsStore((s) => s.ai?.apiKey)
  const configured = Boolean(apiKey?.trim())

  const button =
    variant === 'menu-item' ? (
      <button
        disabled={!configured}
        onClick={onClick}
        className={cn(
          'flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors',
          configured
            ? 'text-blue-400 hover:bg-th-surface-hover cursor-pointer'
            : 'text-blue-400/40 cursor-not-allowed',
          className
        )}
      >
        <Sparkles className="h-3.5 w-3.5" />
        {label}
      </button>
    ) : (
      <button
        disabled={!configured}
        onClick={onClick}
        className={cn(
          'flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors',
          configured
            ? 'text-blue-400 hover:bg-th-surface-hover cursor-pointer'
            : 'text-blue-400/40 cursor-not-allowed',
          className
        )}
      >
        <Sparkles className="h-3.5 w-3.5" />
        {label}
      </button>
    )

  if (configured) return button

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={variant === 'menu-item' ? 'w-full' : undefined}>{button}</span>
      </TooltipTrigger>
      <TooltipContent side="right">
        AI not configured — add an API key in Settings → AI
      </TooltipContent>
    </Tooltip>
  )
}
