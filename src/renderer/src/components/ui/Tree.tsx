import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { navigateTree } from '@/lib/tree-nav'

interface TreeContextValue {
  activeKey: string | null
  setActiveKey: (key: string) => void
}

const TreeContext = createContext<TreeContextValue | null>(null)

const ITEM = '[role="treeitem"]'

function visibleItems(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(ITEM))
}

/**
 * ARIA tree with a roving tabindex: one Tab stop for the whole tree, arrow keys to move,
 * Right/Left to expand and collapse, Enter to open and Shift+F10 / the Menu key for the item menu.
 * Items mark their parts with data-tree-toggle, data-tree-primary and data-tree-menu.
 */
export function Tree({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [activeKey, setActiveKeyState] = useState<string | null>(null)
  const setActiveKey = useCallback((key: string) => setActiveKeyState(key), [])

  // Keep exactly one item tabbable, even when the active one is removed or collapsed away.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const ensure = () => {
      const items = visibleItems(root)
      if (items.length === 0) return
      const keys = items.map((el) => el.dataset.treeKey)
      setActiveKeyState((current) => (current && keys.includes(current) ? current : keys[0] ?? null))
    }
    ensure()
    const observer = new MutationObserver(ensure)
    observer.observe(root, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    // Keys typed into inputs or pressed on an item's own buttons keep their normal meaning.
    if (!target.matches(ITEM) || e.altKey || e.ctrlKey || e.metaKey) return
    const root = rootRef.current
    if (!root) return
    const els = visibleItems(root)
    const index = els.indexOf(target)
    const result = navigateTree(
      els.map((el) => ({
        level: Number(el.getAttribute('aria-level')),
        expanded: el.hasAttribute('aria-expanded') ? el.getAttribute('aria-expanded') === 'true' : undefined,
      })),
      index,
      e.key,
      e.shiftKey
    )
    if (!result) return
    e.preventDefault()
    if (result.type === 'focus') els[result.index].focus()
    else if (result.type === 'toggle') target.querySelector<HTMLElement>('[data-tree-toggle]')?.click()
    else if (result.type === 'menu') target.querySelector<HTMLElement>('[data-tree-menu]')?.click()
    else (target.querySelector<HTMLElement>('[data-tree-primary]') ?? target).click()
  }

  return (
    <TreeContext.Provider value={{ activeKey, setActiveKey }}>
      <div ref={rootRef} role="tree" aria-label={label} className={className} onKeyDown={onKeyDown}>
        {children}
      </div>
    </TreeContext.Provider>
  )
}

interface TreeItemOptions {
  /** Unique within the tree */
  itemKey: string
  level: number
  /** Omit for leaves */
  expanded?: boolean
  selected?: boolean
}

/** Props for the element that represents one tree node (the row, not its children). */
export function useTreeItem({ itemKey, level, expanded, selected }: TreeItemOptions) {
  const ctx = useContext(TreeContext)
  return {
    role: 'treeitem' as const,
    'aria-level': level,
    'aria-expanded': expanded,
    'aria-selected': selected ?? false,
    'data-tree-key': itemKey,
    tabIndex: ctx && ctx.activeKey === itemKey ? 0 : -1,
    onFocus: (e: React.FocusEvent<HTMLElement>) => { if (e.target === e.currentTarget) ctx?.setActiveKey(itemKey) },
  }
}
