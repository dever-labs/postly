import { Database, FileJson, FolderOpen, GitBranch, GitFork, Globe, Upload, X } from 'lucide-react'
import React, { useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { useCollectionsStore } from '@/store/collections'
import { useIntegrationsStore } from '@/store/integrations'
import { useUIStore } from '@/store/ui'
import type { CollectionSource } from '@/types'

interface ParsedCollection {
  name: string
  description?: string
  source?: string
  integrationName?: string
  groups?: Array<{ name: string; requests?: unknown[] }>
}

interface ParsedFile {
  $schema: string
  collections: ParsedCollection[]
}

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

function requestCount(col: ParsedCollection): number {
  return col.groups?.reduce((sum, g) => sum + (g.requests?.length ?? 0), 0) ?? 0
}

export function ImportPage() {
  const { load } = useCollectionsStore()
  const { clearSelectedItem, addToast } = useUIStore()
  const integrations = useIntegrationsStore((s) => s.integrations)

  // Local is always available; other sources only if an integration exists
  const availableSources: CollectionSource[] = [
    'local',
    ...(['github', 'gitlab', 'backstage'] as CollectionSource[]).filter((src) =>
      integrations.some((i) => i.type === src),
    ),
  ]

  const fileInputRef = useRef<HTMLInputElement>(null)
  const [parsedFile, setParsedFile] = useState<ParsedFile | null>(null)
  const [fileName, setFileName] = useState('')
  const [sourceOverrides, setSourceOverrides] = useState<Record<number, CollectionSource>>({})
  const [importing, setImporting] = useState(false)
  const [parseError, setParseError] = useState('')

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setParseError('')

    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string) as ParsedFile
        if (!parsed.$schema?.startsWith('postly/') || !Array.isArray(parsed.collections)) {
          setParseError('Not a valid Postly export file.')
          setParsedFile(null)
          return
        }
        setParsedFile(parsed)
        const overrides: Record<number, CollectionSource> = {}
        parsed.collections.forEach((col, i) => {
          overrides[i] = (['local', 'github', 'gitlab', 'backstage'] as CollectionSource[]).includes(col.source as CollectionSource)
            ? (col.source as CollectionSource)
            : 'local'
        })
        setSourceOverrides(overrides)
      } catch {
        setParseError('Failed to parse file — ensure it is a valid JSON file.')
        setParsedFile(null)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleImport = async () => {
    if (!parsedFile) return
    setImporting(true)
    const collectionsWithSource = parsedFile.collections.map((col, i) => ({
      ...col,
      source: sourceOverrides[i] ?? col.source ?? 'local',
    }))
    const { data, error } = await window.api.exportImport.importCollections({
      collections: collectionsWithSource,
    })
    setImporting(false)
    if (error) {
      addToast(`Import failed: ${error}`, 'error')
      return
    }
    if (data) {
      await load()
      addToast(`Imported ${data.count} collection${data.count !== 1 ? 's' : ''}`, 'success')
      clearSelectedItem()
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="drag-region flex shrink-0 items-center justify-between border-b border-th-border px-6 pt-8 pb-4">
        <div className="no-drag flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 text-xs text-th-text-subtle">
            <FileJson className="h-3.5 w-3.5" />
            Import Collections
          </div>
          <h1 className="text-sm font-semibold text-th-text-primary">
            {parsedFile ? 'Configure import sources' : 'Choose a file to import'}
          </h1>
        </div>
        <button
          onClick={clearSelectedItem}
          className="no-drag rounded-sm p-1 text-th-text-subtle hover:bg-th-surface-raised hover:text-th-text-secondary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mb-6">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleFileChange}
          />
          {!parsedFile ? (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full flex-col items-center gap-3 rounded-lg border border-dashed border-th-border px-6 py-10 text-center hover:border-th-border-strong hover:bg-th-surface-raised"
            >
              <FolderOpen className="h-8 w-8 text-th-text-muted" />
              <div>
                <p className="text-sm font-medium text-th-text-secondary">Browse for a .postly.json file</p>
                <p className="mt-0.5 text-xs text-th-text-subtle">Select a previously exported Postly collection</p>
              </div>
            </button>
          ) : (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center gap-3 rounded-lg border border-th-border px-4 py-3 text-sm hover:border-th-border-strong hover:bg-th-surface-raised"
            >
              <FolderOpen className="h-4 w-4 shrink-0 text-th-text-muted" />
              <span className="flex-1 truncate text-left text-th-text-primary">{fileName}</span>
              <span className="shrink-0 text-xs text-th-text-subtle">Change file</span>
            </button>
          )}
          {parseError && <p className="mt-2 text-xs text-red-400">{parseError}</p>}
        </div>

        {parsedFile && (
          <div className="flex flex-col gap-3">
            <p className="text-xs font-medium uppercase tracking-wide text-th-text-subtle">
              {parsedFile.collections.length} collection{parsedFile.collections.length !== 1 ? 's' : ''} found
            </p>
            {parsedFile.collections.map((col, i) => (
              <div
                key={i}
                className="flex items-start gap-4 rounded-lg border border-th-border bg-th-surface-raised px-4 py-3"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-th-text-primary truncate">{col.name}</span>
                    {col.integrationName && (
                      <span className="shrink-0 text-xs text-th-text-faint">via {col.integrationName}</span>
                    )}
                  </div>
                  {col.description && (
                    <p className="mt-0.5 text-xs text-th-text-subtle truncate">{col.description}</p>
                  )}
                  <p className="mt-1 text-xs text-th-text-faint">
                    {col.groups?.length ?? 0} group{col.groups?.length !== 1 ? 's' : ''} ·{' '}
                    {requestCount(col)} request{requestCount(col) !== 1 ? 's' : ''}
                  </p>
                </div>

                <div className="shrink-0 w-36">
                  <Select
                    value={sourceOverrides[i] ?? 'local'}
                    onValueChange={(v) =>
                      setSourceOverrides((prev) => ({ ...prev, [i]: v as CollectionSource }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableSources.map((src) => (
                        <SelectItem key={src} value={src}>
                          <span className="flex items-center gap-2">
                            {SOURCE_ICONS[src]}
                            {SOURCE_LABELS[src]}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-th-border px-8 py-4 flex items-center gap-3">
        {parsedFile && (
          <Button onClick={handleImport} disabled={importing} className="gap-2">
            <Upload className="h-4 w-4" />
            {importing
              ? 'Importing…'
              : `Import ${parsedFile.collections.length} collection${parsedFile.collections.length !== 1 ? 's' : ''}`}
          </Button>
        )}
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
