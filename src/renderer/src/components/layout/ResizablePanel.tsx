import React, { useCallback } from 'react'
import { cn } from '@/lib/utils'

interface ResizablePanelProps {
  direction: 'horizontal' | 'vertical'
  onResize: (delta: number) => void
  className?: string
}

export function ResizablePanel({ direction, onResize, className }: ResizablePanelProps) {
  const isHorizontal = direction === 'horizontal'

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      let lastPos = isHorizontal ? e.clientX : e.clientY

      const onMouseMove = (ev: MouseEvent) => {
        const pos = isHorizontal ? ev.clientX : ev.clientY
        const delta = pos - lastPos
        lastPos = pos
        if (delta !== 0) onResize(delta)
      }

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }

      document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [isHorizontal, onResize]
  )

  return (
    <div
      onMouseDown={handleMouseDown}
      className={cn(
        'group relative shrink-0 flex items-center justify-center',
        isHorizontal ? 'w-2 cursor-col-resize' : 'h-2 cursor-row-resize',
        className
      )}
    >
      <div className={cn(
        'bg-th-border transition-all group-hover:bg-blue-500/50',
        isHorizontal
          ? 'h-full w-px group-hover:w-0.5'
          : 'h-px w-full group-hover:h-0.5'
      )} />
    </div>
  )
}
