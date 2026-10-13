import { describe, it, expect } from 'vitest'
import { navigateTree, type TreeNavItem } from '../tree-nav'

const items: TreeNavItem[] = [
  { level: 1, expanded: true },
  { level: 2, expanded: false },
  { level: 2, expanded: true },
  { level: 3 },
  { level: 1, expanded: false },
]

describe('navigateTree', () => {
  it('moves with arrows, Home and End', () => {
    expect(navigateTree(items, 0, 'ArrowDown')).toEqual({ type: 'focus', index: 1 })
    expect(navigateTree(items, 4, 'ArrowDown')).toBeNull()
    expect(navigateTree(items, 0, 'ArrowUp')).toBeNull()
    expect(navigateTree(items, 3, 'ArrowUp')).toEqual({ type: 'focus', index: 2 })
    expect(navigateTree(items, 3, 'Home')).toEqual({ type: 'focus', index: 0 })
    expect(navigateTree(items, 0, 'End')).toEqual({ type: 'focus', index: 4 })
  })

  it('ArrowRight expands closed, then enters first child; no-op on leaves', () => {
    expect(navigateTree(items, 1, 'ArrowRight')).toEqual({ type: 'toggle' })
    expect(navigateTree(items, 2, 'ArrowRight')).toEqual({ type: 'focus', index: 3 })
    expect(navigateTree(items, 3, 'ArrowRight')).toBeNull()
  })

  it('ArrowLeft collapses open, otherwise moves to parent', () => {
    expect(navigateTree(items, 0, 'ArrowLeft')).toEqual({ type: 'toggle' })
    expect(navigateTree(items, 3, 'ArrowLeft')).toEqual({ type: 'focus', index: 2 })
    expect(navigateTree(items, 1, 'ArrowLeft')).toEqual({ type: 'focus', index: 0 })
    expect(navigateTree(items, 4, 'ArrowLeft')).toBeNull()
  })

  it('activates and opens the menu', () => {
    expect(navigateTree(items, 3, 'Enter')).toEqual({ type: 'activate' })
    expect(navigateTree(items, 3, ' ')).toEqual({ type: 'activate' })
    expect(navigateTree(items, 3, 'ContextMenu')).toEqual({ type: 'menu' })
    expect(navigateTree(items, 3, 'F10', true)).toEqual({ type: 'menu' })
    expect(navigateTree(items, 3, 'F10')).toBeNull()
  })

  it('ignores unknown keys and bad indexes', () => {
    expect(navigateTree(items, 0, 'a')).toBeNull()
    expect(navigateTree(items, 9, 'Enter')).toBeNull()
  })
})
