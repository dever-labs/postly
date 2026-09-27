// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { BackstageSettings } from '../BackstageSettings'
import { useSettingsStore } from '@/store/settings'

// ── Store mocks ───────────────────────────────────────────────────────────────
// @/store/ui reads localStorage at module load time, which isn't available in
// the happy-dom test environment. Stub it the same way other component tests do.

const mockAddToast = vi.fn()
vi.mock('@/store/ui', () => ({
  useUIStore: (selector: (s: { addToast: typeof mockAddToast }) => unknown) =>
    selector({ addToast: mockAddToast }),
}))

// ── window.api mock ──────────────────────────────────────────────────────────

const mockGet = vi.fn()
const mockSet = vi.fn()
const mockAuth = vi.fn()
const mockDisconnect = vi.fn()
const mockSync = vi.fn()

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = {
    settings: { get: mockGet, set: mockSet, getAll: vi.fn().mockResolvedValue({ data: {} }) },
    backstage: { auth: mockAuth, disconnect: mockDisconnect, sync: mockSync },
  }
  mockSet.mockResolvedValue({ error: null })
  useSettingsStore.setState({ loaded: false })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('BackstageSettings — OAuth token persistence', () => {
  it('re-syncs the real token from the DB after sign-in, so a later Save does not wipe it out', async () => {
    // Initial load: OAuth provider configured, not yet signed in.
    mockGet.mockResolvedValueOnce({
      data: { baseUrl: 'https://backstage.example.com', token: '', autoSync: false, authProvider: 'github' },
    })

    mockAuth.mockResolvedValueOnce({
      data: { user: { name: 'Ada Lovelace', email: 'ada@example.com' } },
      error: null,
    })

    // After sign-in, the backend has persisted the real token — the UI must
    // re-fetch it rather than assume it's blank.
    mockGet.mockResolvedValueOnce({
      data: {
        baseUrl: 'https://backstage.example.com',
        token: 'real-oauth-token',
        autoSync: false,
        authProvider: 'github',
        connectedUser: { name: 'Ada Lovelace', email: 'ada@example.com' },
      },
    })

    render(<BackstageSettings />)

    await screen.findByText('Sign in via GitHub')
    await userEvent.click(screen.getByText('Sign in via GitHub'))

    await waitFor(() => expect(screen.getByText('Ada Lovelace')).toBeDefined())

    // Simulate the user then flipping "Auto-sync" and clicking Save — this
    // must not persist an empty token and destroy the just-completed sign-in.
    await userEvent.click(screen.getByText('Auto-sync on startup'))
    await userEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(mockSet).toHaveBeenCalled())
    const savedValue = mockSet.mock.calls[0][0].value
    expect(savedValue.token).toBe('real-oauth-token')
    expect(savedValue.connectedUser?.name).toBe('Ada Lovelace')
  })
})
