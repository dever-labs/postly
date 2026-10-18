// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { UpdateSettings } from '../UpdateSettings'

const mockSettingsGet = vi.fn()
const mockSettingsSet = vi.fn()
const mockGetEnterpriseConfig = vi.fn()
const mockUpdaterSetFeed = vi.fn()

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = {
    settings: {
      get: mockSettingsGet,
      set: mockSettingsSet,
    },
    updater: {
      getEnterpriseConfig: mockGetEnterpriseConfig,
      setFeed: mockUpdaterSetFeed,
      onEvent: vi.fn(() => () => {}),
      check: vi.fn(),
    },
  }

  mockSettingsGet.mockResolvedValue({ data: { autoUpdate: true, updateFeedUrl: undefined } })
  mockSettingsSet.mockResolvedValue({ data: true })
  mockGetEnterpriseConfig.mockResolvedValue({ data: {} })
  mockUpdaterSetFeed.mockResolvedValue({ data: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('UpdateSettings', () => {
  it('shows a main-process validation error and does not persist the URL', async () => {
    mockUpdaterSetFeed.mockResolvedValueOnce({
      error: 'Update feed URL must use HTTPS. HTTP is only allowed for localhost in development and tests.',
    })

    render(<UpdateSettings />)

    const input = await screen.findByLabelText('Internal update server URL')
    await userEvent.type(input, 'http://updates.example.com/postly/')
    await userEvent.click(screen.getByText('Apply'))

    await waitFor(() => expect(screen.getByText(/must use HTTPS/i)).toBeDefined())
    expect(mockSettingsSet).not.toHaveBeenCalled()
  })

  it('persists a validated update feed URL', async () => {
    mockSettingsGet
      .mockResolvedValueOnce({ data: { autoUpdate: true, updateFeedUrl: undefined } })
      .mockResolvedValueOnce({ data: { autoUpdate: true, updateFeedUrl: undefined } })

    render(<UpdateSettings />)

    const input = await screen.findByLabelText('Internal update server URL')
    await userEvent.type(input, 'https://updates.example.com/postly/')
    await userEvent.click(screen.getByText('Apply'))

    await waitFor(() => expect(mockSettingsSet).toHaveBeenCalledWith({
      key: 'general',
      value: { autoUpdate: true, updateFeedUrl: 'https://updates.example.com/postly/' },
    }))
    expect(screen.getByText(/Internal update server saved/i)).toBeDefined()
  })
})
