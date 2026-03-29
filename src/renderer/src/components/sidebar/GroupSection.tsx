import * as Collapsible from '@radix-ui/react-collapsible'
import { AlertCircle, Check, ChevronDown, ChevronRight, Database, Eye, EyeOff, FolderOpen, GitBranch, GitFork, GripVertical, MoreHorizontal, Pencil, Plus, Settings, Trash2, X } from 'lucide-react'
import React, { useRef, useState } from 'react'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Collection, CollectionSource, Group, Integration, Request } from '@/types'
import { AiActionButton } from '@/components/ai/AiActionButton'
import { RequestTreeItem } from '@/components/sidebar/RequestTreeItem'
import { Badge } from '@/components/ui/Badge'
import { useCollectionsStore } from '@/store/collections'
import { useIntegrationsStore } from '@/store/integrations'
import { useRequestsStore } from '@/store/requests'
import { useUIStore } from '@/store/ui'
import { cn } from '@/lib/utils'

const SOURCE_ICONS: Record<CollectionSource, React.ReactNode> = {
  local: <FolderOpen className="h-4 w-4" />,
  backstage: <Database className="h-4 w-4" />,
  github: <GitFork className="h-4 w-4" />,
  gitlab: <GitBranch className="h-4 w-4" />,
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

interface GroupSectionProps {
  source: CollectionSource
  integration?: Integration | null
  collections: Collection[]
  groups: Group[]
  requests: Request[]
  searchQuery: string
}

// ─── Inline input helper ──────────────────────────────────────────────────────

interface InlineInputProps {
  placeholder: string
  onConfirm: (name: string) => void
  onCancel: () => void
  indent?: string
}

function InlineInput({ placeholder, onConfirm, onCancel, indent = 'pl-4' }: InlineInputProps) {
  const [val, setVal] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  React.useEffect(() => { ref.current?.focus() }, [])

  return (
    <div className={cn('flex items-center gap-1 py-0.5 pr-2', indent)}>
      <input
        ref={ref}
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { if (val.trim()) onConfirm(val.trim()); else onCancel() }
          if (e.key === 'Escape') onCancel()
        }}
        placeholder={placeholder}
        className="flex-1 rounded bg-th-surface-raised px-2 py-1 text-sm text-th-text-primary placeholder-th-text-subtle outline-none ring-1 ring-blue-500/50"
      />
      <button onClick={() => { if (val.trim()) onConfirm(val.trim()); else onCancel() }} className="text-green-400 hover:text-green-300"><Check className="h-3.5 w-3.5" /></button>
      <button onClick={onCancel} className="text-th-text-subtle hover:text-th-text-secondary"><X className="h-3.5 w-3.5" /></button>
    </div>
  )
}

// ─── Collection row ───────────────────────────────────────────────────────────

interface CollectionRowProps {
  collection: Collection
  open: boolean
  onToggle: () => void
  onAddRequest: () => void
  onAddGroup: () => void
  onRename: () => void
  onDelete: () => void
  dndId: string
}

function CollectionRow({ collection, open, onToggle, onSelect, onAddRequest, onAddGroup, onRename, onDelete, isActive, onAi, dndId }: CollectionRowProps & { isActive?: boolean; onSelect: () => void; onAi: () => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: dndId })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative flex items-center gap-1 rounded px-2 py-0.5 text-th-text-muted hover:text-th-text-primary',
        isActive ? 'bg-th-surface-hover text-th-text-primary' : 'hover:bg-th-surface-raised/60'
      )}
    >
      <button
        {...listeners}
        {...attributes}
        className="cursor-grab shrink-0 rounded p-0.5 text-th-text-faint opacity-0 hover:text-th-text-muted focus:outline-none group-hover:opacity-100 active:cursor-grabbing"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      {/* Chevron — expand/collapse only */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggle() }}
        className="shrink-0 rounded p-0.5 focus:outline-none"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>

      {/* Name — select only */}
      <button
        onClick={onSelect}
        className={cn(
          'flex flex-1 truncate rounded px-1 py-1 text-left text-sm font-semibold focus:outline-none',
          isActive ? 'text-th-text-primary' : 'text-th-text-secondary hover:text-th-text-primary'
        )}
      >
        <span className="truncate">{collection.name}</span>
      </button>

      {/* hover actions */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          title="Add request"
          onClick={(e) => { e.stopPropagation(); onAddRequest() }}
          className="rounded p-0.5 hover:bg-th-surface-hover focus:outline-none"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          title="Add group"
          onClick={(e) => { e.stopPropagation(); onAddGroup() }}
          className="rounded p-0.5 hover:bg-th-surface-hover focus:outline-none"
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </button>
        <button
          title="More"
          onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen) }}
          className="rounded p-0.5 hover:bg-th-surface-hover focus:outline-none"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded border border-th-border-strong bg-th-surface-raised shadow-lg">
            <AiActionButton
              variant="menu-item"
              onClick={() => { setMenuOpen(false); onAi() }}
            />
            <div className="border-t border-th-border mx-2" />
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-th-text-primary hover:bg-th-surface-hover"
              onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onRename() }}
            >
              <Pencil className="h-3.5 w-3.5" /> Rename
            </button>
            <button
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-rose-400 hover:bg-th-surface-hover"
              onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete() }}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function GroupSection({ source, integration, collections, groups, requests, searchQuery }: GroupSectionProps) {
  const [sourceOpen, setSourceOpen] = useState(true)
  const [openCollections, setOpenCollections] = useState<Set<string>>(new Set())
  const [addingGroupTo, setAddingGroupTo] = useState<string | null>(null)
  const [renamingCollection, setRenamingCollection] = useState<string | null>(null)

  const {
    toggleGroupCollapsed,
    toggleSourceHidden,
    hiddenSources,
    deleteRequest,
    createGroup,
    addRequestToCollection,
    deleteCollection,
    renameCollection,
    createLocalRequest,
    deleteGroup,
    renameGroup,
  } = useCollectionsStore()
  const integrationsStore = useIntegrationsStore()
  const { activeRequestId, setActiveRequest, clearActiveRequest } = useRequestsStore()
  const { selectItem, clearSelectedItem, selectedItem } = useUIStore()

  const [renamingGroup, setRenamingGroup] = useState<string | null>(null)
  const [groupMenuOpen, setGroupMenuOpen] = useState<string | null>(null)

  const sourceCollections = integration
    ? collections.filter((c) => c.integrationId === integration.id)
    : collections.filter((c) => c.source === source && !c.integrationId)
  const isSourceHidden = hiddenSources.has(source)

  const totalRequests = requests.filter((r) => {
    const group = groups.find((g) => g.id === r.groupId)
    return group && sourceCollections.some((c) => c.id === group.collectionId)
  })

  const filteredRequests = (groupId: string) => {
    const q = searchQuery.toLowerCase()
    return requests.filter(
      (r) =>
        r.groupId === groupId &&
        (!q || r.name.toLowerCase().includes(q) || r.url.toLowerCase().includes(q))
    )
  }

  const toggleCollection = (id: string) => {
    setOpenCollections((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // Auto-open a collection when it's first seen
  React.useEffect(() => {
    setOpenCollections((prev) => {
      const next = new Set(prev)
      sourceCollections.forEach((c) => { if (!next.has(c.id)) next.add(c.id) })
      return next
    })
  }, [sourceCollections.length]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Collapsible.Root open={sourceOpen} onOpenChange={setSourceOpen} className="mb-1">
      {/* Source header */}
      <div className="group/header flex items-center gap-1 px-2 py-1">
        <Collapsible.Trigger asChild>
          <button className="flex flex-1 items-center gap-1.5 rounded px-1 py-0.5 text-sm font-medium text-th-text-muted hover:text-th-text-primary focus:outline-none">
            {sourceOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {integration ? SOURCE_ICONS[integration.type] : SOURCE_ICONS[source]}
            <span>{integration ? integration.name : capitalize(source)}</span>
            <Badge variant="grey" className="ml-1">{totalRequests.length}</Badge>
          </button>
        </Collapsible.Trigger>

        {integration ? (
          <div className="flex items-center gap-0.5">
            {(integration.status === 'error' || integration.status === 'disconnected') && (
              <button
                onClick={() => integrationsStore.connect(integration.id)}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-amber-400 hover:bg-th-surface-raised hover:text-amber-300 focus:outline-none"
                title="Reconnect"
              >
                <AlertCircle className="h-3 w-3" />
                <span className="hidden group-hover/header:inline">Reconnect</span>
              </button>
            )}
            <button
              onClick={() => selectItem('edit-integration', integration.id)}
              className="rounded p-0.5 text-th-text-faint opacity-0 hover:text-th-text-muted focus:outline-none group-hover/header:opacity-100"
              title="Edit integration"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => toggleSourceHidden(source)}
            className="rounded p-0.5 text-th-text-faint hover:text-th-text-muted focus:outline-none"
            title={isSourceHidden ? 'Show source' : 'Hide source'}
          >
            {isSourceHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      <Collapsible.Content>
        <div className={cn(isSourceHidden && 'opacity-40')}>
          {sourceCollections.length === 0 && (
            <div className="mx-3 my-2 rounded border border-dashed border-th-border px-3 py-3 text-center">
              <p className="text-xs text-th-text-faint">No collections yet</p>
              <p className="mt-0.5 text-xs text-th-text-muted">Create one with the + button above</p>
            </div>
          )}
          <SortableContext items={sourceCollections.map((c) => `col:${c.id}`)} strategy={verticalListSortingStrategy}>
          {sourceCollections.map((collection) => {
            const collectionGroups = groups.filter((g) => g.collectionId === collection.id)
            const isOpen = openCollections.has(collection.id)

            return (
              <div key={collection.id} className="mb-0.5">
                {/* Collection row */}
                {renamingCollection === collection.id ? (
                  <InlineInput
                    placeholder={collection.name}
                    onConfirm={(name) => { renameCollection(collection.id, name); setRenamingCollection(null) }}
                    onCancel={() => setRenamingCollection(null)}
                    indent="pl-3"
                  />
                ) : (
                  <CollectionRow
                    collection={collection}
                    open={isOpen}
                    dndId={`col:${collection.id}`}
                    isActive={selectedItem?.type === 'collection' && selectedItem.id === collection.id}
                    onToggle={() => toggleCollection(collection.id)}
                    onSelect={() => selectItem('collection', collection.id)}
                    onAddRequest={() => { setOpenCollections((p) => new Set([...p, collection.id])); addRequestToCollection(collection.id) }}
                    onAddGroup={() => { setOpenCollections((p) => new Set([...p, collection.id])); setAddingGroupTo(collection.id) }}
                    onRename={() => setRenamingCollection(collection.id)}
                    onDelete={() => deleteCollection(collection.id)}
                    onAi={() => selectItem('ai-collection', collection.id)}
                  />
                )}

                {/* Groups + requests */}
                {(isOpen || !!searchQuery) && (
                  <div className="pl-3">
                    <SortableContext items={collectionGroups.map((g) => `grp:${g.id}`)} strategy={verticalListSortingStrategy}>
                    {collectionGroups.map((group) => {
                      const groupRequests = filteredRequests(group.id)
                      if (searchQuery && groupRequests.length === 0) return null

                      // eslint-disable-next-line react-hooks/rules-of-hooks
                      const { attributes: grpAttrs, listeners: grpListeners, setNodeRef: grpRef, transform: grpTransform, transition: grpTransition, isDragging: grpDragging } = useSortable({ id: `grp:${group.id}` })
                      const grpStyle = { transform: CSS.Transform.toString(grpTransform), transition: grpTransition, opacity: grpDragging ? 0.4 : 1 }

                      return (
                        <div key={group.id} ref={grpRef} style={grpStyle}>
                        <Collapsible.Root
                          open={!group.collapsed || !!searchQuery}
                          onOpenChange={() => toggleGroupCollapsed(group.id)}
                        >
                          {renamingGroup === group.id ? (
                            <InlineInput
                              placeholder={group.name}
                              onConfirm={(name) => { renameGroup(group.id, name); setRenamingGroup(null) }}
                              onCancel={() => setRenamingGroup(null)}
                              indent="pl-2"
                            />
                          ) : (
                          <div className={cn(
                            'group/grp relative flex items-center gap-1 rounded pr-1 text-th-text-muted hover:text-th-text-primary',
                            selectedItem?.type === 'group' && selectedItem.id === group.id
                              ? 'bg-th-surface-hover text-th-text-primary'
                              : 'hover:bg-th-surface-raised/60'
                          )}>
                            <button
                              {...grpListeners}
                              {...grpAttrs}
                              className="cursor-grab shrink-0 rounded p-0.5 text-th-text-faint opacity-0 hover:text-th-text-muted focus:outline-none group-hover/grp:opacity-100 active:cursor-grabbing"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <GripVertical className="h-3.5 w-3.5" />
                            </button>

                            {/* Chevron — collapse/expand only */}
                            <Collapsible.Trigger asChild>
                              <button
                                className="shrink-0 rounded p-0.5 focus:outline-none"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {group.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                              </button>
                            </Collapsible.Trigger>

                            {/* Name — select only */}
                            <button
                              onClick={() => selectItem('group', group.id)}
                              className={cn(
                                'flex flex-1 items-center gap-1.5 truncate rounded py-1 text-left text-sm font-semibold focus:outline-none',
                                selectedItem?.type === 'group' && selectedItem.id === group.id
                                  ? 'text-th-text-primary'
                                  : 'text-th-text-muted hover:text-th-text-primary',
                                group.hidden && 'opacity-50'
                              )}
                            >
                              <span className="truncate">{group.name}</span>
                              {group.hidden && <EyeOff className="ml-auto h-3 w-3 shrink-0" />}
                            </button>

                            {/* Hover actions */}
                            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/grp:opacity-100">
                              <button
                                title="Add request"
                                onClick={() => createLocalRequest(group.id)}
                                className="rounded p-0.5 hover:bg-th-surface-hover focus:outline-none"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                              <button
                                title="More"
                                onClick={(e) => { e.stopPropagation(); setGroupMenuOpen(groupMenuOpen === group.id ? null : group.id) }}
                                className="rounded p-0.5 hover:bg-th-surface-hover focus:outline-none"
                              >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </button>
                            </div>

                            {groupMenuOpen === group.id && (
                              <>
                                <div className="fixed inset-0 z-10" onClick={() => setGroupMenuOpen(null)} />
                                <div className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded border border-th-border-strong bg-th-surface-raised shadow-lg">
                                  <AiActionButton
                                    variant="menu-item"
                                  onClick={() => { setGroupMenuOpen(null); selectItem('ai-group', group.id) }}
                                  />
                                  <div className="border-t border-th-border mx-2" />
                                  <button
                                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-th-text-primary hover:bg-th-surface-hover"
                                    onClick={(e) => { e.stopPropagation(); setGroupMenuOpen(null); setRenamingGroup(group.id) }}
                                  >
                                    <Pencil className="h-3.5 w-3.5" /> Rename
                                  </button>
                                  <button
                                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-rose-400 hover:bg-th-surface-hover"
                                    onClick={(e) => { e.stopPropagation(); setGroupMenuOpen(null); deleteGroup(group.id) }}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" /> Delete
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                          )}

                          <Collapsible.Content>
                            <div className="pl-1">
                              {groupRequests.length === 0 && !searchQuery && (
                                <div className="mx-2 my-1.5 rounded border border-dashed border-th-border px-2 py-2 text-center">
                                  <p className="text-xs text-th-text-faint">No endpoints defined</p>
                                  <p className="mt-0.5 text-xs text-th-text-muted">Use + to add one</p>
                                </div>
                              )}
                              <SortableContext items={groupRequests.map((r) => `req:${r.id}`)} strategy={verticalListSortingStrategy}>
                              {groupRequests.map((req) => (
                                <RequestTreeItem
                                  key={req.id}
                                  dndId={`req:${req.id}`}
                                  request={req}
                                  isActive={req.id === activeRequestId && !selectedItem}
                                  onClick={() => { clearSelectedItem(); setActiveRequest(req) }}
                                  onDelete={() => { deleteRequest(req.id); if (activeRequestId === req.id) clearActiveRequest() }}
                                />
                              ))}
                              </SortableContext>
                            </div>
                          </Collapsible.Content>
                        </Collapsible.Root>
                        </div>
                      )
                    })}
                    </SortableContext>

                    {/* Inline add-group input */}
                    {!searchQuery && addingGroupTo === collection.id && (
                      <InlineInput
                        placeholder="Group name…"
                        onConfirm={(name) => { createGroup(collection.id, name); setAddingGroupTo(null) }}
                        onCancel={() => setAddingGroupTo(null)}
                        indent="pl-2"
                      />
                    )}

                    {/* Empty state */}
                    {!searchQuery && collectionGroups.length === 0 && addingGroupTo !== collection.id && (
                      <div className="mx-2 my-1.5 rounded border border-dashed border-th-border px-2 py-2 text-center">
                        <p className="text-xs text-th-text-faint">No groups defined</p>
                        <p className="mt-0.5 text-xs text-th-text-muted">Use + to add one</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          </SortableContext>
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}
