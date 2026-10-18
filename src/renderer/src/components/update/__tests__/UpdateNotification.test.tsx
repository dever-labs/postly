// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import React from 'react'
import { UpdateNotification } from '../UpdateNotification'

afterEach(cleanup)

function mount(platform: string) {
  let emit: (e: { type: string; version?: string }) => void = () => {}
  ;(window as unknown as { api: unknown }).api = {
    platform,
    updater: { onEvent: (cb: typeof emit) => { emit = cb; return () => {} }, download: vi.fn(), install: vi.fn() },
  }
  render(<UpdateNotification />)
  act(() => emit({ type: 'available', version: '1.2.3' }))
  return screen.getByTestId('update-banner')
}

describe('UpdateNotification layout', () => {
  it('can be used to drag the window, while its buttons stay clickable', () => {
    const banner = mount('win32')
    expect(banner.className).toContain('drag-region')
    expect(screen.getByText('Download').closest('button')?.className).toContain('no-drag')
    expect(banner.querySelectorAll('button.no-drag').length).toBe(2)
  })

  it('leaves room for the macOS window buttons', () => {
    expect(mount('darwin').className).toContain('pl-20')
  })

  it('leaves room for the minimize/maximize/close buttons on Windows and Linux', () => {
    for (const platform of ['win32', 'linux']) {
      const banner = mount(platform)
      expect(banner.className).toContain('pr-44')
      expect(banner.className).not.toContain('pl-20')
      cleanup()
    }
  })

  it('uses the shared drag-strip spacing', () => {
    const banner = mount('win32')
    expect(banner.className).toContain('pt-8')
    expect(banner.className).toContain('pb-4')
  })
})

describe('UpdateNotification — update that macOS will not install', () => {
  it('points the user to a manual download', () => {
    let emit: (e: Record<string, unknown>) => void = () => {}
    const open = vi.fn()
    vi.stubGlobal('open', open)
    ;(window as unknown as { api: unknown }).api = {
      platform: 'darwin',
      updater: { onEvent: (cb: typeof emit) => { emit = cb; return () => {} }, download: vi.fn(), install: vi.fn() },
    }
    render(<UpdateNotification />)
    act(() => emit({ type: 'error', error: 'did not pass validation', manualInstall: true, url: 'https://example.test/r', version: '1.2.3' }))
    expect(screen.getByText(/can't be installed automatically/)).toBeDefined()
    expect(screen.queryByText(/Update check failed/)).toBeNull()
    act(() => { screen.getByText('Download manually').click() })
    expect(open).toHaveBeenCalledWith('https://example.test/r', '_blank')
    vi.unstubAllGlobals()
  })
})
