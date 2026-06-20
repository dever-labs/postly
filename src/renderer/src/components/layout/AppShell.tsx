import React, { useCallback, useRef } from 'react'
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
import type { Folder } from '@/types'

function findRootCollection(folderId: string, folders: Folder[]): Folder | undefined {
  let current = folders.find((folder) => folder.id === folderId)
  while (current?.parentId) {
    current = folders.find((folder) => folder.id === current?.parentId)
  }
  return current
}

function AiCollectionPage({ collectionId }: { collectionId: string }) {
  const collection = useCollectionsStore((state) => state.collections.find((item) => item.id === collectionId))
  const folders = useCollectionsStore((state) => state.folders)
  const requests = useCollectionsStore((state) => state.requests)
  const folderIds = new Set(folders.filter((folder) => findRootCollection(folder.id, folders)?.id === collectionId).map((folder) => folder.id))
  folderIds.add(collectionId)
  const existingRequests = requests.filter((request) => folderIds.has(request.folderId))
  if (!collection) return null
  const ctx: AiContext = { type: 'collection', collectionId, name: collection.name, description: collection.description, existingRequests }
  return <AiChatPanel context={ctx} />
}

function AiGroupPage({ folderId }: { folderId: string }) {
  const folders = useCollectionsStore((state) => state.folders)
  const folder = useCollectionsStore((state) => state.groups.find((item) => item.id === folderId))
  const collection = folder ? findRootCollection(folder.id, folders) : undefined
  const existingRequests = useCollectionsStore((state) => state.requests.filter((request) => request.folderId === folderId))
  if (!folder) return null
  const ctx: AiContext = {
    type: 'group',
    collectionId: collection?.id,
    folderId,
    name: folder.name,
    collectionName: collection?.name,
    description: folder.description,
    existingRequests,
  }
  return <AiChatPanel context={ctx} folderId={folderId} />
}

function AiRequestPage({ requestId }: { requestId: string }) {
  const request = useCollectionsStore((state) => state.requests.find((item) => item.id === requestId))
  const folders = useCollectionsStore((state) => state.folders)
  const folder = request ? folders.find((item) => item.id === request.folderId) : undefined
  const collection = request ? findRootCollection(request.folderId, folders) : undefined
  const siblingRequests = useCollectionsStore((state) => state.requests.filter((item) => item.folderId === request?.folderId))
  if (!request) return null
  const ctx: AiContext = {
    type: 'request',
    collectionId: collection?.id,
    folderId: request.folderId,
    name: request.name,
    collectionName: collection?.name,
    folderName: folder?.name,
    existingRequests: siblingRequests,
    currentRequest: request,
  }
  return <AiChatPanel context={ctx} folderId={request.folderId} />
}

function useDrag(direction: 'horizontal' | 'vertical', containerRef: React.RefObject<HTMLDivElement | null>, min: number, max: number, onCommit: (size: number) => void) {
  return useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    let last = direction === 'horizontal' ? e.clientX : e.clientY
    const styleProp = direction === 'horizontal' ? 'width' : 'height'
    const sizeProp = direction === 'horizontal' ? 'offsetWidth' : 'offsetHeight'

    const onMove = (ev: MouseEvent) => {
      const pos = direction === 'horizontal' ? ev.clientX : ev.clientY
      const d = pos - last; last = pos
      if (d !== 0 && containerRef.current) {
        const next = Math.max(min, Math.min(max, containerRef.current[sizeProp] + d))
        containerRef.current.style[styleProp] = `${next}px`
      }
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      if (containerRef.current) onCommit(containerRef.current[sizeProp])
    }
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [direction, containerRef, min, max, onCommit])
}

export function AppShell() {
  const sidebarTab = useUIStore((state) => state.sidebarTab)
  const selectedItem = useUIStore((state) => state.selectedItem)
  const setSidebarWidth = useUIStore((state) => state.setSidebarWidth)
  const setEditorHeight = useUIStore((state) => state.setEditorHeight)

  const sidebarRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)

  const sidebarDrag = useDrag('horizontal', sidebarRef, 180, 600, setSidebarWidth)
  const { sidebarWidth, editorHeight } = useUIStore.getState()

  return (
    <div className="flex h-screen overflow-hidden bg-th-bg text-th-text-primary">
      <div
        ref={sidebarRef}
        style={{ width: sidebarWidth ?? 280 }}
        className="relative shrink-0 overflow-hidden border-r border-th-border backdrop-blur-md"
      >
        <CollectionsSidebar />
        <div
          onMouseDown={sidebarDrag}
          className="absolute inset-y-0 right-0 w-2 cursor-col-resize hover:bg-blue-500/20"
        />
      </div>

      <div className="drag-region relative flex flex-1 flex-col overflow-hidden">
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
              <IntegrationEditPage key={selectedItem.id} integrationId={selectedItem.id} />
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
              <GroupEditor folderId={selectedItem.id} />
            </div>
          ) : selectedItem?.type === 'ai-collection' ? (
            <div className="no-drag flex flex-1 flex-col overflow-hidden">
              <AiCollectionPage collectionId={selectedItem.id} />
            </div>
          ) : selectedItem?.type === 'ai-group' ? (
            <div className="no-drag flex flex-1 flex-col overflow-hidden">
              <AiGroupPage folderId={selectedItem.id} />
            </div>
          ) : selectedItem?.type === 'ai-request' ? (
            <div className="no-drag flex flex-1 flex-col overflow-hidden">
              <AiRequestPage requestId={selectedItem.id} />
            </div>
          ) : (
            <div className="no-drag flex flex-1 flex-col overflow-hidden">
              <div ref={editorRef} style={{ height: editorHeight ?? 300 }} className="overflow-hidden">
                <RequestEditor />
              </div>
              <ResizablePanel
                direction="vertical"
                targetRef={editorRef}
                onCommit={setEditorHeight}
                minSize={150}
                maxSize={800}
              />
              <div className="flex-1 overflow-hidden">
                <ResponseViewer />
              </div>
            </div>
          )}
        </ErrorBoundary>
        {window.api.platform !== 'darwin' && <WindowControls />}
      </div>
    </div>
  )
}
