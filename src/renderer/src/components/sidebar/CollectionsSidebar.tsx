import { Check, Plus, X } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'
import { ConnectIntegrationDialog } from '@/components/integrations/ConnectIntegrationDialog'
import { GroupSection } from '@/components/sidebar/GroupSection'
import { SidebarSearch } from '@/components/sidebar/SidebarSearch'
import { Button } from '@/components/ui/Button'
import { useCollectionsStore } from '@/store/collections'
import { useIntegrationsStore } from '@/store/integrations'
import { useUIStore } from '@/store/ui'

export function CollectionsSidebar() {
  const { collections, groups, requests, searchQuery, load } = useCollectionsStore()
  const { integrations, load: loadIntegrations } = useIntegrationsStore()
  const addToast = useUIStore((s) => s.addToast)

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [connectDialogOpen, setConnectDialogOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    load()
    loadIntegrations()
  }, [load, loadIntegrations])

  useEffect(() => {
    if (creating) inputRef.current?.focus()
  }, [creating])

  const startCreating = () => {
    setNewName('')
    setCreating(true)
  }

  const cancelCreating = () => {
    setCreating(false)
    setNewName('')
  }

  const confirmCreate = async () => {
    const name = newName.trim()
    if (!name) { cancelCreating(); return }
    setCreating(false)
    setNewName('')
    const { error } = await (window as any).api.collections.create({ name, source: 'local' })
    if (error) {
      addToast('Failed to create collection', 'error')
    } else {
      addToast(`Collection "${name}" created`, 'success')
      load()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') confirmCreate()
    if (e.key === 'Escape') cancelCreating()
  }

  return (
    <div className="flex h-full flex-col border-r border-neutral-800 bg-neutral-950">
      {/* Search */}
      <div className="p-2">
        <SidebarSearch />
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {/* Always show local */}
        <GroupSection
          source="local"
          integration={null}
          collections={collections}
          groups={groups}
          requests={requests}
          searchQuery={searchQuery}
        />

        {/* One section per integration */}
        {integrations.map((integration) => (
          <GroupSection
            key={integration.id}
            source={integration.type}
            integration={integration}
            collections={collections}
            groups={groups}
            requests={requests}
            searchQuery={searchQuery}
          />
        ))}

        {/* Inline new-collection input */}
        {creating && (
          <div className="mx-2 mt-1 flex items-center gap-1 rounded-md border border-blue-500/50 bg-neutral-900 px-2 py-1">
            <input
              ref={inputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Collection name…"
              className="flex-1 bg-transparent text-xs text-neutral-200 placeholder-neutral-500 outline-none"
            />
            <button onClick={confirmCreate} className="text-green-400 hover:text-green-300">
              <Check className="h-3.5 w-3.5" />
            </button>
            <button onClick={cancelCreating} className="text-neutral-500 hover:text-neutral-300">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <button
          onClick={() => setConnectDialogOpen(true)}
          className="mx-2 mt-3 w-[calc(100%-1rem)] rounded-md border border-dashed border-neutral-700 px-3 py-2.5 text-left text-xs text-neutral-500 transition-colors hover:border-neutral-600 hover:text-neutral-400"
        >
          + Add integration (GitHub, GitLab, Backstage) →
        </button>
      </div>

      {/* Bottom bar */}
      <div className="flex items-center gap-2 border-t border-neutral-800 px-2 py-2">
        <Button variant="ghost" size="sm" className="flex-1 justify-start gap-1.5 text-neutral-400" onClick={startCreating}>
          <Plus className="h-3.5 w-3.5" />
          New Collection
        </Button>
      </div>

      <ConnectIntegrationDialog
        open={connectDialogOpen}
        onClose={() => setConnectDialogOpen(false)}
      />
    </div>
  )
}
