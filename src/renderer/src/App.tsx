import React, { useEffect } from 'react'
import { AppShell } from './components/layout/AppShell'
import { SettingsModal } from './components/settings/SettingsModal'
import { CommitOverlay } from './components/git/CommitOverlay'
import { DeleteCollectionOverlay } from './components/collections/DeleteCollectionOverlay'
import { DeleteRequestOverlay } from './components/collections/DeleteRequestOverlay'
import { Toaster } from './components/ui/Toast'
import { TooltipProvider } from './components/ui/Tooltip'
import { useCollectionsStore } from './store/collections'
import { useEnvironmentsStore } from './store/environments'

export default function App(): React.ReactElement {
  const loadCollections = useCollectionsStore((s) => s.load)
  const loadEnvironments = useEnvironmentsStore((s) => s.load)

  useEffect(() => {
    loadCollections()
    loadEnvironments()
  }, [loadCollections, loadEnvironments])

  return (
    <TooltipProvider delayDuration={400}>
      <div data-testid="app-root" className="h-screen w-screen bg-th-bg text-th-text-primary flex flex-col overflow-hidden">
        <AppShell />
        <SettingsModal />
        <CommitOverlay />
        <DeleteCollectionOverlay />
        <DeleteRequestOverlay />
        <Toaster />
      </div>
    </TooltipProvider>
  )
}
