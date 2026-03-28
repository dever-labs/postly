import React, { useEffect } from 'react'
import { AppShell } from './components/layout/AppShell'
import { SettingsModal } from './components/settings/SettingsModal'
import { Toaster } from './components/ui/Toast'
import { useCollectionsStore } from './store/collections'
import { useEnvironmentsStore } from './store/environments'

export default function App(): React.ReactElement {
  const loadCollections = useCollectionsStore((s) => s.load)
  const loadEnvironments = useEnvironmentsStore((s) => s.load)

  useEffect(() => {
    loadCollections()
    loadEnvironments()
  }, [])

  return (
    <div className="h-screen w-screen bg-neutral-950 text-neutral-100 flex flex-col overflow-hidden">
      <AppShell />
      <SettingsModal />
      <Toaster />
    </div>
  )
}
