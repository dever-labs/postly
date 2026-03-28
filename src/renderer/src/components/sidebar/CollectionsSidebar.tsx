import { Plus } from 'lucide-react'
import React, { useEffect } from 'react'
import type { CollectionSource } from '@/types'
import { GroupSection } from '@/components/sidebar/GroupSection'
import { SidebarSearch } from '@/components/sidebar/SidebarSearch'
import { Button } from '@/components/ui/Button'
import { useCollectionsStore } from '@/store/collections'
import { useUIStore } from '@/store/ui'

const SOURCES: CollectionSource[] = ['local', 'backstage', 'github', 'gitlab']

export function CollectionsSidebar() {
  const { collections, groups, requests, searchQuery, load } = useCollectionsStore()
  const addToast = useUIStore((s) => s.addToast)

  useEffect(() => {
    load()
  }, [load])

  const handleNewCollection = async () => {
    const name = window.prompt('Collection name:')
    if (!name?.trim()) return
    const { error } = await (window as any).api.collections.create({ name: name.trim(), source: 'local' })
    if (error) {
      addToast('Failed to create collection', 'error')
    } else {
      addToast('Collection created', 'success')
      load()
    }
  }

  return (
    <div className="flex h-full flex-col border-r border-neutral-800 bg-neutral-950">
      {/* Search */}
      <div className="p-2">
        <SidebarSearch />
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {SOURCES.map((source) => (
          <GroupSection
            key={source}
            source={source}
            collections={collections}
            groups={groups}
            requests={requests}
            searchQuery={searchQuery}
          />
        ))}
      </div>

      {/* Bottom bar */}
      <div className="flex items-center gap-2 border-t border-neutral-800 px-2 py-2">
        <Button variant="ghost" size="sm" className="flex-1 justify-start gap-1.5 text-neutral-400" onClick={handleNewCollection}>
          <Plus className="h-3.5 w-3.5" />
          New Collection
        </Button>
      </div>
    </div>
  )
}
