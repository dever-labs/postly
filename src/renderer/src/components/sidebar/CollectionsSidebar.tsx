import { Check, Globe, Layers, Plus, Settings, X, Link, Download, Upload } from 'lucide-react'
import React, { useEffect, useRef, useState } from 'react'
import { ConnectIntegrationDialog } from '@/components/integrations/ConnectIntegrationDialog'
import { EnvironmentsPanel } from '@/components/sidebar/EnvironmentsPanel'
import { GroupSection } from '@/components/sidebar/GroupSection'
import { SidebarSearch } from '@/components/sidebar/SidebarSearch'
import { Button } from '@/components/ui/Button'
import { useCollectionsStore } from '@/store/collections'
import { useEnvironmentsStore } from '@/store/environments'
import { useIntegrationsStore } from '@/store/integrations'
import { useUIStore } from '@/store/ui'
import { cn } from '@/lib/utils'

export function CollectionsSidebar() {
  const { collections, groups, requests, searchQuery, load } = useCollectionsStore()
  const { integrations, load: loadIntegrations } = useIntegrationsStore()
  const { load: loadEnvironments } = useEnvironmentsStore()
  const addToast = useUIStore((s) => s.addToast)
  const { openSettings, sidebarTab, setSidebarTab } = useUIStore()

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [connectDialogOpen, setConnectDialogOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    load()
    loadIntegrations()
    loadEnvironments()
  }, [load, loadIntegrations, loadEnvironments])

  useEffect(() => {
    if (creating) inputRef.current?.focus()
  }, [creating])

  const startCreating = () => { setNewName(''); setCreating(true) }
  const cancelCreating = () => { setCreating(false); setNewName('') }

  const confirmCreate = async () => {
    const name = newName.trim()
    if (!name) { cancelCreating(); return }
    setCreating(false); setNewName('')
    const { error } = await window.api.collections.create({ name, source: 'local' })
    if (error) addToast('Failed to create collection', 'error')
    else { addToast(`Collection "${name}" created`, 'success'); load() }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') confirmCreate()
    if (e.key === 'Escape') cancelCreating()
  }

  return (
    <div className="flex h-full flex-col bg-th-bg">

      {/* Tab switcher */}
      <div className="flex shrink-0 border-b border-th-border">
        <button
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
              />
            ))}

            {/* Inline new-collection input */}
            {creating && (
              <div className="mx-2 mt-1 flex items-center gap-1 rounded-md border border-blue-500/50 bg-th-surface px-2 py-1">
                <input
                  ref={inputRef}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Collection name…"
                  className="flex-1 bg-transparent text-sm text-th-text-primary placeholder-th-text-subtle outline-none"
                />
                <button onClick={confirmCreate} className="text-green-400 hover:text-green-300">
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button onClick={cancelCreating} className="text-th-text-subtle hover:text-th-text-secondary">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Connect source row — lives in the tree so context is clear */}
            <div className="mx-2 mt-2 mb-1">
              <button
                onClick={() => setConnectDialogOpen(true)}
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
            <div className="flex items-center gap-1 px-2 py-2">
              <Button variant="ghost" size="sm" className="flex-1 justify-start gap-1.5 text-th-text-muted" onClick={startCreating}>
                <Plus className="h-3.5 w-3.5" />
                New Collection
              </Button>
              <button
                onClick={async () => {
                  const { data, error } = await window.api.exportImport.export()
                  if (error) { addToast({ type: 'error', message: `Export failed: ${error}` }); return }
                  if (data) addToast({ type: 'success', message: `Exported ${data.count} collection${data.count !== 1 ? 's' : ''}` })
                }}
                className="rounded p-1.5 text-th-text-subtle hover:bg-th-surface-raised hover:text-th-text-secondary focus:outline-none"
                title="Export collections to file"
              >
                <Download className="h-4 w-4" />
              </button>
              <button
                onClick={async () => {
                  const { data, error } = await window.api.exportImport.import()
                  if (error) { addToast({ type: 'error', message: `Import failed: ${error}` }); return }
                  if (data) { await load(); addToast({ type: 'success', message: `Imported ${data.count} collection${data.count !== 1 ? 's' : ''}` }) }
                }}
                className="rounded p-1.5 text-th-text-subtle hover:bg-th-surface-raised hover:text-th-text-secondary focus:outline-none"
                title="Import collections from file"
              >
                <Upload className="h-4 w-4" />
              </button>
              <button
                onClick={() => openSettings()}
                className="rounded p-1.5 text-th-text-subtle hover:bg-th-surface-raised hover:text-th-text-secondary focus:outline-none"
                title="Settings"
              >
                <Settings className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Environments tab ──────────────────────────────────────────────── */}
      {sidebarTab === 'environments' && (
        <div className="flex flex-1 flex-col overflow-hidden">
          <EnvironmentsPanel />
        </div>
      )}

      <ConnectIntegrationDialog
        open={connectDialogOpen}
        onClose={() => setConnectDialogOpen(false)}
      />
    </div>
  )
}

