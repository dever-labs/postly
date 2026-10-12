// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { NetworkEditor } from '../NetworkEditor'

afterEach(cleanup)

describe('NetworkEditor', () => {
  it('shows everything as inherited when nothing is set', () => {
    render(<NetworkEditor value={undefined} onChange={vi.fn()} />)
    expect(screen.getByTestId('timeout-mode-inherit').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('redirects-mode-inherit').getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByTestId('timeout-value')).toBeNull()
  })

  it('switching to a custom timeout starts from 30000 ms', async () => {
    const onChange = vi.fn()
    render(<NetworkEditor value={undefined} onChange={onChange} />)
    await userEvent.click(screen.getByTestId('timeout-mode-custom'))
    expect(onChange).toHaveBeenCalledWith({ timeout: 30000 })
  })

  it('returns undefined once the last override is removed', async () => {
    const onChange = vi.fn()
    render(<NetworkEditor value={{ timeout: 500 }} onChange={onChange} />)
    await userEvent.click(screen.getByTestId('timeout-mode-inherit'))
    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  it('only reports valid timeouts', () => {
    const onChange = vi.fn()
    render(<NetworkEditor value={{ timeout: 500 }} onChange={onChange} />)
    const input = screen.getByTestId('timeout-value')
    fireEvent.change(input, { target: { value: '-3' } })
    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.change(input, { target: { value: '1.5' } })
    expect(onChange).not.toHaveBeenCalled()
    expect(input.getAttribute('aria-invalid')).toBe('true')
    fireEvent.change(input, { target: { value: '2500' } })
    expect(onChange).toHaveBeenLastCalledWith({ timeout: 2500 })
  })

  it('keeps redirect choices independent and hides the limit when redirects are off', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<NetworkEditor value={{ timeout: 500 }} onChange={onChange} />)
    await userEvent.click(screen.getByTestId('redirects-mode-off'))
    expect(onChange).toHaveBeenCalledWith({ timeout: 500, followRedirects: false })

    rerender(<NetworkEditor value={{ timeout: 500, followRedirects: false }} onChange={onChange} />)
    expect(screen.queryByTestId('max-redirects-mode')).toBeNull()
  })

  it('allows a redirect limit of 0 but not above 50', () => {
    const onChange = vi.fn()
    render(<NetworkEditor value={{ maxRedirects: 3 }} onChange={onChange} />)
    const input = screen.getByTestId('max-redirects-value')
    fireEvent.change(input, { target: { value: '51' } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '0' } })
    expect(onChange).toHaveBeenLastCalledWith({ maxRedirects: 0 })
  })
})
