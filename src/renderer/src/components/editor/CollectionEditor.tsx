import React, { useEffect, useRef, useState } from 'react'
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
  const openGitAction = useUIStore((s) => s.openGitAction)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [authType, setAuthType] = useState<AuthType>('none')
  const [authConfig, setAuthConfig] = useState<Record<string, string>>({})
  const [sslVerification, setSslVerification] = useState<SslVerification>('inherit')
  const [isDirty, setIsDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  type FormSnapshot = { name: string; description: string; authType: AuthType; authConfig: Record<string, string>; sslVerification: SslVerification }
  const undoStack = useRef<FormSnapshot[]>([])
  const lastUndoField = useRef<string | null>(null)
  const undoPushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedSnapshot = useRef<FormSnapshot | null>(null)

  const pushUndo = (snapshot: FormSnapshot) => {
    if (undoStack.current.length >= 50) undoStack.current.shift()
    undoStack.current.push({ ...snapshot, authConfig: { ...snapshot.authConfig } })
  }

  const clearUndo = () => {
    undoStack.current = []
    lastUndoField.current = null
    if (undoPushTimer.current) { clearTimeout(undoPushTimer.current); undoPushTimer.current = null }
  }

  const scheduleDraft = (fields: {
    name: string; description: string
    authType: AuthType; authConfig: Record<string, string>; sslVerification: SslVerification
  }) => {
    if (draftTimer.current) clearTimeout(draftTimer.current)
    draftTimer.current = setTimeout(() => {
      draftTimer.current = null
      window.api.drafts.collection.upsert({
        collectionId,
        name: fields.name,
        description: fields.description,
        authType: fields.authType,
        authConfig: JSON.stringify(fields.authConfig),
        sslVerification: fields.sslVerification,
      })
    }, 500)
  }

  useEffect(() => {
    if (!collection) return
    const load = async () => {
      // Capture saved state before any draft overlay
      savedSnapshot.current = {
        name: collection.name,
        description: collection.description ?? '',
        authType: collection.authType,
        authConfig: collection.authConfig,
        sslVerification: collection.sslVerification ?? 'inherit',
      }
      const { data } = await window.api.drafts.collection.get({ collectionId }) as { data: Record<string, unknown> | null }
      if (data) {
        setName((data.name as string) ?? collection.name)
        setDescription((data.description as string) ?? collection.description ?? '')
        setAuthType(((data.auth_type as AuthType) ?? collection.authType))
        setAuthConfig(typeof data.auth_config === 'string' ? JSON.parse(data.auth_config as string) : collection.authConfig)
        setSslVerification(((data.ssl_verification as SslVerification) ?? collection.sslVerification ?? 'inherit'))
        setIsDirty(true)
      } else {
        setName(collection.name)
        setDescription(collection.description ?? '')
        setAuthType(collection.authType)
        setAuthConfig(collection.authConfig)
        setSslVerification(collection.sslVerification ?? 'inherit')
        setIsDirty(false)
      }
    }
    load()
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current)
      clearUndo()
    }
  }, [collectionId, collection])

  if (!collection) {
    return <div className="flex h-full items-center justify-center text-sm text-th-text-subtle">Collection not found</div>
  }

  const integration = collection.integrationId ? integrations.find((i) => i.id === collection.integrationId) : null
  const inheritedFrom = integration?.token ? integration.name : undefined
  const isGit = ['git', 'github', 'gitlab'].includes(collection.source)

  const discard = async () => {
    if (draftTimer.current) { clearTimeout(draftTimer.current); draftTimer.current = null }
    clearUndo()
    await window.api.drafts.collection.delete({ collectionId })
    setName(collection.name)
    setDescription(collection.description ?? '')
    setAuthType(collection.authType)
    setAuthConfig(collection.authConfig)
    setSslVerification(collection.sslVerification ?? 'inherit')
    setIsDirty(false)
  }

  const save = async () => {
    if (!name.trim()) return
    if (draftTimer.current) { clearTimeout(draftTimer.current); draftTimer.current = null }
    clearUndo()
    setSaving(true)
    await updateCollection(collectionId, { name: name.trim(), description, authType, authConfig, sslVerification })
    await window.api.drafts.collection.delete({ collectionId })
    setSaving(false)
    setIsDirty(false)
    if (isGit) {
      openGitAction({ type: 'push', collectionId, title: `Updated collection '${name.trim()}'` })
    } else {
      addToast('Collection saved', 'success')
    }
  }

  const mark = (fields?: {
    name?: string; description?: string
    authType?: AuthType; authConfig?: Record<string, string>; sslVerification?: SslVerification
  }, changedField?: string) => {
    // Push undo snapshot when switching fields or after 1s on same field
    const currentSnapshot: FormSnapshot = {
      name: fields?.name !== undefined ? name : (fields?.name ?? name),
      description: fields?.description !== undefined ? description : description,
      authType: fields?.authType !== undefined ? authType : authType,
      authConfig: fields?.authConfig !== undefined ? authConfig : authConfig,
      sslVerification: fields?.sslVerification !== undefined ? sslVerification : sslVerification,
    }
    if (changedField !== lastUndoField.current) {
      if (undoPushTimer.current) { clearTimeout(undoPushTimer.current); undoPushTimer.current = null }
      pushUndo(currentSnapshot)
      lastUndoField.current = changedField ?? null
    } else if (!undoPushTimer.current) {
      const snap = { ...currentSnapshot, authConfig: { ...currentSnapshot.authConfig } }
      undoPushTimer.current = setTimeout(() => {
        undoPushTimer.current = null
        pushUndo(snap)
      }, 1000)
    }
    setIsDirty(true)
    scheduleDraft({
      name: fields?.name ?? name,
      description: fields?.description ?? description,
      authType: fields?.authType ?? authType,
      authConfig: fields?.authConfig ?? authConfig,
      sslVerification: fields?.sslVerification ?? sslVerification,
    })
  }

  const handleUndo = () => {
    const previous = undoStack.current.pop()
    if (!previous) return
    if (undoPushTimer.current) { clearTimeout(undoPushTimer.current); undoPushTimer.current = null }
    lastUndoField.current = null
    setName(previous.name)
    setDescription(previous.description)
    setAuthType(previous.authType)
    setAuthConfig(previous.authConfig)
    setSslVerification(previous.sslVerification)
    // Dirty only if the restored snapshot differs from the originally saved state
    const atSaved = savedSnapshot.current && JSON.stringify(previous) === JSON.stringify(savedSnapshot.current)
    if (atSaved) {
      setIsDirty(false)
      if (draftTimer.current) { clearTimeout(draftTimer.current); draftTimer.current = null }
      window.api.drafts.collection.delete({ collectionId })
    } else {
      setIsDirty(true)
      scheduleDraft(previous)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault()
      handleUndo()
    }
  }

  return (
    <div className="bg-th-bg w-full" onKeyDown={onKeyDown}>
      {/* Thin drag strip — window drag target only, no content */}
      <div className="drag-region shrink-0 pt-8 pb-4" />

      {/* Content */}
      <div className="no-drag px-8 pb-4 flex flex-col gap-6 border-b border-th-border">

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
            className="-mx-2 w-full cursor-text rounded-md border border-transparent bg-transparent px-2 py-1 text-2xl font-semibold text-th-text-primary placeholder:text-th-text-faint outline-hidden transition-colors hover:border-th-border hover:bg-th-surface-hover focus:border-th-border-strong focus:bg-th-surface"
            placeholder="Collection name"
            value={name}
            onChange={(e) => { setName(e.target.value); mark({ name: e.target.value }, 'name') }}
          />
          <p className="mt-1 text-xs text-th-text-muted">Collection</p>
          <AiActionButton
            className="mt-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm hover:border-blue-500/60 hover:bg-blue-500/15"
            onClick={() => selectUIItem('ai-collection', collectionId)}
          />
        </div>

        {/* Description */}
        <Section title="Description">
          <textarea
            className="w-full resize-none rounded-md border border-th-border bg-th-surface px-3 py-2.5 text-sm text-th-text-secondary placeholder-th-text-faint focus:border-th-border-strong focus:outline-hidden leading-relaxed"
            placeholder="Describe what this collection is for, which services it covers, etc."
            rows={4}
            value={description}
            onChange={(e) => { setDescription(e.target.value); mark({ description: e.target.value }, 'description') }}
          />
        </Section>

        {/* Auth */}
        <Section title="Authentication">
          <p className="mb-3 text-xs text-th-text-faint">Default auth for all requests in this collection. Can be overridden per group or request.</p>
          <AuthEditor
            authType={authType}
            authConfig={authConfig}
            onChange={(t, c) => { setAuthType(t); setAuthConfig(c); mark({ authType: t, authConfig: c }, 'auth') }}
            inheritedFrom={inheritedFrom}
            canInherit={false}
          />
        </Section>

        {/* SSL */}
        <Section title="SSL Verification">
          <p className="mb-3 text-xs text-th-text-faint">Default SSL setting for all requests in this collection. Can be overridden per group or request.</p>
          <SslEditor
            value={sslVerification}
            onChange={(v) => { setSslVerification(v); mark({ sslVerification: v }, 'ssl') }}
            canInherit={false}
          />
        </Section>

        {/* Source info */}
        {(collection.source !== 'local' || integration) && (
          <Section title="Source">
            <div className="rounded-md border border-th-border bg-th-surface px-4 py-3 text-xs flex flex-col gap-1.5 text-th-text-subtle">
              <div className="flex gap-3"><span className="text-th-text-faint w-20">Type</span><span>{collection.source}</span></div>
              {integration && <div className="flex gap-3"><span className="text-th-text-faint w-20">Integration</span><span>{integration.name}</span></div>}
              {integration?.repo && <div className="flex gap-3"><span className="text-th-text-faint w-20">Repository</span><span className="truncate">{integration.repo}</span></div>}
            </div>
          </Section>
        )}

        {/* Export */}
        <Section title="Export">
          <p className="mb-3 text-xs text-th-text-faint">Download this collection as a JSON file you can share or back up.</p>
          <button
            onClick={async () => {
              const { data, error } = await window.api.exportImport.export({ collectionIds: [collectionId] })
              if (error) addToast(`Export failed: ${error}`, 'error')
              else if (data) addToast(`Exported "${name}"`, 'success')
            }}
            className="flex items-center gap-1.5 rounded-sm border border-th-border bg-th-surface px-3 py-1.5 text-sm text-th-text-secondary hover:bg-th-surface-raised hover:text-th-text-primary transition-colors focus:outline-hidden"
          >
            <Download className="h-3.5 w-3.5" />
            Export collection
          </button>
        </Section>

      </div>

      {/* Sticky save bar */}
      {isDirty && (
        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-th-border bg-th-bg/95 px-8 py-3 backdrop-blur-xs">
          <button
            onClick={discard}
            className="rounded-sm px-4 py-1.5 text-sm text-th-text-subtle hover:text-th-text-primary focus:outline-hidden"
          >
            Discard
          </button>
          <button
            onClick={save}
            disabled={saving || !name.trim()}
            className="rounded-sm bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50 focus:outline-hidden"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  )
}
