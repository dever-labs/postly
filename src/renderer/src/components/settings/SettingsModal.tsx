import { X } from 'lucide-react'
import React, { useState } from 'react'
import { AppearanceSettings } from '@/components/settings/tabs/AppearanceSettings'
import { GeneralSettings } from '@/components/settings/tabs/GeneralSettings'
import { EnvironmentsSettings } from '@/components/settings/tabs/EnvironmentsSettings'
import { useUIStore } from '@/store/ui'
import { cn } from '@/lib/utils'

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'environments', label: 'Environments' },
]

function TabContent({ tab }: { tab: string }) {
  switch (tab) {
    case 'general': return <GeneralSettings />
    case 'appearance': return <AppearanceSettings />
    case 'environments': return <EnvironmentsSettings />
    default: return null
  }
}

export function SettingsModal() {
  const { settingsOpen, settingsTab, closeSettings } = useUIStore()
  const [activeTab, setActiveTab] = useState(settingsTab)

  if (!settingsOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="fixed left-1/2 top-1/2 flex h-[600px] max-h-[90vh] w-[800px] max-w-[95vw] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl border border-th-border bg-th-surface shadow-2xl">
        {/* Left sidebar */}
        <div className="flex w-48 shrink-0 flex-col border-r border-th-border">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="text-sm font-semibold text-th-text-primary">Settings</span>
          </div>
          <nav className="flex flex-col gap-0.5 px-2">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'rounded px-3 py-2 text-left text-sm transition-colors focus:outline-none',
                  activeTab === tab.id
                    ? 'bg-th-surface-raised text-th-text-primary'
                    : 'text-th-text-muted hover:bg-th-surface-raised/60 hover:text-th-text-primary'
                )}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="relative flex flex-1 flex-col overflow-hidden">
          <button
            onClick={closeSettings}
            className="absolute right-3 top-3 z-10 rounded p-1.5 text-th-text-subtle hover:bg-th-surface-raised hover:text-th-text-secondary focus:outline-none"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex-1 overflow-y-auto p-6">
            <TabContent tab={activeTab} />
          </div>
        </div>
      </div>
    </div>
  )
}
