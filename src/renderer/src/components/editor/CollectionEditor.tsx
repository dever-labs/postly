import React, { useEffect, useState } from 'react'
import { ChevronRight, Download, FolderOpen, HardDrive, GitFork, GitBranch, Box } from 'lucide-react'
import type { AuthType, SslVerification } from '@/types'
import { AuthEditor } from '@/components/editor/AuthEditor'
import { SslEditor } from '@/components/editor/SslEditor'
import { useCollectionsStore } from '@/store/collections'
import { useUIStore } from '@/store/ui'
import { useIntegrationsStore } from '@/store/integrations'
import { AiActionButton } from '@/components/ai/AiActionButton'

function SourceCrumb({ source, name }: { source: string; name: string }) {
  const icon =
    source === 'github' ? <GitFork className="h-3 w-3" /> :
    source === 'gitlab' ? <GitBranch className="h-3 w-3" /> :
    source === 'backstage' ? <Box className="h-3 w-3" /> :
    <HardDrive className="h-3 w-3" />
  return (
    <span className="flex items-center gap-1 px-1.5 py-0.5 text-th-text-faint">
      {icon}
      <span>{name}</span>
    </span>
  )
}

interface Props {
  collectionId: string
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-th-text-subtle">{title}</span>
        <div className="flex-1 border-t border-th-border" />
      </div>
      {children}
    </div>
  )
}

export function CollectionEditor({ collectionId }: Props) {
  const collection = useCollectionsStore((s) => s.collections.find((c) => c.id === collectionId))
  const updateCollection = useCollectionsStore((s) => s.updateCollection)
  const integrations = useIntegrationsStore((s) => s.integrations)
  const addToast = useUIStore((s) => s.addToast)
  const selectUIItem = useUIStore((s) => s.selectItem)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [authType, setAuthType] = useState<AuthType>('none')
  const [authConfig, setAuthConfig] = useState<Record<string, string>>({})
  const [sslVerification, setSslVerification] = useState<SslVerification>('inherit')
  const [isDirty, setIsDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (collection) {
      setName(collection.name)
      setDescription(collection.description ?? '')
      setAuthType(collection.authType)
      setAuthConfig(collection.authConfig)
      setSslVerification(collection.sslVerification ?? 'inherit')
      setIsDirty(false)
    }
  }, [collectionId, collection])

  if (!collection) {
    return <div className="flex h-full items-center justify-center text-sm text-th-text-subtle">Collection not found</div>
  }

  const integration = collection.integrationId ? integrations.find((i) => i.id === collection.integrationId) : null
  const inheritedFrom = integration?.token ? integration.name : undefined

  const discard = () => {
    setName(collection.name)
    setDescription(collection.description ?? '')
    setAuthType(collection.authType)
    setAuthConfig(collection.authConfig)
    setSslVerification(collection.sslVerification ?? 'inherit')
    setIsDirty(false)
  }

  const save = async () => {
    if (!name.trim()) return
    setSaving(true)
    await updateCollection(collectionId, { name: name.trim(), description, authType, authConfig, sslVerification })
    setSaving(false)
    setIsDirty(false)
    addToast('Collection saved', 'success')
  }

  const mark = () => setIsDirty(true)

  return (
    <div className="bg-th-bg w-full">
      <div className="drag-region px-8 pt-8 pb-4 flex flex-col gap-6 border-b border-th-border">

        {/* Title */}
        <div className="no-drag">
          <div className="mb-3 inline-flex items-center gap-1.5 text-xs">
            <SourceCrumb
              source={collection.source}
              name={integration ? integration.name : 'Local'}
            />
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-th-text-faint" />
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 font-medium text-th-text-primary">
              <FolderOpen className="h-3.5 w-3.5 shrink-0" />
              {name || 'Collection'}
            </span>
          </div>
          <input
            className="-mx-2 w-full cursor-text rounded-md border border-transparent bg-transparent px-2 py-1 text-2xl font-semibold text-th-text-primary placeholder:text-th-text-faint outline-none transition-colors hover:border-th-border hover:bg-th-surface-hover focus:border-th-border-strong focus:bg-th-surface"
            placeholder="Collection name"
            value={name}
            onChange={(e) => { setName(e.target.value); mark() }}
          />
          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={async () => {
                const { data, error } = await window.api.exportImport.export({ collectionIds: [collectionId] })
                if (error) addToast(`Export failed: ${error}`, 'error')
                else if (data) addToast(`Exported "${name}"`, 'success')
              }}
              className="rounded p-0.5 text-th-text-faint hover:text-th-text-primary hover:bg-th-surface-hover transition-colors focus:outline-none"
              title="Export this collection"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-1 text-xs text-th-text-faint">Collection</p>
          <AiActionButton
            className="mt-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm hover:border-blue-500/60 hover:bg-blue-500/15"
            onClick={() => selectUIItem('ai-collection', collectionId)}
          />
        </div>

        {/* Description */}
        <Section title="Description">
          <textarea
            className="w-full resize-none rounded-md border border-th-border bg-th-surface px-3 py-2.5 text-sm text-th-text-secondary placeholder-th-text-faint focus:border-th-border-strong focus:outline-none leading-relaxed"
            placeholder="Describe what this collection is for, which services it covers, etc."
            rows={4}
            value={description}
            onChange={(e) => { setDescription(e.target.value); mark() }}
          />
        </Section>

        {/* Auth */}
        <Section title="Authentication">
          <p className="mb-3 text-xs text-th-text-faint">Default auth for all requests in this collection. Can be overridden per group or request.</p>
          <AuthEditor
            authType={authType}
            authConfig={authConfig}
            onChange={(t, c) => { setAuthType(t); setAuthConfig(c); mark() }}
            inheritedFrom={inheritedFrom}
            canInherit={false}
          />
        </Section>

        {/* SSL */}
        <Section title="SSL Verification">
          <p className="mb-3 text-xs text-th-text-faint">Default SSL setting for all requests in this collection. Can be overridden per group or request.</p>
          <SslEditor
            value={sslVerification}
            onChange={(v) => { setSslVerification(v); mark() }}
            canInherit={false}
          />
        </Section>

        {/* Source info */}
        {(collection.source !== 'local' || integration) && (
          <Section title="Source">
            <div className="rounded-md border border-th-border bg-th-surface px-4 py-3 text-xs flex flex-col gap-1.5 text-th-text-subtle">
              <div className="flex gap-3"><span className="text-th-text-faint w-20">Type</span><span>{collection.source}</span></div>
              {integration && <div className="flex gap-3"><span className="text-th-text-faint w-20">Integration</span><span>{integration.name}</span></div>}
              {integration && <div className="flex gap-3"><span className="text-th-text-faint w-20">Base URL</span><span className="truncate">{integration.baseUrl}</span></div>}
            </div>
          </Section>
        )}

      </div>

      {/* Sticky save bar */}
      {isDirty && (
        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-th-border bg-th-bg/95 px-8 py-3 backdrop-blur-sm">
          <button
            onClick={discard}
            className="rounded px-4 py-1.5 text-sm text-th-text-subtle hover:text-th-text-primary focus:outline-none"
          >
            Discard
          </button>
          <button
            onClick={save}
            disabled={saving || !name.trim()}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 focus:outline-none"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  )
}
