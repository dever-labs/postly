// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsModal } from '../SettingsModal'
import { useUIStore } from '@/store/ui'

beforeAll(() => {
  Element.prototype.getClientRects = function () { return [{}] as unknown as DOMRectList }
})

vi.mock('@/components/settings/tabs/AppearanceSettings', () => ({ AppearanceSettings: () => <div>appearance tab</div> }))
vi.mock('@/components/settings/tabs/GeneralSettings', () => ({ GeneralSettings: () => <div>general tab</div> }))
vi.mock('@/components/settings/tabs/VariablesSettings', () => ({ VariablesSettings: () => <div>variables tab</div> }))
vi.mock('@/components/settings/tabs/CertificateSettings', () => ({ CertificateSettings: () => <div>certificates tab</div> }))
vi.mock('@/components/settings/tabs/CookieSettings', () => ({ CookieSettings: () => <div>cookies tab</div> }))
vi.mock('@/components/settings/tabs/AiSettings', () => ({ AiSettings: () => <div>ai tab</div> }))
vi.mock('@/components/settings/tabs/NetworkSettings', () => ({ NetworkSettings: () => <div>network tab</div> }))
vi.mock('@/components/settings/tabs/UpdateSettings', () => ({ UpdateSettings: () => <div>updates tab</div> }))

describe('SettingsModal', () => {
  beforeEach(() => {
    useUIStore.setState({
      settingsOpen: false,
      settingsTab: 'general',
      pendingGitAction: null,
      deletingCollectionId: null,
    })
  })

  afterEach(cleanup)

  it('opens on the requested deep-linked tab and updates when the tab changes', () => {
    render(<SettingsModal />)

    act(() => useUIStore.getState().openSettings('general'))
    expect(screen.getByText('general tab')).toBeDefined()

    act(() => useUIStore.getState().openSettings('cookies'))
    expect(screen.getByText('cookies tab')).toBeDefined()
    expect(screen.queryByText('general tab')).toBeNull()
  })
})
