import { ShortcutCheatSheet } from '@/components/shortcuts/ShortcutCheatSheet'
import { CurlImportDialog } from '@/components/editor/CurlImportDialog'
import { CommandPalette } from '@/components/palette/CommandPalette'
import React, { useEffect } from 'react'
import { AppShell } from './components/layout/AppShell'
import { WindowControls } from './components/layout/WindowControls'
import { SettingsModal } from './components/settings/SettingsModal'
import { GitCommitOverlay } from './components/git/GitCommitOverlay'
import { DeleteCollectionOverlay } from './components/collections/DeleteCollectionOverlay'
import { Toaster } from './components/ui/Toast'
import { TooltipProvider } from './components/ui/Tooltip'
import { UpdateNotification } from './components/update/UpdateNotification'
import { useVariablesStore } from './store/variables'

export default function App(): React.ReactElement {
  const loadVariables = useVariablesStore((s) => s.load)

  useEffect(() => {
    window.api.waitForReady().then(() => {
      loadVariables()
    })
  }, [loadVariables])

  return (
    <TooltipProvider delayDuration={400}>
      <div data-testid="app-root" className="relative h-screen w-screen bg-th-bg text-th-text-primary flex flex-col overflow-hidden">
        <UpdateNotification />
        <AppShell />
        {/* Pinned to the window corner so it stays put when the update banner is shown */}
        {window.api.platform !== 'darwin' && <WindowControls />}
        <SettingsModal />
        <GitCommitOverlay />
        <CommandPalette />
        <CurlImportDialog />
        <ShortcutCheatSheet />
        <DeleteCollectionOverlay />
        <Toaster />
      </div>
    </TooltipProvider>
  )
}
