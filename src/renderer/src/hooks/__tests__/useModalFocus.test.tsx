// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useRef, useState } from 'react'
import { useModalFocus } from '../useModalFocus'

beforeAll(() => {
  // happy-dom has no layout, so every element would count as hidden
  Element.prototype.getClientRects = function () { return [{}] as unknown as DOMRectList }
})
afterEach(cleanup)

function Dialog({ onEscape }: { onEscape?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useModalFocus(ref, { onEscape })
  return (
    <div ref={ref} role="dialog" tabIndex={-1}>
      <button>first</button>
      <button>last</button>
    </div>
  )
}

function Host({ onEscape }: { onEscape?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(true)}>open</button>
      <button onClick={() => setOpen(false)}>close</button>
      {open && <Dialog onEscape={onEscape} />}
    </div>
  )
}

describe('useModalFocus', () => {
  it('moves focus in, traps Tab both ways, and restores focus on close', () => {
    render(<Host />)
    const opener = screen.getByText('open')
    opener.focus()
    fireEvent.click(opener)
    const first = screen.getByText('first')
    const last = screen.getByText('last')
    expect(document.activeElement).toBe(first)

    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)

    cleanup()
    render(<Host />)
    const o = screen.getByText('open')
    o.focus()
    fireEvent.click(o)
    fireEvent.click(screen.getByText('close'))
    expect(document.activeElement).toBe(o)
  })

  it('calls onEscape', () => {
    const onEscape = vi.fn()
    render(<Host onEscape={onEscape} />)
    fireEvent.click(screen.getByText('open'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onEscape).toHaveBeenCalledTimes(1)
  })
})
