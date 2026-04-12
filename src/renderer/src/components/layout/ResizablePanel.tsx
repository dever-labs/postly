import React, { useCallback } from 'react'
import { cn } from '@/lib/utils'

interface ResizablePanelProps {
  direction: 'horizontal' | 'vertical'
  /** Called with incremental delta on every mousemove (legacy). Ignored when targetRef is provided. */
  onResize?: (delta: number) => void
  /** When provided, the panel manipulates this element's size directly during drag
   *  and calls onCommit once on mouseup — zero React re-renders during drag. */
  targetRef?: React.RefObject<HTMLDivElement | null>
  /** Called once on mouseup with the final pixel size. Requires targetRef. */
  onCommit?: (size: number) => void
  className?: string
}

export function ResizablePanel({ direction, onResize, targetRef, onCommit, className }: ResizablePanelProps) {
  const isHorizontal = direction === 'horizontal'

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      let lastPos = isHorizontal ? e.clientX : e.clientY

      const onMouseMove = (ev: MouseEvent) => {
        const pos = isHorizontal ? ev.clientX : ev.clientY
        const delta = pos - lastPos
        lastPos = pos
        if (delta === 0) return

        if (targetRef?.current) {
          // Direct DOM mutation — no React re-render on every mousemove
          const sizeProp = isHorizontal ? 'offsetWidth' : 'offsetHeight'
          const styleProp = isHorizontal ? 'width' : 'height'
          targetRef.current.style[styleProp] = `${targetRef.current[sizeProp] + delta}px`
        } else {
          onResize?.(delta)
        }
      }

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        if (targetRef?.current && onCommit) {
          const sizeProp = isHorizontal ? 'offsetWidth' : 'offsetHeight'
          onCommit(targetRef.current[sizeProp])
        }
      }

      document.body.style.cursor = isHorizontal ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [isHorizontal, onResize, targetRef, onCommit]
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
