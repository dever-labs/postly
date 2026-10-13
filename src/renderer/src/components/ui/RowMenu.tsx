import React, { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

const ITEMS = '[role="menuitem"]:not([disabled])'

interface RowMenuProps {
  label: string
  onClose: () => void
  className?: string
  children: React.ReactNode
}

/** Dropdown menu for a tree row: opens with focus on the first item, arrow keys move, Escape closes and returns focus. */
export function RowMenu({ label, onClose, className, children }: RowMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>(ITEMS)?.focus()
    const menu = ref.current
    return () => {
      // Skip when an action deliberately moved focus elsewhere (e.g. an inline rename input)
      const active = document.activeElement
      const focusLost = !active || active === document.body || (menu?.contains(active) ?? false)
      if (focusLost && opener && opener.isConnected) opener.focus()
    }
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(ITEMS) ?? [])
    const index = items.indexOf(document.activeElement as HTMLElement)
    const move = (to: number) => { e.preventDefault(); items[(to + items.length) % items.length]?.focus() }
    if (e.key === 'ArrowDown') move(index + 1)
    else if (e.key === 'ArrowUp') move(index - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(items.length - 1)
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    else if (e.key === 'Tab') onClose()
  }

  return (
    <>
      <div aria-hidden="true" className="fixed inset-0 z-10" onClick={onClose} />
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        onKeyDown={onKeyDown}
        className={cn('absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-sm border border-th-border-strong bg-th-surface-raised shadow-lg', className)}
      >
        {children}
      </div>
    </>
  )
}

interface MenuItemProps {
  icon?: React.ReactNode
  danger?: boolean
  onClick: (e: React.MouseEvent) => void
  children: React.ReactNode
}

export function MenuItem({ icon, danger, onClick, children }: MenuItemProps) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      className={cn('flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-th-surface-hover', danger ? 'text-rose-400 light:text-rose-800' : 'text-th-text-primary')}
    >
      {icon}
      {children}
    </button>
  )
}
