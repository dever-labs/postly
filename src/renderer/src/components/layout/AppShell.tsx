import React, { useCallback } from 'react'
import { CollectionsSidebar } from '@/components/sidebar/CollectionsSidebar'
import { RequestEditor } from '@/components/editor/RequestEditor'
import { CollectionEditor } from '@/components/editor/CollectionEditor'
import { GroupEditor } from '@/components/editor/GroupEditor'
import { ResponseViewer } from '@/components/response/ResponseViewer'
import { EnvironmentEditor } from '@/components/environments/EnvironmentEditor'
import { ResizablePanel } from '@/components/layout/ResizablePanel'
import { AiChatPanel } from '@/components/ai/AiChatPanel'
import { IntegrationEditPage } from '@/components/integrations/IntegrationEditPage'
import { IntegrationSetupPage } from '@/components/integrations/IntegrationSetupPage'
import { GitSourceView } from '@/components/git/GitSourceView'
import { ExportPage } from '@/components/export-import/ExportPage'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { ImportPage } from '@/components/export-import/ImportPage'
import { WindowControls } from '@/components/layout/WindowControls'
import { useUIStore } from '@/store/ui'
import { useCollectionsStore } from '@/store/collections'
import type { AiContext } from '@/lib/aiContext'

function AiCollectionPage({ collectionId }: { collectionId: string }) {
  const collection = useCollectionsStore((s) => s.collections.find((c) => c.id === collectionId))
  const groups = useCollectionsStore((s) => s.groups.filter((g) => g.collectionId === collectionId))
  const allRequests = useCollectionsStore((s) => s.requests)
  const existingRequests = allRequests.filter((r) => groups.some((g) => g.id === r.groupId))
  if (!collection) return null
  const ctx: AiContext = { type: 'collection', collectionId, name: collection.name, description: collection.description, existingRequests }
  return <AiChatPanel context={ctx} />
}

function AiGroupPage({ groupId }: { groupId: string }) {
  const group = useCollectionsStore((s) => s.groups.find((g) => g.id === groupId))
  const collection = useCollectionsStore((s) => s.collections.find((c) => c.id === group?.collectionId))
  const existingRequests = useCollectionsStore((s) => s.requests.filter((r) => r.groupId === groupId))
  if (!group) return null
  const ctx: AiContext = { type: 'group', collectionId: group.collectionId, groupId, name: group.name, collectionName: collection?.name, description: group.description, existingRequests }
  return <AiChatPanel context={ctx} groupId={groupId} />
}

function AiRequestPage({ requestId }: { requestId: string }) {
  const request = useCollectionsStore((s) => s.requests.find((r) => r.id === requestId))
  const group = useCollectionsStore((s) => s.groups.find((g) => g.id === request?.groupId))
  const collection = useCollectionsStore((s) => s.collections.find((c) => c.id === group?.collectionId))
  const siblingRequests = useCollectionsStore((s) => s.requests.filter((r) => r.groupId === request?.groupId))
  if (!request) return null
  const ctx: AiContext = { type: 'request', collectionId: group?.collectionId, groupId: request.groupId, name: request.name, collectionName: collection?.name, groupName: group?.name, existingRequests: siblingRequests, currentRequest: request }
  return <AiChatPanel context={ctx} groupId={request.groupId} />
}

function useDrag(direction: 'horizontal' | 'vertical', onResize: (delta: number) => void) {  return useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    let last = direction === 'horizontal' ? e.clientX : e.clientY
    const onMove = (ev: MouseEvent) => {
      const pos = direction === 'horizontal' ? ev.clientX : ev.clientY
      const d = pos - last; last = pos
      if (d !== 0) onResize(d)
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [direction, onResize])
}

export function AppShell() {
  const { sidebarWidth, setSidebarWidth, editorHeight, setEditorHeight, sidebarTab, selectedItem } = useUIStore()

  const sidebarDrag = useDrag('horizontal', useCallback((d: number) => {
    const w = useUIStore.getState().sidebarWidth
    setSidebarWidth(Math.max(180, Math.min(600, w + d)))
  }, [setSidebarWidth]))

  return (
    <div className="flex h-screen overflow-hidden bg-th-bg text-th-text-primary">
      {/* Custom window controls — shown on all platforms except macOS which has native traffic lights */}
      {window.api.platform !== 'darwin' && <WindowControls />}
      {/* Sidebar */}
      <div
        style={{ width: typeof sidebarWidth === 'number' ? sidebarWidth : 280 }}
        className="relative shrink-0 overflow-hidden border-r border-th-border backdrop-blur-md"
      >
        <CollectionsSidebar />
        <div
          onMouseDown={sidebarDrag}
          className="absolute inset-y-0 right-0 w-2 cursor-col-resize hover:bg-blue-500/20"
        />
      </div>

      {/* Right pane — drag-region on the wrapper so there's always some
          drag area; individual views add more via their own headers */}
      <div className="drag-region flex flex-1 flex-col overflow-hidden">
        <ErrorBoundary>

        {sidebarTab === 'environments' ? (
          <div className="no-drag flex flex-1 overflow-hidden">
            <EnvironmentEditor />
          </div>
        ) : selectedItem?.type === 'add-integration' ? (
          <div className="no-drag flex flex-1 overflow-hidden">
            <IntegrationSetupPage />
          </div>
        ) : selectedItem?.type === 'edit-integration' ? (
          <div className="no-drag flex flex-1 overflow-hidden">
            <IntegrationEditPage integrationId={selectedItem.id} />
          </div>
        ) : selectedItem?.type === 'export-page' ? (
          <div className="no-drag flex flex-1 flex-col overflow-hidden">
            <ExportPage />
          </div>
        ) : selectedItem?.type === 'import-page' ? (
          <div className="no-drag flex flex-1 flex-col overflow-hidden">
            <ImportPage />
          </div>
        ) : selectedItem?.type === 'git-source' ? (
          <div className="no-drag flex flex-1 overflow-hidden">
            <GitSourceView integrationId={selectedItem.id} />
          </div>
        ) : selectedItem?.type === 'collection' ? (
          <div className="no-drag flex min-h-0 flex-1 flex-col overflow-hidden">
            <CollectionEditor collectionId={selectedItem.id} />
          </div>
        ) : selectedItem?.type === 'group' ? (
          <div className="no-drag flex min-h-0 flex-1 flex-col overflow-hidden">
            <GroupEditor groupId={selectedItem.id} />
          </div>
        ) : selectedItem?.type === 'ai-collection' ? (
          <div className="no-drag flex flex-1 flex-col overflow-hidden">
            <AiCollectionPage collectionId={selectedItem.id} />
          </div>
        ) : selectedItem?.type === 'ai-group' ? (
          <div className="no-drag flex flex-1 flex-col overflow-hidden">
            <AiGroupPage groupId={selectedItem.id} />
          </div>
        ) : selectedItem?.type === 'ai-request' ? (
          <div className="no-drag flex flex-1 flex-col overflow-hidden">
            <AiRequestPage requestId={selectedItem.id} />
          </div>
        ) : (
          <div className="no-drag flex flex-1 flex-col overflow-hidden">
            <div style={{ height: typeof editorHeight === 'number' ? editorHeight : 300 }} className="overflow-hidden">
              <RequestEditor />
            </div>
            <ResizablePanel
              direction="vertical"
              onResize={(d) => {
                const h = useUIStore.getState().editorHeight
                setEditorHeight(Math.max(150, Math.min(800, h + d)))
              }}
            />
            <div className="flex-1 overflow-hidden">
              <ResponseViewer />
            </div>
          </div>
        )}
        </ErrorBoundary>
      </div>
    </div>
  )
}

