// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { OAuthPanel } from '../OAuthPanel'

// ── UI component mocks ───────────────────────────────────────────────────────
// Radix UI Select requires a full browser environment; swap it for a native
// <select> so tests stay fast and focused on OAuthPanel logic.

vi.mock('@/components/ui/Select', () => ({
  Select: ({ value, onValueChange, children }: { value?: string; onValueChange?: (v: string) => void; children?: React.ReactNode }) => (
    <select data-testid="grant-type-select" value={value} onChange={(e) => onValueChange?.(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children?: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}))

// ── window.api mock ──────────────────────────────────────────────────────────
// Augment the existing window object rather than replacing it, so native
// methods (clearTimeout, etc.) remain intact.

const mockGetToken = vi.fn()
const mockAuthorize = vi.fn()
const mockClearToken = vi.fn()

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = {
    oauth: {
      inline: {
        getToken: mockGetToken,
        authorize: mockAuthorize,
        clearToken: mockClearToken,
      },
    },
  }
  mockGetToken.mockResolvedValue({ data: null })
  mockAuthorize.mockResolvedValue({ data: null })
  mockClearToken.mockResolvedValue({ data: true })
})

afterEach(cleanup)

// ── Helpers ──────────────────────────────────────────────────────────────────

const BASE_CONFIG: Record<string, string> = {
  grantType: 'client_credentials',
  clientId: 'my-client',
  tokenUrl: 'https://token.example.com/token',
  scopes: 'read',
  redirectUri: '',
}

function renderPanel(authConfig: Record<string, string> = BASE_CONFIG, onConfigChange = vi.fn()) {
  return render(<OAuthPanel authConfig={authConfig} onConfigChange={onConfigChange} />)
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('OAuthPanel', () => {
  beforeEach(() => {
    mockGetToken.mockResolvedValue({ data: null })
    mockAuthorize.mockResolvedValue({ data: null })
    mockClearToken.mockResolvedValue({ data: true })
  })

  // ── extraParams stale state fix ──────────────────────────────────────────

  describe('extraParams sync on request switch', () => {
    it('shows extra param key from initial authConfig', async () => {
      const config = { ...BASE_CONFIG, extraParams: JSON.stringify({ audience: 'https://api.example.com' }) }
      renderPanel(config)
      expect(screen.getByDisplayValue('audience')).toBeDefined()
    })

    it('resets extraParams when authConfig.extraParams changes (request switch)', async () => {
      const configA = { ...BASE_CONFIG, extraParams: JSON.stringify({ audience: 'app-a' }) }
      const configB = { ...BASE_CONFIG, extraParams: '' }
      const { rerender } = renderPanel(configA)

      expect(screen.getByDisplayValue('audience')).toBeDefined()

      // Simulate switching to a different request with no extraParams
      rerender(<OAuthPanel authConfig={configB} onConfigChange={vi.fn()} />)

      expect(screen.queryByDisplayValue('audience')).toBeNull()
    })

    it('does not reset extraParams when other authConfig fields change', async () => {
      const config = { ...BASE_CONFIG, extraParams: JSON.stringify({ resource: 'my-api' }) }
      const onConfigChange = vi.fn()
      const { rerender } = renderPanel(config, onConfigChange)

      expect(screen.getByDisplayValue('resource')).toBeDefined()

      // Simulate a different field changing (e.g. tokenUrl edited) — same extraParams
      rerender(<OAuthPanel authConfig={{ ...config, tokenUrl: 'https://new.example.com/token' }} onConfigChange={onConfigChange} />)

      expect(screen.getByDisplayValue('resource')).toBeDefined()
    })
  })

  // ── extra params UI ───────────────────────────────────────────────────────

  describe('extra params UI', () => {
    it('renders the Extra Token Params section', () => {
      renderPanel()
      expect(screen.getByText('Extra Token Params')).toBeDefined()
    })

    it('shows empty hint text when no extra params exist', () => {
      renderPanel()
      expect(screen.getByText(/audience/)).toBeDefined() // hint text
    })

    it('adds a new extra param row when Add is clicked', async () => {
      const user = userEvent.setup()
      renderPanel()
      await user.click(screen.getByText('Add'))
      expect(screen.getByPlaceholderText('Key')).toBeDefined()
      expect(screen.getByPlaceholderText('Value')).toBeDefined()
    })

    it('calls onConfigChange with serialized extraParams when a key is typed', async () => {
      const user = userEvent.setup()
      const onConfigChange = vi.fn()
      renderPanel(BASE_CONFIG, onConfigChange)

      await user.click(screen.getByText('Add'))
      const keyInput = screen.getByPlaceholderText('Key')
      await user.type(keyInput, 'audience')

      const lastCall = onConfigChange.mock.calls.at(-1)?.[0] as Record<string, string>
      expect(lastCall.extraParams).toContain('audience')
    })

    it('removes an extra param row when the delete button is clicked', async () => {
      const user = userEvent.setup()
      const config = { ...BASE_CONFIG, extraParams: JSON.stringify({ audience: 'api' }) }
      renderPanel(config)

      expect(screen.getByDisplayValue('audience')).toBeDefined()
      const deleteButtons = screen.getAllByRole('button').filter(
        (b) => b.className.includes('rose')
      )
      await user.click(deleteButtons[0])
      expect(screen.queryByDisplayValue('audience')).toBeNull()
    })
  })

  // ── pre-flight validation ─────────────────────────────────────────────────

  describe('pre-flight validation', () => {
    it('shows error when scopes are empty on authorize', async () => {
      const user = userEvent.setup()
      renderPanel({ ...BASE_CONFIG, scopes: '' })
      await user.click(screen.getByText('Authorize'))
      expect(screen.getByText(/Scopes are required/)).toBeDefined()
    })

    it('shows error when authUrl is blank for authorization_code flow', async () => {
      const user = userEvent.setup()
      renderPanel({
        ...BASE_CONFIG,
        grantType: 'authorization_code',
        authUrl: '',
        redirectUri: 'http://localhost/cb',
      })
      await user.click(screen.getByText('Authorize'))
      expect(screen.getByText(/Auth URL is required/)).toBeDefined()
    })

    it('shows error when redirectUri is blank for authorization_code flow', async () => {
      const user = userEvent.setup()
      renderPanel({
        ...BASE_CONFIG,
        grantType: 'authorization_code',
        authUrl: 'https://auth.example.com/authorize',
        redirectUri: '',
      })
      await user.click(screen.getByText('Authorize'))
      expect(screen.getByText(/Redirect URI is required/)).toBeDefined()
    })
  })

  // ── getToken error surfacing ──────────────────────────────────────────────

  describe('getToken error surfacing', () => {
    it('displays error from getToken when token refresh fails', async () => {
      mockGetToken.mockResolvedValue({ data: null, error: 'Token refresh failed: Refresh token expired' })
      renderPanel()
      await waitFor(() => {
        expect(screen.getByText('Token refresh failed: Refresh token expired')).toBeDefined()
      })
    })

    it('clears error when authConfig changes', async () => {
      mockGetToken.mockResolvedValueOnce({ data: null, error: 'Refresh failed' })
      mockGetToken.mockResolvedValue({ data: null })
      const { rerender } = renderPanel()

      await waitFor(() => {
        expect(screen.getByText('Refresh failed')).toBeDefined()
      })

      rerender(<OAuthPanel authConfig={{ ...BASE_CONFIG, scopes: 'write' }} onConfigChange={vi.fn()} />)

      await waitFor(() => {
        expect(screen.queryByText('Refresh failed')).toBeNull()
      })
    })
  })

  // ── authorize error surfacing ─────────────────────────────────────────────

  describe('authorize error surfacing', () => {
    it('displays the error message returned by the authorize IPC call', async () => {
      const user = userEvent.setup()
      mockAuthorize.mockResolvedValue({ error: 'Token endpoint returned 401: invalid_client' })
      renderPanel()
      await user.click(screen.getByText('Authorize'))
      await waitFor(() => {
        expect(screen.getByText('Token endpoint returned 401: invalid_client')).toBeDefined()
      })
    })
  })
})
