// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { Tree, useTreeItem } from '../Tree'

function Item({ k, level, expanded, onOpen, onToggle, onMenu }: { k: string; level: number; expanded?: boolean; onOpen?: () => void; onToggle?: () => void; onMenu?: () => void }) {
  const props = useTreeItem({ itemKey: k, level, expanded })
  return (
    <div {...props} aria-label={k}>
      <button data-tree-toggle tabIndex={-1} onClick={onToggle}>t</button>
      <button data-tree-primary tabIndex={-1} onClick={onOpen}>p</button>
      <button data-tree-menu tabIndex={-1} onClick={onMenu}>m</button>
    </div>
  )
}

afterEach(cleanup)

describe('Tree', () => {
  it('has a single tab stop (first item) and moves it with focus', async () => {
    render(<Tree label="T"><Item k="a" level={1} /><Item k="b" level={1} /></Tree>)
    const a = screen.getByRole('treeitem', { name: 'a' })
    const b = screen.getByRole('treeitem', { name: 'b' })
    await waitFor(() => expect(a.tabIndex).toBe(0))
    expect(b.tabIndex).toBe(-1)
    a.focus()
    fireEvent.keyDown(a, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(b)
    await waitFor(() => expect(b.tabIndex).toBe(0))
    expect(a.tabIndex).toBe(-1)
  })

  it('maps Enter, ArrowRight and Shift+F10 to the item parts', () => {
    const onOpen = vi.fn(); const onToggle = vi.fn(); const onMenu = vi.fn()
    render(<Tree label="T"><Item k="a" level={1} expanded={false} onOpen={onOpen} onToggle={onToggle} onMenu={onMenu} /></Tree>)
    const a = screen.getByRole('treeitem', { name: 'a' })
    fireEvent.keyDown(a, { key: 'Enter' })
    fireEvent.keyDown(a, { key: 'ArrowRight' })
    fireEvent.keyDown(a, { key: 'F10', shiftKey: true })
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(onMenu).toHaveBeenCalledTimes(1)
  })

  it('ignores keys pressed on inner controls', () => {
    const onOpen = vi.fn()
    render(<Tree label="T"><Item k="a" level={1} onOpen={onOpen} /></Tree>)
    fireEvent.keyDown(screen.getByText('m'), { key: 'ArrowDown' })
    fireEvent.keyDown(screen.getByText('m'), { key: 'Enter' })
    expect(onOpen).not.toHaveBeenCalled()
  })
})
