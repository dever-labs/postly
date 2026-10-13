// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useState } from 'react'
import { RowMenu, MenuItem } from '../RowMenu'

function Host({ onRename }: { onRename?: () => void }) {
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(true)}>opener</button>
      {renaming && <input data-testid="rename" autoFocus />}
      {open && (
        <RowMenu label="Row actions" onClose={() => setOpen(false)}>
          <MenuItem onClick={() => { setOpen(false); setRenaming(true); onRename?.() }}>Rename</MenuItem>
          <MenuItem onClick={() => setOpen(false)}>Delete</MenuItem>
        </RowMenu>
      )}
    </div>
  )
}

afterEach(cleanup)

function openMenu() {
  render(<Host />)
  const opener = screen.getByText('opener')
  opener.focus()
  fireEvent.click(opener)
  return opener
}

describe('RowMenu', () => {
  it('focuses the first item and cycles with arrows', () => {
    openMenu()
    const [rename, del] = screen.getAllByRole('menuitem')
    expect(document.activeElement).toBe(rename)
    fireEvent.keyDown(rename, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(del)
    fireEvent.keyDown(del, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rename)
    fireEvent.keyDown(rename, { key: 'End' })
    expect(document.activeElement).toBe(del)
  })

  it('Escape closes the menu and restores focus to the opener', () => {
    const opener = openMenu()
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0], { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('does not steal focus back when an action moved it to another input', () => {
    openMenu()
    fireEvent.click(screen.getByText('Rename'))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(screen.getByTestId('rename'))
  })

  it('closes on Tab', () => {
    openMenu()
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0], { key: 'Tab' })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
