// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { NetworkEditor } from '../NetworkEditor'
import type { InheritedNetwork } from '@/lib/networkSettings'

afterEach(cleanup)

const inherited: InheritedNetwork = {
  timeout: { value: 45_000, source: 'collection "Payments"' },
  followRedirects: { value: true, source: 'the global setting' },
  maxRedirects: { value: 5, source: 'the default' },
}

describe('NetworkEditor', () => {
  it('shows what is inherited, and from where', () => {
    render(<NetworkEditor value={undefined} onChange={vi.fn()} inherited={inherited} />)
    expect(screen.getByTestId('timeout-mode-inherit').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('timeout-inherited').textContent).toBe('Inherited: 45 s from collection "Payments".')
    expect(screen.getByTestId('redirects-inherited').textContent).toBe('Inherited: on from the global setting.')
    expect(screen.getByTestId('max-redirects-inherited').textContent).toBe('Inherited: 5 from the default.')
    expect(screen.queryByTestId('timeout-value')).toBeNull()
  })

  it('shows sub-second values in milliseconds', () => {
    render(<NetworkEditor value={undefined} onChange={vi.fn()} inherited={{ ...inherited, timeout: { value: 250, source: 'request' } }} />)
    expect(screen.getByTestId('timeout-inherited').textContent).toContain('250 ms')
  })

  it('Custom starts from the inherited value', async () => {
    const onChange = vi.fn()
    render(<NetworkEditor value={undefined} onChange={onChange} inherited={inherited} />)
    await userEvent.click(screen.getByTestId('timeout-mode-custom'))
    expect(onChange).toHaveBeenCalledWith({ timeout: 45_000 })
  })

  it('returns undefined once the last override is removed', async () => {
    const onChange = vi.fn()
    render(<NetworkEditor value={{ timeout: 500 }} onChange={onChange} inherited={inherited} />)
    await userEvent.click(screen.getByTestId('timeout-mode-inherit'))
    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  it('takes the timeout in seconds and stores milliseconds, rejecting anything else', () => {
    const onChange = vi.fn()
    render(<NetworkEditor value={{ timeout: 500 }} onChange={onChange} inherited={inherited} />)
    const input = screen.getByTestId('timeout-value') as HTMLInputElement
    expect(input.value).toBe('0.5')
    for (const bad of ['-3', 'abc', '0', '0.0001', '3601', '']) fireEvent.change(input, { target: { value: bad } })
    expect(onChange).not.toHaveBeenCalled()
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('alert').textContent).toMatch(/0\.001 to 3600 seconds/)
    fireEvent.change(input, { target: { value: '2.5' } })
    expect(onChange).toHaveBeenLastCalledWith({ timeout: 2500 })
  })

  it('labels its controls for assistive technology', () => {
    render(<NetworkEditor value={{ timeout: 500, maxRedirects: 2 }} onChange={vi.fn()} inherited={inherited} />)
    expect(screen.getByRole('group', { name: 'Timeout' })).toBeDefined()
    expect(screen.getByRole('group', { name: 'Follow redirects' })).toBeDefined()
    expect(screen.getByLabelText('Timeout in seconds')).toBeDefined()
    expect(screen.getByLabelText('Maximum number of redirects')).toBeDefined()
  })

  it('hides the limit when redirects are off, whether set here or inherited', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<NetworkEditor value={{ timeout: 500 }} onChange={onChange} inherited={inherited} />)
    await userEvent.click(screen.getByTestId('redirects-mode-off'))
    expect(onChange).toHaveBeenCalledWith({ timeout: 500, followRedirects: false })

    rerender(<NetworkEditor value={{ followRedirects: false }} onChange={onChange} inherited={inherited} />)
    expect(screen.queryByTestId('max-redirects-mode')).toBeNull()

    rerender(<NetworkEditor value={undefined} onChange={onChange} inherited={{ ...inherited, followRedirects: { value: false, source: 'folder "F"' } }} />)
    expect(screen.queryByTestId('max-redirects-mode')).toBeNull()
  })

  it('allows a redirect limit of 0 but not above 50', () => {
    const onChange = vi.fn()
    render(<NetworkEditor value={{ maxRedirects: 3 }} onChange={onChange} inherited={inherited} />)
    const input = screen.getByTestId('max-redirects-value')
    fireEvent.change(input, { target: { value: '51' } })
    fireEvent.change(input, { target: { value: '1.5' } })
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '0' } })
    expect(onChange).toHaveBeenLastCalledWith({ maxRedirects: 0 })
  })
})
