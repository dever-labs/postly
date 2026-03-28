import React from 'react'
import { CollectionsSidebar } from '@/components/sidebar/CollectionsSidebar'
import { RequestEditor } from '@/components/editor/RequestEditor'
import { ResponseViewer } from '@/components/response/ResponseViewer'
import { EnvironmentEditor } from '@/components/environments/EnvironmentEditor'
import { ResizablePanel } from '@/components/layout/ResizablePanel'
import { useUIStore } from '@/store/ui'

export function AppShell() {
  const { sidebarWidth, setSidebarWidth, editorHeight, setEditorHeight, sidebarTab } = useUIStore()

  return (
    <div className="flex h-screen overflow-hidden bg-neutral-950 text-neutral-100">
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div style={{ width: sidebarWidth }} className="shrink-0 overflow-hidden">
          <CollectionsSidebar />
        </div>

        <ResizablePanel
          direction="horizontal"
          onResize={(delta) => setSidebarWidth(Math.max(180, Math.min(600, sidebarWidth + delta)))}
        />

        {/* Right pane — swaps based on sidebar tab */}
        {sidebarTab === 'environments' ? (
          <div className="flex flex-1 overflow-hidden">
            <EnvironmentEditor />
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div style={{ height: editorHeight }} className="shrink-0 overflow-hidden">
              <RequestEditor />
            </div>
            <ResizablePanel
              direction="vertical"
              onResize={(delta) => setEditorHeight(Math.max(150, Math.min(800, editorHeight + delta)))}
            />
            <div className="flex-1 overflow-hidden">
              <ResponseViewer />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

