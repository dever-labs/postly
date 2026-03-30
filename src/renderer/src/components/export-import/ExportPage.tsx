import { CheckSquare, Database, Download, FileJson, GitBranch, GitFork, Globe, Square, X } from 'lucide-react'
import React, { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useCollectionsStore } from '@/store/collections'
import { useUIStore } from '@/store/ui'
import type { Collection, CollectionSource } from '@/types'

const SOURCE_LABELS: Record<CollectionSource, string> = {
  local: 'Local',
  github: 'GitHub',
  gitlab: 'GitLab',
  backstage: 'Backstage',
  git: 'Git',
}

const SOURCE_ICONS: Record<CollectionSource, React.ReactNode> = {
  local: <Globe className="h-4 w-4" />,
  github: <GitFork className="h-4 w-4" />,
  gitlab: <GitBranch className="h-4 w-4" />,
  backstage: <Database className="h-4 w-4" />,
  git: <GitBranch className="h-4 w-4" />,
}

const SOURCE_ORDER: CollectionSource[] = ['local', 'github', 'gitlab', 'backstage', 'git']

export function ExportPage() {
  const collections = useCollectionsStore((s) => s.collections)
  const { clearSelectedItem, addToast } = useUIStore()

  const [selected, setSelected] = useState<Set<string>>(() => new Set(collections.map((c) => c.id)))
  const [exporting, setExporting] = useState(false)

  const bySource = collections.reduce(
    (acc, col) => {
      const src = (col.source as CollectionSource) || 'local'
      if (!acc[src]) acc[src] = []
      acc[src].push(col)
      return acc
    },
    {} as Partial<Record<CollectionSource, Collection[]>>,
  )

  const toggleCollection = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSource = (cols: Collection[]) => {
    const allSelected = cols.every((c) => selected.has(c.id))
    setSelected((prev) => {
      const next = new Set(prev)
      cols.forEach((c) => (allSelected ? next.delete(c.id) : next.add(c.id)))
      return next
    })
  }

  const handleExport = async () => {
    if (selected.size === 0) return
    setExporting(true)
    const { data, error } = await window.api.exportImport.export({ collectionIds: [...selected] })
    setExporting(false)
    if (error) {
      addToast(`Export failed: ${error}`, 'error')
      return
    }
    if (data) {
      addToast(`Exported ${data.count} collection${data.count !== 1 ? 's' : ''}`, 'success')
      clearSelectedItem()
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="drag-region flex shrink-0 items-center justify-between border-b border-th-border px-6 pt-8 pb-4">
        <div className="no-drag flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 text-xs text-th-text-subtle">
            <FileJson className="h-3.5 w-3.5" />
            Export Collections
          </div>
          <h1 className="text-sm font-semibold text-th-text-primary">Select collections to export</h1>
        </div>
        <button
          onClick={clearSelectedItem}
          className="no-drag rounded-sm p-1 text-th-text-subtle hover:bg-th-surface-raised hover:text-th-text-secondary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-8 pb-4">
        {collections.length === 0 ? (
          <p className="text-sm text-th-text-subtle">No collections to export.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {SOURCE_ORDER.filter((src) => bySource[src]?.length).map((src) => {
              const cols = bySource[src] ?? []
              const allSelected = cols.every((c) => selected.has(c.id))
              const someSelected = cols.some((c) => selected.has(c.id))

              return (
                <div key={src} className="flex flex-col gap-0.5">
                  <button
                    onClick={() => toggleSource(cols)}
                    className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-th-text-subtle hover:bg-th-surface-raised"
                  >
                    <span className={allSelected || someSelected ? 'text-blue-500' : 'text-th-text-faint'}>
                      {allSelected ? (
                        <CheckSquare className="h-3.5 w-3.5" />
                      ) : (
                        <Square className="h-3.5 w-3.5" />
                      )}
                    </span>
                    {SOURCE_ICONS[src]}
                    {SOURCE_LABELS[src]}
                    <span className="ml-auto font-normal normal-case tracking-normal text-th-text-faint">
                      {cols.length}
                    </span>
                  </button>

                  {cols.map((col) => (
                    <button
                      key={col.id}
                      onClick={() => toggleCollection(col.id)}
                      className="flex items-center gap-3 rounded-sm px-3 py-2 hover:bg-th-surface-raised"
                    >
                      <span className={selected.has(col.id) ? 'text-blue-500' : 'text-th-text-faint'}>
                        {selected.has(col.id) ? (
                          <CheckSquare className="h-4 w-4" />
                        ) : (
                          <Square className="h-4 w-4" />
                        )}
                      </span>
                      <span className="flex-1 text-left text-sm text-th-text-primary">{col.name}</span>
                      {col.description && (
                        <span className="max-w-48 truncate text-xs text-th-text-faint">{col.description}</span>
                      )}
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-th-border px-8 py-4 flex items-center gap-3">
        <Button onClick={handleExport} disabled={selected.size === 0 || exporting} className="gap-2">
          <Download className="h-4 w-4" />
          {exporting
            ? 'Exporting…'
            : `Export ${selected.size} collection${selected.size !== 1 ? 's' : ''}`}
        </Button>
        <button
          onClick={clearSelectedItem}
          className="text-sm text-th-text-subtle hover:text-th-text-secondary"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
