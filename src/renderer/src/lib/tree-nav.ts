export interface TreeNavItem {
  level: number
  /** undefined for leaves */
  expanded?: boolean
}

export type TreeNavResult =
  | { type: 'focus'; index: number }
  | { type: 'toggle' }
  | { type: 'activate' }
  | { type: 'menu' }
  | null

/**
 * Keyboard behaviour of the WAI-ARIA tree pattern over the flat list of visible items.
 * Returns what to do for the item at `index`, or null when the key is not handled.
 */
export function navigateTree(items: TreeNavItem[], index: number, key: string, shiftKey = false): TreeNavResult {
  const item = items[index]
  if (!item) return null
  switch (key) {
    case 'ArrowDown': return index < items.length - 1 ? { type: 'focus', index: index + 1 } : null
    case 'ArrowUp': return index > 0 ? { type: 'focus', index: index - 1 } : null
    case 'Home': return { type: 'focus', index: 0 }
    case 'End': return { type: 'focus', index: items.length - 1 }
    case 'ArrowRight':
      if (item.expanded === undefined) return null
      if (!item.expanded) return { type: 'toggle' }
      return items[index + 1] && items[index + 1].level > item.level ? { type: 'focus', index: index + 1 } : null
    case 'ArrowLeft': {
      if (item.expanded) return { type: 'toggle' }
      for (let i = index - 1; i >= 0; i--) if (items[i].level < item.level) return { type: 'focus', index: i }
      return null
    }
    case 'Enter':
    case ' ':
      return { type: 'activate' }
    case 'ContextMenu': return { type: 'menu' }
    case 'F10': return shiftKey ? { type: 'menu' } : null
    default: return null
  }
}
