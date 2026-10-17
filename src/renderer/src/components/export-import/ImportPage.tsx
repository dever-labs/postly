import { AlertTriangle, Database, FileJson, FolderOpen, GitBranch, GitFork, Globe, Link as LinkIcon, Upload } from 'lucide-react'
import React, { useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { useCollectionsStore } from '@/store/collections'
import { useIntegrationsStore } from '@/store/integrations'
import { useUIStore } from '@/store/ui'
import { useVariablesStore } from '@/store/variables'
import type { CollectionSource } from '@/types'

interface ParsedCollection {
  name: string
  description?: string
  source?: string
  integrationName?: string
}

interface PreviewEntry {
  collection: ParsedCollection
  folders: number
  requests: number
}

interface ParsedFile {
  format: 'postly' | 'openapi' | 'postman' | 'insomnia'
  collections: PreviewEntry[]
  warnings: string[]
}

const FORMAT_LABELS: Record<ParsedFile['format'], string> = {
  postly: 'Postly export',
  openapi: 'OpenAPI / Swagger',
  postman: 'Postman collection',
  insomnia: 'Insomnia export',
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
  const [url, setUrl] = useState('')
  const [fetching, setFetching] = useState(false)

  const showPreview = (name: string, preview: ParsedFile) => {
    setFileName(name)
    setParsedFile(preview)
    const overrides: Record<number, CollectionSource> = {}
    preview.collections.forEach((entry, i) => {
      overrides[i] = (['local', 'github', 'gitlab', 'backstage'] as CollectionSource[]).includes(entry.collection.source as CollectionSource)
        ? (entry.collection.source as CollectionSource)
        : 'local'
    })
    setSourceOverrides(overrides)
  }

  const parseText = async (name: string, text: string, sourceUrl?: string) => {
    const { data, error } = await window.api.exportImport.parse({ text, sourceUrl }) as { data?: ParsedFile; error?: string }
    if (error || !data) {
      setParseError(error ?? 'Could not read the file.')
      setParsedFile(null)
      return
    }
    showPreview(name, data)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setParseError('')
    const reader = new FileReader()
    reader.onload = (ev) => { void parseText(file.name, String(ev.target?.result ?? '')) }
    reader.onerror = () => setParseError('Could not read the file.')
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleFetchUrl = async () => {
    const target = url.trim()
    if (!target) return
    setParseError('')
    setFetching(true)
    const { data, error } = await window.api.exportImport.fetchUrl({ url: target }) as { data?: { text: string }; error?: string }
    if (error || !data) {
      setFetching(false)
      setParseError(error ?? 'Could not fetch the document.')
      return
    }
    await parseText(target, data.text, target)
    setFetching(false)
  }

  const handleImport = async () => {
    if (!parsedFile) return
    setImporting(true)
    const collectionsWithSource = parsedFile.collections.map(({ collection }, i) => ({
      ...collection,
      source: sourceOverrides[i] ?? collection.source ?? 'local',
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
      void useVariablesStore.getState().load()
      addToast(`Imported ${data.count} collection${data.count !== 1 ? 's' : ''}`, 'success')
      clearSelectedItem()
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="drag-region flex shrink-0 items-center justify-between border-b border-th-border px-6 pt-8 pb-4">
        <div className="no-drag flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 text-xs text-th-text-subtle">
            <FileJson className="h-3.5 w-3.5" />
            Import Collections
          </div>
          <h1 className="text-sm font-semibold text-th-text-primary">
            {parsedFile ? 'Review and import' : 'Choose a file or URL to import'}
          </h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mb-6">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.yaml,.yml,application/json"
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
                <p className="text-sm font-medium text-th-text-secondary">Browse for a file</p>
                <p className="mt-0.5 text-xs text-th-text-subtle">Postly export (.postly.json), a Postman collection (v2.0 / v2.1), an Insomnia export (v4 / v5), or an OpenAPI 3.x / Swagger 2 document (JSON or YAML)</p>
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
          {!parsedFile && (
            <form
              className="mt-3 flex items-center gap-2"
              onSubmit={(e) => { e.preventDefault(); void handleFetchUrl() }}
            >
              <LinkIcon className="h-4 w-4 shrink-0 text-th-text-muted" aria-hidden="true" />
              <Input
                data-testid="import-url"
                aria-label="OpenAPI document URL"
                placeholder="…or paste the URL of an OpenAPI / Swagger document"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <Button type="submit" data-testid="import-url-fetch" disabled={fetching || !url.trim()}>
                {fetching ? 'Fetching…' : 'Fetch'}
              </Button>
            </form>
          )}
          {parseError && <p role="alert" data-testid="import-error" className="mt-2 text-xs text-red-400 light:text-red-800">{parseError}</p>}
        </div>

        {parsedFile && (
          <div className="flex flex-col gap-3">
            <p data-testid="import-format" className="text-xs font-medium uppercase tracking-wide text-th-text-subtle">
              {FORMAT_LABELS[parsedFile.format]} · {parsedFile.collections.length} collection{parsedFile.collections.length !== 1 ? 's' : ''} found
            </p>
            {parsedFile.warnings.length > 0 && (
              <div data-testid="import-warnings" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-amber-400 light:text-amber-900">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  {parsedFile.warnings.length} thing{parsedFile.warnings.length !== 1 ? 's' : ''} could not be fully mapped
                </p>
                <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-th-text-muted">
                  {parsedFile.warnings.map((w) => <li key={w}>{w}</li>)}
                </ul>
              </div>
            )}
            {parsedFile.collections.map(({ collection: col, folders, requests }, i) => (
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
                    {folders} folder{folders !== 1 ? 's' : ''} · {requests} request{requests !== 1 ? 's' : ''}
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

            <div className="mt-6 border-t border-th-border pt-6 flex items-center gap-3">
              <Button onClick={handleImport} disabled={importing} className="gap-2">
                <Upload className="h-4 w-4" />
                {importing
                  ? 'Importing…'
                  : `Import ${parsedFile.collections.length} collection${parsedFile.collections.length !== 1 ? 's' : ''}`}
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
