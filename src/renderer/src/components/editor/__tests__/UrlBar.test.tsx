// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'

// Mock EnvInput with a plain input so we can test UrlBar's debounce in isolation.
vi.mock('@/components/editor/EnvInput', () => ({
  EnvInput: (props: {
    value?: string
    onChange?: (v: string) => void
    onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
    [k: string]: unknown
  }) => {
    const { onChange, value, onKeyDown, ...rest } = props
    return (
      <input
        {...rest as React.InputHTMLAttributes<HTMLInputElement>}
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={onKeyDown}
      />
    )
  },
}))

import { UrlBar } from '../UrlBar'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

/** Fire a synchronous change event on the url input. */
function changeUrl(value: string) {
  fireEvent.change(screen.getByTestId('url-input'), { target: { value } })
}

describe('UrlBar', () => {
  it('renders with the provided value', () => {
    render(<UrlBar value="https://example.com" onChange={vi.fn()} />)
    expect((screen.getByTestId('url-input') as HTMLInputElement).value).toBe('https://example.com')
  })

  it('syncs display when the external value prop changes', () => {
    const { rerender } = render(<UrlBar value="https://old.com" onChange={vi.fn()} />)
    rerender(<UrlBar value="https://new.com" onChange={vi.fn()} />)
    expect((screen.getByTestId('url-input') as HTMLInputElement).value).toBe('https://new.com')
  })

  // ── Debounce ────────────────────────────────────────────────────────────────

  it('does NOT call onChange synchronously on typing', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    render(<UrlBar value="" onChange={onChange} />)

    changeUrl('abc')
    expect(onChange).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(50) })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('calls onChange with the typed value after the 100ms debounce', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    render(<UrlBar value="" onChange={onChange} />)

    changeUrl('hello')
    act(() => { vi.advanceTimersByTime(100) })

    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith('hello')
  })

  it('debounce resets on each change — only one call after the last change', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    render(<UrlBar value="" onChange={onChange} />)

    const input = screen.getByTestId('url-input')
    fireEvent.change(input, { target: { value: 'a' } })
    act(() => { vi.advanceTimersByTime(50) })   // partial — no flush yet
    fireEvent.change(input, { target: { value: 'ab' } })
    act(() => { vi.advanceTimersByTime(100) })  // final debounce fires

    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith('ab')
  })

  // ── External value sync cancels pending flush ────────────────────────────

  it('cancels pending debounce flush when external value changes', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    const { rerender } = render(<UrlBar value="old" onChange={onChange} />)

    changeUrl('old-edited')
    // External prop changes (e.g. user switches request) before debounce fires
    rerender(<UrlBar value="completely-new" onChange={onChange} />)

    act(() => { vi.advanceTimersByTime(200) })

    // The stale typed value should NOT be propagated
    expect(onChange).not.toHaveBeenCalled()
    expect((screen.getByTestId('url-input') as HTMLInputElement).value).toBe('completely-new')
  })

  // ── handleSend (Enter key) ───────────────────────────────────────────────

  it('Enter key flushes the buffer to onChange and calls onSend immediately', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    const onSend = vi.fn()
    render(<UrlBar value="" onChange={onChange} onSend={onSend} />)

    const input = screen.getByTestId('url-input')
    fireEvent.change(input, { target: { value: 'https://api.example.com' } })

    // Press Enter before the debounce fires
    fireEvent.keyDown(input, { key: 'Enter' })

    // onChange must have been called synchronously (flush), and onSend called
    expect(onChange).toHaveBeenCalledWith('https://api.example.com')
    expect(onSend).toHaveBeenCalledOnce()

    // Debounce timer was cleared — onChange should not fire again
    act(() => { vi.advanceTimersByTime(200) })
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('Enter does not flush when the buffer is already clean (no pending timer)', () => {
    vi.useFakeTimers()
    const onChange = vi.fn()
    const onSend = vi.fn()
    render(<UrlBar value="https://example.com" onChange={onChange} onSend={onSend} />)

    // Press Enter without any typing — no pending debounce timer
    fireEvent.keyDown(screen.getByTestId('url-input'), { key: 'Enter' })

    // onChange not called (nothing to flush), but onSend still fires
    expect(onChange).not.toHaveBeenCalled()
    expect(onSend).toHaveBeenCalledOnce()
  })

  it('Enter does NOT call onSend when isLoading=true', async () => {
    const onSend = vi.fn()
    render(<UrlBar value="" onChange={vi.fn()} onSend={onSend} isLoading={true} />)

    await userEvent.type(screen.getByTestId('url-input'), 'https://test.com')
    await userEvent.keyboard('{Enter}')

    expect(onSend).not.toHaveBeenCalled()
  })
})
