import React, { useEffect, useRef, useState } from 'react'
import { ChevronRight, FolderOpen, Folder, HardDrive, GitFork, GitBranch, Box, Pencil } from 'lucide-react'
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
    <span className="flex items-center gap-1 text-th-text-faint">
      {icon}
      <span>{name}</span>
    </span>
  )
}

interface Props {
  groupId: string
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

export function GroupEditor({ groupId }: Props) {
  const group = useCollectionsStore((s) => s.groups.find((g) => g.id === groupId))
  const collections = useCollectionsStore((s) => s.collections)
  const updateGroup = useCollectionsStore((s) => s.updateGroup)
  const integrations = useIntegrationsStore((s) => s.integrations)
  const addToast = useUIStore((s) => s.addToast)
  const selectItem = useUIStore((s) => s.selectItem)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [authType, setAuthType] = useState<AuthType>('none')
  const [authConfig, setAuthConfig] = useState<Record<string, string>>({})
  const [sslVerification, setSslVerification] = useState<SslVerification>('inherit')
  const [isDirty, setIsDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)

  const collection = group ? collections.find((c) => c.id === group.collectionId) : null

  useEffect(() => {
    if (group) {
      setName(group.name)
      setDescription(group.description ?? '')
      setAuthType(group.authType)
      setAuthConfig(group.authConfig)
      setSslVerification(group.sslVerification ?? 'inherit')
      setIsDirty(false)
    }
  }, [groupId, group])

  if (!group) {
    return <div className="flex h-full items-center justify-center text-sm text-th-text-subtle">Group not found</div>
  }

  const integration = collection?.integrationId ? integrations.find((i) => i.id === collection.integrationId) : null

  let inheritedAuthFrom: string | undefined
  if (collection && collection.authType !== 'none' && collection.authType !== 'inherit') {
    inheritedAuthFrom = collection.name
  } else if (integration?.token) {
    inheritedAuthFrom = integration.name
  }

  const discard = () => {
    setName(group.name)
    setDescription(group.description ?? '')
    setAuthType(group.authType)
    setAuthConfig(group.authConfig)
    setSslVerification(group.sslVerification ?? 'inherit')
    setIsDirty(false)
  }

  const save = async () => {
    if (!name.trim()) return
    setSaving(true)
    await updateGroup(groupId, { name: name.trim(), description, authType, authConfig, sslVerification })
    setSaving(false)
    setIsDirty(false)
    addToast('Group saved', 'success')
  }

  const mark = () => setIsDirty(true)

  return (
    <div className="bg-th-bg w-full">
      <div className="px-8 py-8 flex flex-col gap-8 pb-4">

        {/* Title with breadcrumb */}
        <div>
          <div className="mb-3 flex items-center gap-1.5 text-xs flex-wrap">
            <SourceCrumb
              source={collection?.source ?? 'local'}
              name={integration ? integration.name : 'Local'}
            />
            {collection && (
              <>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-th-text-faint" />
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-th-text-subtle" />
                <button
                  onClick={() => selectItem('collection', collection.id)}
                  className="font-medium text-th-text-subtle hover:text-th-text-primary hover:underline focus:outline-none"
                >
                  {collection.name}
                </button>
              </>
            )}
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-th-text-faint" />
            <Folder className="h-3.5 w-3.5 shrink-0 text-th-text-subtle" />
            <span className="font-medium text-th-text-primary">{name || 'Group'}</span>
          </div>
          {editingTitle ? (
            <input
              ref={titleInputRef}
              className="w-full border-b border-th-border-strong bg-transparent text-2xl font-semibold text-th-text-primary focus:outline-none placeholder:text-th-text-faint"
              placeholder="Group name"
              value={name}
              onChange={(e) => { setName(e.target.value); mark() }}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.currentTarget.blur() } }}
              autoFocus
            />
          ) : (
            <div className="group flex items-center gap-2">
              <span className="text-2xl font-semibold text-th-text-primary">
                {name || <span className="text-th-text-faint">Group name</span>}
              </span>
              <button
                onClick={() => { setEditingTitle(true); setTimeout(() => titleInputRef.current?.focus(), 0) }}
                className="opacity-0 group-hover:opacity-100 rounded p-0.5 text-th-text-faint hover:text-th-text-primary hover:bg-th-surface-hover transition-opacity focus:opacity-100 focus:outline-none"
                title="Rename group"
              >
                <Pencil className="h-4 w-4" />
              </button>
            </div>
          )}
          <p className="mt-1 text-xs text-th-text-faint">Group</p>
          <AiActionButton
            className="mt-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm hover:border-blue-500/60 hover:bg-blue-500/15"
            onClick={() => selectItem('ai-group', groupId)}
          />
        </div>

        {/* Description */}
        <Section title="Description">
          <textarea
            className="w-full resize-none rounded-md border border-th-border bg-th-surface px-3 py-2.5 text-sm text-th-text-secondary placeholder-th-text-faint focus:border-th-border-strong focus:outline-none leading-relaxed"
            placeholder="Describe what this group contains, e.g. which service or feature area."
            rows={4}
            value={description}
            onChange={(e) => { setDescription(e.target.value); mark() }}
          />
        </Section>

        {/* Auth */}
        <Section title="Authentication">
          <p className="mb-3 text-xs text-th-text-faint">
            Default auth for all requests in this group. Use <strong className="text-th-text-subtle">Inherit</strong> to fall through to the collection or integration auth.
          </p>
          <AuthEditor
            authType={authType}
            authConfig={authConfig}
            onChange={(t, c) => { setAuthType(t); setAuthConfig(c); mark() }}
            inheritedFrom={inheritedAuthFrom}
            canInherit={true}
          />
        </Section>

        {/* SSL */}
        <Section title="SSL Verification">
          <p className="mb-3 text-xs text-th-text-faint">
            Default SSL setting for requests in this group. Use <strong className="text-th-text-subtle">Inherit</strong> to fall through to the collection setting.
          </p>
          <SslEditor
            value={sslVerification}
            onChange={(v) => { setSslVerification(v); mark() }}
            inheritedFrom={collection?.sslVerification !== 'inherit' ? collection?.name : undefined}
          />
        </Section>

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
