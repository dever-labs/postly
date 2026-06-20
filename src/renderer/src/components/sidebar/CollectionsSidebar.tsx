import { Globe, Layers, Settings, Link, Download, Upload } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import { DndContext, DragOverlay, closestCenter, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent, DragOverEvent } from '@dnd-kit/core'
import { EnvironmentsPanel } from '@/components/sidebar/EnvironmentsPanel'
import { GroupSection } from '@/components/sidebar/GroupSection'
import { SidebarSearch } from '@/components/sidebar/SidebarSearch'
import { Badge } from '@/components/ui/Badge'
import { useCollectionsStore } from '@/store/collections'
import { useEnvironmentsStore } from '@/store/environments'
import { useIntegrationsStore } from '@/store/integrations'
import { useUIStore } from '@/store/ui'
import { cn } from '@/lib/utils'
import type { CollectionSource, Folder } from '@/types'

const METHOD_COLORS: Record<string, 'green' | 'yellow' | 'blue' | 'red' | 'orange' | 'purple' | 'grey'> = {
  GET: 'green',
  POST: 'yellow',
  PUT: 'blue',
  DELETE: 'red',
  PATCH: 'orange',
  HEAD: 'purple',
  OPTIONS: 'grey',
}

function DragOverlayContent({ id }: { id: string }) {
  const [type, itemId] = id.split(':')
  const { folders, requests } = useCollectionsStore()

  let label = ''
  let badge: React.ReactNode = null

  if (type === 'req') {
    const req = requests.find((request) => request.id === itemId)
    label = req?.name ?? 'Request'
    badge = <Badge variant={METHOD_COLORS[req?.method ?? ''] ?? 'grey'} className="shrink-0 font-mono text-[10px]">{req?.method ?? 'GET'}</Badge>
  } else if (type === 'fld') {
    const folder = folders.find((item) => item.id === itemId)
    label = folder?.name ?? 'Folder'
  }

  return (
    <div className="flex items-center gap-2 rounded-sm border border-blue-500/50 bg-th-surface-raised px-3 py-1.5 text-sm text-th-text-primary opacity-90 shadow-lg">
      {badge}
      <span className="max-w-48 truncate">{label}</span>
    </div>
  )
}

function isDescendant(candidateParentId: string, folderId: string, folders: Folder[]): boolean {
  let current = folders.find((folder) => folder.id === candidateParentId)
  while (current?.parentId) {
    if (current.parentId === folderId) return true
    current = folders.find((folder) => folder.id === current?.parentId)
  }
  return current?.id === folderId
}

async function handleDragEnd(event: DragEndEvent) {
  const { active, over } = event
  if (!over || active.id === over.id) return

  const [activeType, activeId] = String(active.id).split(':') as [string, string]
  const [overType, overId] = String(over.id).split(':') as [string, string]

  const { folders, requests, moveRequestToFolder, moveFolder, moveCollectionToSource } = useCollectionsStore.getState()

  if (activeType === 'req') {
    const activeReq = requests.find((request) => request.id === activeId)
    if (!activeReq) return

    if (overType === 'req') {
      const overReq = requests.find((request) => request.id === overId)
      if (!overReq) return
      const sortedFolderRequests = requests
        .filter((request) => request.folderId === overReq.folderId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
      const activeIdx = sortedFolderRequests.findIndex((request) => request.id === activeId)
      const overIdx = sortedFolderRequests.findIndex((request) => request.id === overId)
      const insertBeforeId = activeIdx < overIdx
        ? sortedFolderRequests[overIdx + 1]?.id ?? null
        : overReq.id
      await moveRequestToFolder(activeId, overReq.folderId, insertBeforeId)
    } else if (overType === 'fld') {
      await moveRequestToFolder(activeId, overId, null)
    }
    return
  }

  if (activeType === 'fld' && overType === 'fld') {
    const activeFolder = folders.find((folder) => folder.id === activeId)
    const overFolder = folders.find((folder) => folder.id === overId)
    if (!activeFolder || !overFolder) return
    if (isDescendant(overFolder.id, activeFolder.id, folders)) return

    const targetParentId = overFolder.parentId ?? null
    const siblings = folders
      .filter((folder) => (folder.parentId ?? null) === targetParentId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    const activeIdx = siblings.findIndex((folder) => folder.id === activeId)
    const overIdx = siblings.findIndex((folder) => folder.id === overId)
    const insertBeforeId = activeIdx < overIdx ? siblings[overIdx + 1]?.id ?? null : overFolder.id

    await moveFolder(activeId, targetParentId, insertBeforeId)
    if (!activeFolder.parentId && !overFolder.parentId && activeFolder.source !== overFolder.source) {
      await moveCollectionToSource(activeId, overFolder.source as CollectionSource)
    }
  }
}

export function CollectionsSidebar() {
  const { folders, requests, searchQuery, load } = useCollectionsStore()
  const { integrations, load: loadIntegrations } = useIntegrationsStore()
  const { load: loadEnvironments } = useEnvironmentsStore()
  const selectItem = useUIStore((state) => state.selectItem)
  const { openSettings, sidebarTab, setSidebarTab } = useUIStore()

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const [dragActiveId, setDragActiveId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  useEffect(() => {
    void load()
    void loadIntegrations()
    void loadEnvironments()
  }, [load, loadIntegrations, loadEnvironments])

  return (
    <div data-testid="sidebar" className="flex h-full flex-col bg-th-bg">
      <div className={cn('flex shrink-0 border-b border-th-border', window.api.platform === 'darwin' && 'pt-8')}>
        <button
          data-testid="tab-apis"
          onClick={() => setSidebarTab('apis')}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 py-3.5 text-xs font-medium transition-colors focus:outline-hidden',
            sidebarTab === 'apis'
              ? 'border-b-2 border-blue-500 text-th-text-primary'
              : 'text-th-text-subtle hover:text-th-text-secondary'
          )}
        >
          <Layers className="h-3.5 w-3.5" />
          APIs
        </button>
        <button
          data-testid="tab-environments"
          onClick={() => setSidebarTab('environments')}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 py-3.5 text-xs font-medium transition-colors focus:outline-hidden',
            sidebarTab === 'environments'
              ? 'border-b-2 border-blue-500 text-th-text-primary'
              : 'text-th-text-subtle hover:text-th-text-secondary'
          )}
        >
          <Globe className="h-3.5 w-3.5" />
          Environments
        </button>
      </div>

      {sidebarTab === 'apis' && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={({ active }) => { setDragActiveId(String(active.id)); setDragOverId(null) }}
          onDragOver={({ over }: DragOverEvent) => setDragOverId(over ? String(over.id) : null)}
          onDragEnd={(event) => { setDragActiveId(null); setDragOverId(null); void handleDragEnd(event) }}
          onDragCancel={() => { setDragActiveId(null); setDragOverId(null) }}
        >
          <>
            <div className="shrink-0 p-2">
              <SidebarSearch />
            </div>

            <div className="flex-1 overflow-y-auto py-1">
              <GroupSection
                source="local"
                integration={null}
                folders={folders}
                requests={requests}
                searchQuery={searchQuery}
                dragActiveId={dragActiveId}
                dragOverId={dragOverId}
              />

              {integrations.map((integration) => (
                <GroupSection
                  key={integration.id}
                  source={integration.type}
                  integration={integration}
                  folders={folders}
                  requests={requests}
                  searchQuery={searchQuery}
                  dragActiveId={dragActiveId}
                  dragOverId={dragOverId}
                />
              ))}

              <div className="mx-2 mb-1 mt-2">
                <button
                  onClick={() => selectItem('add-integration', '')}
                  className="group flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-th-surface-raised focus:outline-hidden"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-dashed border-th-border-strong text-th-text-faint group-hover:border-th-text-muted group-hover:text-th-text-subtle">
                    <Link className="h-3 w-3" />
                  </span>
                  <span className="flex flex-col">
                    <span className="text-xs text-th-text-subtle group-hover:text-th-text-secondary">Connect a source</span>
                    <span className="text-[10px] text-th-text-faint">Git · Backstage · GitHub · GitLab</span>
                  </span>
                </button>
              </div>
            </div>

            <div className="shrink-0 border-t border-th-border">
              <div data-testid="sidebar-footer" className="flex items-center gap-1 px-2 py-2">
                <button
                  data-testid="btn-export"
                  onClick={() => selectItem('export-page', '')}
                  className="rounded-sm p-1.5 text-th-text-subtle hover:bg-th-surface-raised hover:text-th-text-secondary focus:outline-hidden"
                  title="Export collections"
                >
                  <Download className="h-4 w-4" />
                </button>
                <button
                  data-testid="btn-import"
                  onClick={() => selectItem('import-page', '')}
                  className="rounded-sm p-1.5 text-th-text-subtle hover:bg-th-surface-raised hover:text-th-text-secondary focus:outline-hidden"
                  title="Import collections"
                >
                  <Upload className="h-4 w-4" />
                </button>
                <button
                  data-testid="btn-settings"
                  onClick={() => openSettings()}
                  className="ml-auto rounded-sm p-1.5 text-th-text-subtle hover:bg-th-surface-raised hover:text-th-text-secondary focus:outline-hidden"
                  title="Settings"
                >
                  <Settings className="h-4 w-4" />
                </button>
              </div>
            </div>

            <DragOverlay dropAnimation={null}>
              {dragActiveId ? <DragOverlayContent id={dragActiveId} /> : null}
            </DragOverlay>
          </>
        </DndContext>
      )}

      {sidebarTab === 'environments' && (
        <div className="flex flex-1 flex-col overflow-hidden">
          <EnvironmentsPanel />
        </div>
      )}
    </div>
  )
}
