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
import type { CollectionSource } from '@/types'

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
  const { collections, groups, requests } = useCollectionsStore()

  let label = ''
  let badge: React.ReactNode = null

  if (type === 'req') {
    const req = requests.find((r) => r.id === itemId)
    label = req?.name ?? 'Request'
    badge = <Badge variant={METHOD_COLORS[req?.method ?? ''] ?? 'grey'} className="shrink-0 font-mono text-[10px]">{req?.method ?? 'GET'}</Badge>
  } else if (type === 'grp') {
    label = groups.find((g) => g.id === itemId)?.name ?? 'Group'
  } else if (type === 'col') {
    label = collections.find((c) => c.id === itemId)?.name ?? 'Collection'
  }

  return (
    <div className="flex items-center gap-2 rounded border border-blue-500/50 bg-th-surface-raised px-3 py-1.5 text-sm text-th-text-primary shadow-lg opacity-90">
      {badge}
      <span className="truncate max-w-48">{label}</span>
    </div>
  )
}

function handleDragEnd(event: DragEndEvent) {
  const { active, over } = event
  if (!over || active.id === over.id) return

  const activeStr = String(active.id)
  const overStr = String(over.id)

  const [activeType, activeId] = activeStr.split(':') as [string, string]
  const [overType, overId] = overStr.split(':') as [string, string]

  const { collections, groups, requests, moveRequestToGroup, moveGroupToCollection, moveCollectionToSource } = useCollectionsStore.getState()

  if (activeType === 'req') {
    const activeReq = requests.find((r) => r.id === activeId)
    if (!activeReq) return

    if (overType === 'req') {
      const overReq = requests.find((r) => r.id === overId)
      if (!overReq) return
      // Determine insert position based on drag direction
      const sortedGroupReqs = requests
        .filter((r) => r.groupId === overReq.groupId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
      const activeIdx = sortedGroupReqs.findIndex((r) => r.id === activeId)
      const overIdx = sortedGroupReqs.findIndex((r) => r.id === overId)
      // Dragging down: insert after over item (before the item after it)
      const insertBeforeId = activeIdx < overIdx
        ? sortedGroupReqs[overIdx + 1]?.id ?? null
        : overReq.id
      moveRequestToGroup(activeId, overReq.groupId, insertBeforeId)
    } else if (overType === 'grp') {
      moveRequestToGroup(activeId, overId, null)
    }
  } else if (activeType === 'grp') {
    const activeGrp = groups.find((g) => g.id === activeId)
    if (!activeGrp) return

    if (overType === 'grp') {
      const overGrp = groups.find((g) => g.id === overId)
      if (!overGrp) return
      const sortedColGroups = groups
        .filter((g) => g.collectionId === overGrp.collectionId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
      const activeIdx = sortedColGroups.findIndex((g) => g.id === activeId)
      const overIdx = sortedColGroups.findIndex((g) => g.id === overId)
      const insertBeforeId = activeIdx < overIdx
        ? sortedColGroups[overIdx + 1]?.id ?? null
        : overGrp.id
      moveGroupToCollection(activeId, overGrp.collectionId, insertBeforeId)
    } else if (overType === 'col') {
      moveGroupToCollection(activeId, overId, null)
    }
  } else if (activeType === 'col') {
    if (overType === 'col') {
      const overCol = collections.find((c) => c.id === overId)
      if (!overCol) return
      moveCollectionToSource(activeId, overCol.source as CollectionSource)
    }
  }
}

export function CollectionsSidebar() {
  const { collections, groups, requests, searchQuery, load } = useCollectionsStore()
  const { integrations, load: loadIntegrations } = useIntegrationsStore()
  const { load: loadEnvironments } = useEnvironmentsStore()
  const selectItem = useUIStore((s) => s.selectItem)
  const { openSettings, sidebarTab, setSidebarTab } = useUIStore()

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const [dragActiveId, setDragActiveId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  useEffect(() => {
    load()
    loadIntegrations()
    loadEnvironments()
  }, [load, loadIntegrations, loadEnvironments])

  return (
    <div data-testid="sidebar" className="flex h-full flex-col bg-th-bg">

      {/* Tab switcher */}
      <div className="flex shrink-0 border-b border-th-border">
        <button
          data-testid="tab-apis"
          onClick={() => setSidebarTab('apis')}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 py-3.5 text-xs font-medium transition-colors focus:outline-none',
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
            'flex flex-1 items-center justify-center gap-1.5 py-3.5 text-xs font-medium transition-colors focus:outline-none',
            sidebarTab === 'environments'
              ? 'border-b-2 border-blue-500 text-th-text-primary'
              : 'text-th-text-subtle hover:text-th-text-secondary'
          )}
        >
          <Globe className="h-3.5 w-3.5" />
          Environments
        </button>
      </div>

      {/* ── APIs tab ─────────────────────────────────────────────────────── */}
      {sidebarTab === 'apis' && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={({ active }) => { setDragActiveId(String(active.id)); setDragOverId(null) }}
          onDragOver={({ over }: DragOverEvent) => setDragOverId(over ? String(over.id) : null)}
          onDragEnd={(event) => { setDragActiveId(null); setDragOverId(null); handleDragEnd(event) }}
          onDragCancel={() => { setDragActiveId(null); setDragOverId(null) }}
        >
        <>
          <div className="shrink-0 p-2">
            <SidebarSearch />
          </div>

          {/* Scrollable tree */}
          <div className="flex-1 overflow-y-auto py-1">
            <GroupSection
              source="local"
              integration={null}
              collections={collections}
              groups={groups}
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
                collections={collections}
                groups={groups}
                requests={requests}
                searchQuery={searchQuery}
                dragActiveId={dragActiveId}
                dragOverId={dragOverId}
              />
            ))}

            {/* Connect source row — lives in the tree so context is clear */}
            <div className="mx-2 mt-2 mb-1">
              <button
                onClick={() => selectItem('add-integration', '')}
                className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-th-surface-raised focus:outline-none group"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-dashed border-th-border-strong text-th-text-faint group-hover:border-th-text-muted group-hover:text-th-text-subtle">
                  <Link className="h-3 w-3" />
                </span>
                <span className="flex flex-col">
                  <span className="text-xs text-th-text-subtle group-hover:text-th-text-secondary">Connect a source</span>
                  <span className="text-[10px] text-th-text-faint">GitHub · GitLab · Backstage</span>
                </span>
              </button>
            </div>
          </div>

          {/* APIs footer — always visible */}
          <div className="shrink-0 border-t border-th-border">
            <div data-testid="sidebar-footer" className="flex items-center gap-1 px-2 py-2">
              <button
                data-testid="btn-export"
                onClick={() => selectItem('export-page', '')}
                className="rounded p-1.5 text-th-text-subtle hover:bg-th-surface-raised hover:text-th-text-secondary focus:outline-none"
                title="Export collections"
              >
                <Download className="h-4 w-4" />
              </button>
              <button
                data-testid="btn-import"
                onClick={() => selectItem('import-page', '')}
                className="rounded p-1.5 text-th-text-subtle hover:bg-th-surface-raised hover:text-th-text-secondary focus:outline-none"
                title="Import collections"
              >
                <Upload className="h-4 w-4" />
              </button>
              <button
                data-testid="btn-settings"
                onClick={() => openSettings()}
                className="ml-auto rounded p-1.5 text-th-text-subtle hover:bg-th-surface-raised hover:text-th-text-secondary focus:outline-none"
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

      {/* ── Environments tab ──────────────────────────────────────────────── */}
      {sidebarTab === 'environments' && (
        <div className="flex flex-1 flex-col overflow-hidden">
          <EnvironmentsPanel />
        </div>
      )}
    </div>
  )
}

