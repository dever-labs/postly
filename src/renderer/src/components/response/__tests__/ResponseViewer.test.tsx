// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import type { HttpResponse } from '@/types'

// ── Store mock ────────────────────────────────────────────────────────────────

const storeMock = { response: null as HttpResponse | null, isLoading: false }

vi.mock('@/store/requests', () => ({
  useRequestsStore: (selector?: (s: typeof storeMock) => unknown) =>
    selector ? selector(storeMock) : storeMock,
}))

// ── Heavy child component mocks ───────────────────────────────────────────────
// These pull in Monaco or other complex dependencies not needed for these tests.

vi.mock('@/components/response/tabs/PrettyTab', () => ({
  PrettyTab: ({ body }: { body: string }) => <div data-testid="pretty-tab">{body}</div>,
}))
vi.mock('@/components/response/tabs/RawTab', () => ({
  RawTab: ({ body }: { body: string }) => <div data-testid="raw-tab">{body}</div>,
}))
vi.mock('@/components/response/tabs/PreviewTab', () => ({
  PreviewTab: () => <div data-testid="preview-tab" />,
}))
vi.mock('@/components/response/tabs/ConsoleTab', () => ({
  ConsoleTab: () => <div data-testid="console-tab" />,
}))
vi.mock('@/components/response/ResponseStatus', () => ({
  ResponseStatus: ({ response }: { response: HttpResponse }) => (
    <span data-testid="response-status-inner">{response.status}</span>
  ),
}))

import { ResponseViewer } from '../ResponseViewer'
import { useUIStore } from '@/store/ui'

function makeResponse(overrides: Partial<HttpResponse> = {}): HttpResponse {
  return {
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    body: '{"message":"ok"}',
    size: 16,
    duration: 42,
    logs: [],
    ...overrides,
  }
}

afterEach(() => {
  storeMock.response = null
  storeMock.isLoading = false
  cleanup()
})

// ── Loading state ─────────────────────────────────────────────────────────────

describe('ResponseViewer — loading state', () => {
  it('shows the loading spinner when isLoading=true', () => {
    storeMock.isLoading = true
    render(<ResponseViewer />)

    expect(screen.getByTestId('response-loading')).toBeDefined()
    expect(screen.queryByTestId('response-empty')).toBeNull()
    expect(screen.queryByTestId('response-panel')).toBeNull()
  })

  it('shows "Sending request…" text while loading', () => {
    storeMock.isLoading = true
    render(<ResponseViewer />)

    expect(screen.getByText(/Sending request/i)).toBeDefined()
  })
})

// ── Empty state ───────────────────────────────────────────────────────────────

describe('ResponseViewer — empty state', () => {
  it('shows the empty placeholder when no response and not loading', () => {
    render(<ResponseViewer />)

    expect(screen.getByTestId('response-empty')).toBeDefined()
    expect(screen.queryByTestId('response-loading')).toBeNull()
    expect(screen.queryByTestId('response-panel')).toBeNull()
  })

  it('shows the send-a-request prompt text', () => {
    render(<ResponseViewer />)

    expect(screen.getByText(/Send a request/i)).toBeDefined()
  })
})

// ── Response panel ────────────────────────────────────────────────────────────

describe('ResponseViewer — response panel', () => {
  it('renders the response panel when a response is present', () => {
    storeMock.response = makeResponse()
    render(<ResponseViewer />)

    expect(screen.getByTestId('response-panel')).toBeDefined()
    expect(screen.queryByTestId('response-empty')).toBeNull()
    expect(screen.queryByTestId('response-loading')).toBeNull()
  })

  it('passes the status code to ResponseStatus', () => {
    storeMock.response = makeResponse({ status: 404 })
    render(<ResponseViewer />)

    expect(screen.getByTestId('response-status-inner').textContent).toBe('404')
  })

  it('renders Pretty tab content with the response body', () => {
    storeMock.response = makeResponse({ body: '{"key":"value"}' })
    render(<ResponseViewer />)

    expect(screen.getByTestId('pretty-tab').textContent).toBe('{"key":"value"}')
  })

  it('shows the Copy button', () => {
    storeMock.response = makeResponse()
    render(<ResponseViewer />)

    expect(screen.getByText('Copy')).toBeDefined()
  })

  it('shows "Copied!" feedback text after clicking Copy', async () => {
    storeMock.response = makeResponse({ body: 'test body' })
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })
    render(<ResponseViewer />)

    await userEvent.click(screen.getByText('Copy'))
    expect(screen.getByText('Copied!')).toBeDefined()
  })
})

// ── Console badge ─────────────────────────────────────────────────────────────

describe('ResponseViewer — console alert badge', () => {
  it('shows no badge when there are no warn/error log entries', () => {
    storeMock.response = makeResponse({
      logs: [{ level: 'info', message: 'ok' }],
    })
    render(<ResponseViewer />)

    expect(screen.queryByText('1')).toBeNull()
  })

  it('shows a badge count when there are warn/error log entries', () => {
    storeMock.response = makeResponse({
      logs: [
        { level: 'warn', message: 'slow' },
        { level: 'error', message: 'fail' },
      ],
    })
    render(<ResponseViewer />)

    expect(screen.getByText('2')).toBeDefined()
  })
})

// ── Save and Copy ─────────────────────────────────────────────────────────────

describe('ResponseViewer — save and copy', () => {
  const save = vi.fn()
  const writeText = vi.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    save.mockReset()
    writeText.mockClear()
    Object.defineProperty(window, 'api', { value: { response: { save } }, configurable: true })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    useUIStore.setState({ toasts: [] })
  })

  it('saves the response by its handle and reports the path', async () => {
    storeMock.response = makeResponse({ bodyId: 'b1' })
    save.mockResolvedValue({ data: { filePath: '/tmp/out.json', size: 16 } })
    render(<ResponseViewer />)

    await userEvent.click(screen.getByTestId('response-save'))

    expect(save).toHaveBeenCalledWith({ bodyId: 'b1' })
    await waitFor(() => expect(useUIStore.getState().toasts.map((t) => t.message)).toEqual(['Saved to /tmp/out.json']))
  })

  it('shows an error when saving fails', async () => {
    storeMock.response = makeResponse({ bodyId: 'b1' })
    save.mockResolvedValue({ error: 'EACCES: permission denied' })
    render(<ResponseViewer />)

    await userEvent.click(screen.getByTestId('response-save'))

    await waitFor(() => expect(useUIStore.getState().toasts[0]).toMatchObject({ type: 'error', message: expect.stringContaining('EACCES') }))
  })

  it('stays quiet when the save dialog is cancelled', async () => {
    storeMock.response = makeResponse({ bodyId: 'b1' })
    save.mockResolvedValue({ data: null })
    render(<ResponseViewer />)

    await userEvent.click(screen.getByTestId('response-save'))

    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(useUIStore.getState().toasts).toEqual([])
  })

  it('hides Save when the response has no retained body', () => {
    storeMock.response = makeResponse()
    render(<ResponseViewer />)
    expect(screen.queryByTestId('response-save')).toBeNull()
  })

  it('disables Save and explains when the response was too large to keep', () => {
    storeMock.response = makeResponse({ bodyTooLarge: true })
    render(<ResponseViewer />)

    expect((screen.getByTestId('response-save') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId('response-notice').textContent).toMatch(/cannot be saved/)
  })

  it('explains binary responses and disables Copy', () => {
    storeMock.response = makeResponse({ bodyId: 'b1', binary: true, body: '', headers: { 'content-type': 'image/png' }, size: 2048 })
    render(<ResponseViewer />)

    expect(screen.getByTestId('response-notice').textContent).toMatch(/Binary response \(image\/png, 2\.0 KB\).*Save/)
    expect((screen.getByTestId('response-copy') as HTMLButtonElement).disabled).toBe(true)
  })

  it('notes when only the start of a large body is shown', () => {
    storeMock.response = makeResponse({ bodyId: 'b1', bodyTruncated: true, size: 6 * 1024 * 1024 })
    render(<ResponseViewer />)

    expect(screen.getByTestId('response-notice').textContent).toMatch(/first part of a 6\.0 MB response.*full body/)
  })

  it('copies the displayed text', async () => {
    storeMock.response = makeResponse({ body: '{"a":1}' })
    render(<ResponseViewer />)

    await userEvent.click(screen.getByTestId('response-copy'))

    expect(writeText).toHaveBeenCalledWith('{\n  "a": 1\n}')
  })

  it('copies the exact body on the Raw tab', async () => {
    storeMock.response = makeResponse({ body: '{"a":1}' })
    render(<ResponseViewer />)

    await userEvent.click(screen.getByRole('tab', { name: 'Raw' }))
    await userEvent.click(screen.getByTestId('response-copy'))

    expect(writeText).toHaveBeenCalledWith('{"a":1}')
  })
})
