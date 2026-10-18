// @vitest-environment happy-dom
import { render, waitFor } from '@testing-library/react'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

const mockLoadCollections = vi.fn(async () => undefined)
const mockLoadEnvironments = vi.fn(async () => undefined)
const mockLoadIntegrations = vi.fn(async () => undefined)
const mockLoadVariables = vi.fn(async () => undefined)
const mockWaitForReady = vi.fn()

vi.mock('./store/collections', () => ({
  useCollectionsStore: (selector: (state: { load: typeof mockLoadCollections }) => unknown) => selector({ load: mockLoadCollections }),
}))

vi.mock('./store/environments', () => ({
  useEnvironmentsStore: (selector: (state: { load: typeof mockLoadEnvironments }) => unknown) => selector({ load: mockLoadEnvironments }),
}))

vi.mock('./store/integrations', () => ({
  useIntegrationsStore: (selector: (state: { load: typeof mockLoadIntegrations }) => unknown) => selector({ load: mockLoadIntegrations }),
}))

vi.mock('./store/variables', () => ({
  useVariablesStore: (selector: (state: { load: typeof mockLoadVariables }) => unknown) => selector({ load: mockLoadVariables }),
}))

vi.mock('./components/layout/AppShell', () => ({ AppShell: () => <div>app shell</div> }))
vi.mock('./components/layout/WindowControls', () => ({ WindowControls: () => <div>window controls</div> }))
vi.mock('./components/settings/SettingsModal', () => ({ SettingsModal: () => <div>settings modal</div> }))
vi.mock('./components/git/GitCommitOverlay', () => ({ GitCommitOverlay: () => <div>git overlay</div> }))
vi.mock('./components/collections/DeleteCollectionOverlay', () => ({ DeleteCollectionOverlay: () => <div>delete collection overlay</div> }))
vi.mock('./components/ui/Toast', () => ({ Toaster: () => <div>toaster</div> }))
vi.mock('./components/ui/Tooltip', () => ({
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('./components/update/UpdateNotification', () => ({ UpdateNotification: () => <div>update notification</div> }))
vi.mock('./components/palette/CommandPalette', () => ({ CommandPalette: () => <div>command palette</div> }))
vi.mock('./components/editor/CurlImportDialog', () => ({ CurlImportDialog: () => <div>curl import dialog</div> }))
vi.mock('./components/shortcuts/ShortcutCheatSheet', () => ({ ShortcutCheatSheet: () => <div>shortcut cheat sheet</div> }))

describe('App', () => {
  beforeEach(() => {
    mockLoadCollections.mockClear()
    mockLoadEnvironments.mockClear()
    mockLoadIntegrations.mockClear()
    mockLoadVariables.mockClear()
    mockWaitForReady.mockClear()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        waitForReady: mockWaitForReady,
        platform: 'linux',
      },
    })
  })

  it('waits for readiness before loading app data', async () => {
    let resolveReady: () => void = () => undefined
    mockWaitForReady.mockReturnValue(new Promise<void>((resolve) => { resolveReady = resolve }))

    render(<App />)

    await waitFor(() => expect(mockWaitForReady).toHaveBeenCalledOnce())
    expect(mockLoadCollections).not.toHaveBeenCalled()
    expect(mockLoadEnvironments).not.toHaveBeenCalled()
    expect(mockLoadIntegrations).not.toHaveBeenCalled()
    expect(mockLoadVariables).not.toHaveBeenCalled()

    resolveReady()

    await waitFor(() => {
      expect(mockLoadCollections).toHaveBeenCalledOnce()
      expect(mockLoadEnvironments).toHaveBeenCalledOnce()
      expect(mockLoadIntegrations).toHaveBeenCalledOnce()
      expect(mockLoadVariables).toHaveBeenCalledOnce()
    })
  })
})
