// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import React from 'react'
import { PreviewTab } from '../tabs/PreviewTab'

const preview = vi.fn()
Object.defineProperty(window, 'api', { value: { response: { preview } }, configurable: true })

afterEach(() => { cleanup(); preview.mockReset() })

describe('PreviewTab', () => {
  it('shows an image from the retained bytes', async () => {
    preview.mockResolvedValue({ data: { mime: 'image/png', base64: 'AAEC' } })
    render(<PreviewTab body="" contentType="image/png" bodyId="b1" binary />)

    const img = await screen.findByAltText('Response preview')
    expect(img.getAttribute('src')).toBe('data:image/png;base64,AAEC')
    expect(preview).toHaveBeenCalledWith({ bodyId: 'b1' })
  })

  it('shows the reason when the preview cannot be loaded', async () => {
    preview.mockResolvedValue({ error: 'Image is too large to preview. Use Save instead.' })
    render(<PreviewTab body="" contentType="image/png" bodyId="b1" binary />)

    await waitFor(() => expect(screen.getByText(/too large to preview/)).toBeDefined())
  })

  it('says so when the image was not retained', () => {
    render(<PreviewTab body="" contentType="image/png" binary />)
    expect(screen.getByText(/too large to preview/)).toBeDefined()
    expect(preview).not.toHaveBeenCalled()
  })

  it('explains that other binary types have no preview', () => {
    render(<PreviewTab body="" contentType="application/pdf" bodyId="b1" binary />)
    expect(screen.getByTestId('preview-unavailable')).toBeDefined()
    expect(preview).not.toHaveBeenCalled()
  })

  it('renders text responses in the sandboxed frame', () => {
    render(<PreviewTab body="<p>hi</p>" contentType="text/html" />)
    const frame = screen.getByTitle('response preview') as HTMLIFrameElement
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin')
  })
})
