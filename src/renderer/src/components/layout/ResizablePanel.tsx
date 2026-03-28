import React, { useCallback } from 'react'
import { cn } from '@/lib/utils'

interface ResizablePanelProps {
  direction: 'horizontal' | 'vertical'
  onResize: (delta: number) => void
}

export function ResizablePanel({ direction, onResize }: ResizablePanelProps) {
  const isHorizontal = direction === 'horizontal'

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()

      const onMouseMove = (ev: MouseEvent) => {
        onResize(isHorizontal ? ev.movementX : ev.movementY)
      }

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [isHorizontal, onResize]
  )

  return (
    <div
      onMouseDown={handleMouseDown}
      className={cn(
        'shrink-0 bg-neutral-800 transition-colors hover:bg-neutral-600 active:bg-neutral-500',
        isHorizontal ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'
      )}
    />
  )
}
