import { Settings } from 'lucide-react'
import React, { useEffect } from 'react'
import { CollectionsSidebar } from '@/components/sidebar/CollectionsSidebar'
import { RequestEditor } from '@/components/editor/RequestEditor'
import { ResponseViewer } from '@/components/response/ResponseViewer'
import { ResizablePanel } from '@/components/layout/ResizablePanel'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { useUIStore } from '@/store/ui'
import { useEnvironmentsStore } from '@/store/environments'

export function AppShell() {
  const { sidebarWidth, setSidebarWidth, editorHeight, setEditorHeight, openSettings } = useUIStore()
  const { environments, activeEnv, setActive, load: loadEnvironments } = useEnvironmentsStore()

  useEffect(() => {
    loadEnvironments()
  }, [loadEnvironments])

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-neutral-950 text-neutral-100">
      {/* Toolbar */}
      <div className="flex h-12 shrink-0 items-center gap-4 border-b border-neutral-800 px-4">
        <span className="text-sm font-semibold tracking-wide text-neutral-100">Postly</span>

        <div className="flex flex-1 justify-center">
          <Select
            value={activeEnv?.id ?? '__none__'}
            onValueChange={(val) => {
              if (val !== '__none__') setActive(val)
            }}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="No environment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No environment</SelectItem>
              {environments.map((env) => (
                <SelectItem key={env.id} value={env.id}>
                  {env.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <button
          onClick={() => openSettings()}
          className="rounded p-1.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 focus:outline-none"
          aria-label="Settings"
        >
          <Settings className="h-4 w-4" />
        </button>
      </div>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div style={{ width: sidebarWidth }} className="shrink-0 overflow-hidden">
          <CollectionsSidebar />
        </div>

        <ResizablePanel
          direction="horizontal"
          onResize={(delta) => setSidebarWidth(Math.max(180, Math.min(600, sidebarWidth + delta)))}
        />

        {/* Right pane */}
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
      </div>
    </div>
  )
}
