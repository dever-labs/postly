import { Database, Download, FileJson, GitBranch, GitFork, Globe } from 'lucide-react'
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
  local: <Globe className="h-3.5 w-3.5" />,
  github: <GitFork className="h-3.5 w-3.5" />,
  gitlab: <GitBranch className="h-3.5 w-3.5" />,
  backstage: <Database className="h-3.5 w-3.5" />,
  git: <GitBranch className="h-3.5 w-3.5" />,
}

const SOURCE_ORDER: CollectionSource[] = ['local', 'github', 'gitlab', 'backstage', 'git']

function Checkbox({ checked, indeterminate }: { checked: boolean; indeterminate?: boolean }) {
  return (
    <span
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors ${
        checked || indeterminate
          ? 'border-th-accent bg-th-accent text-white'
          : 'border-th-border bg-th-bg text-transparent'
      }`}
    >
      {indeterminate && !checked ? (
        <span className="block h-0.5 w-2 rounded-full bg-white" />
      ) : checked ? (
        <svg viewBox="0 0 10 8" className="h-2.5 w-2.5" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M1 4l2.5 2.5L9 1" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : null}
    </span>
  )
}

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

  const toggleAll = () => {
    if (selected.size === collections.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(collections.map((c) => c.id)))
    }
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

  const activeSources = SOURCE_ORDER.filter((src) => bySource[src]?.length)
  const allSelected = selected.size === collections.length
  const someSelected = selected.size > 0 && !allSelected

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
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {collections.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <FileJson className="h-8 w-8 text-th-text-muted" />
            <p className="text-sm text-th-text-subtle">No collections to export.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {/* Select all row */}
            <button
              onClick={toggleAll}
              className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-th-surface-raised"
            >
              <Checkbox checked={allSelected} indeterminate={someSelected} />
              <span className="text-sm font-medium text-th-text-secondary">
                {allSelected ? 'Deselect all' : 'Select all'}
              </span>
              <span className="ml-auto text-xs text-th-text-faint">
                {selected.size} / {collections.length}
              </span>
            </button>

            <div className="my-2 border-t border-th-border" />

            {/* Source groups */}
            {activeSources.map((src) => {
              const cols = bySource[src] ?? []
              const allSrcSelected = cols.every((c) => selected.has(c.id))
              const someSrcSelected = cols.some((c) => selected.has(c.id))

              return (
                <div key={src} className="mb-3">
                  {/* Source header */}
                  <button
                    onClick={() => toggleSource(cols)}
                    className="flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 hover:bg-th-surface-raised"
                  >
                    <Checkbox checked={allSrcSelected} indeterminate={someSrcSelected && !allSrcSelected} />
                    <span className="text-th-text-muted">{SOURCE_ICONS[src]}</span>
                    <span className="text-xs font-semibold uppercase tracking-wide text-th-text-subtle">
                      {SOURCE_LABELS[src]}
                    </span>
                    <span className="ml-auto text-xs text-th-text-faint">{cols.length}</span>
                  </button>

                  {/* Collections */}
                  <div className="mt-0.5 flex flex-col gap-0.5 pl-4">
                    {cols.map((col) => (
                      <button
                        key={col.id}
                        onClick={() => toggleCollection(col.id)}
                        className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-th-surface-raised"
                      >
                        <Checkbox checked={selected.has(col.id)} />
                        <span className="flex-1 min-w-0 text-left">
                          <span className="block truncate text-sm text-th-text-primary">{col.name}</span>
                          {col.description && (
                            <span className="block truncate text-xs text-th-text-subtle">{col.description}</span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}

            {/* Export action — intentionally at the bottom of the scroll area */}
            <div className="mt-6 border-t border-th-border pt-6 flex items-center gap-3">
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
        )}
      </div>
    </div>
  )
}
