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
  local: <FolderOpen className="h-3.5 w-3.5" />,
  backstage: <Database className="h-3.5 w-3.5" />,
  github: <GitFork className="h-3.5 w-3.5" />,
  gitlab: <GitBranch className="h-3.5 w-3.5" />,
  git: <GitBranch className="h-3.5 w-3.5" />,
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
  dragActiveId?: string | null
  dragOverId?: string | null
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
        className="flex-1 rounded-sm bg-th-surface-raised px-2 py-1 text-sm text-th-text-primary placeholder-th-text-subtle outline-hidden ring-1 ring-blue-500/50"
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
        'group relative flex items-center gap-1 rounded-sm px-2 py-0.5 text-th-text-muted hover:text-th-text-primary',
        isActive ? 'bg-th-surface-hover text-th-text-primary' : 'hover:bg-th-surface-raised/60'
      )}
    >
      <button
        {...listeners}
        {...attributes}
        className="cursor-grab shrink-0 rounded-sm p-0.5 text-th-text-faint opacity-0 hover:text-th-text-muted focus:outline-hidden group-hover:opacity-100 active:cursor-grabbing"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      {/* Chevron — expand/collapse only */}
      <button
        data-testid={`collection-toggle-${collection.id}`}
        onClick={(e) => { e.stopPropagation(); onToggle() }}
        className="shrink-0 rounded-sm p-0.5 focus:outline-hidden"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>

      {/* Name — select only */}
      <button
        onClick={onSelect}
        className={cn(
          'flex flex-1 truncate rounded-sm px-1 py-1 text-left text-sm font-semibold focus:outline-hidden',
          isActive ? 'text-th-text-primary' : 'text-th-text-muted hover:text-th-text-primary'
        )}
      >
        <span className="truncate">{collection.name}</span>
      </button>

      {/* hover actions */}
      <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          title="Add request"
          onClick={(e) => { e.stopPropagation(); onAddRequest() }}
          className="rounded-sm p-0.5 hover:bg-th-surface-hover focus:outline-hidden"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          title="Add group"
          onClick={(e) => { e.stopPropagation(); onAddGroup() }}
          className="rounded-sm p-0.5 hover:bg-th-surface-hover focus:outline-hidden"
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </button>
        <button
          title="More"
          onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen) }}
          className="rounded-sm p-0.5 hover:bg-th-surface-hover focus:outline-hidden"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </div>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-sm border border-th-border-strong bg-th-surface-raised shadow-lg">
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

// ─── Sortable group row ───────────────────────────────────────────────────────

interface SortableGroupRowProps {
  group: Group
  requests: Request[]
  searchQuery: string
  renamingGroup: string | null
  groupMenuOpen: string | null
  selectedItem: { type: string; id: string } | null
  onRenameConfirm: (name: string) => void
  onRenameCancel: () => void
  onSelect: () => void
  onAddRequest: () => void
  onMenuToggle: () => void
  onMenuClose: () => void
  onRenameStart: () => void
  onDelete: () => void
  onAiGroup: () => void
  onDeleteRequest: (reqId: string) => void
  onClickRequest: (req: Request) => void
  activeRequestId: string | null
  dragActiveId?: string | null
  dragOverId?: string | null
}

function SortableGroupRow({
  group, requests, searchQuery, renamingGroup, groupMenuOpen, selectedItem,
  onRenameConfirm, onRenameCancel, onSelect, onAddRequest, onMenuToggle,
  onMenuClose, onRenameStart, onDelete, onAiGroup, onDeleteRequest, onClickRequest, activeRequestId,
  dragActiveId, dragOverId,
}: SortableGroupRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `grp:${group.id}` })
  const grpStyle = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }

  const filteredReqs = requests
    .filter((r) => {
      const q = searchQuery.toLowerCase()
      return r.groupId === group.id && (!q || r.name.toLowerCase().includes(q) || r.url.toLowerCase().includes(q))
    })
    .sort((a, b) => a.sortOrder - b.sortOrder)
  if (searchQuery && filteredReqs.length === 0) return null

  // Determine if a foreign request is being dragged over this group
  const activeReqId = dragActiveId?.startsWith('req:') ? dragActiveId.slice(4) : null
  const activeReq = activeReqId ? requests.find((r) => r.id === activeReqId) : null
  const isExternalReqDrag = !!activeReq && activeReq.groupId !== group.id
  const overIsThisGroup = dragOverId === `grp:${group.id}` ||
    filteredReqs.some((r) => dragOverId === `req:${r.id}`)
  const isGroupDropTarget = isExternalReqDrag && overIsThisGroup

  // Compute insertion line positions for within-same-group reorder
  const overReqId = dragOverId?.startsWith('req:') ? dragOverId.slice(4) : null
  const isSameGroupDrag = !!activeReqId && activeReq?.groupId === group.id
  let insertLineAboveId: string | null = null
  let insertLineBelowId: string | null = null
  if (isSameGroupDrag && overReqId) {
    const activeIdx = filteredReqs.findIndex((r) => r.id === activeReqId)
    const overIdx = filteredReqs.findIndex((r) => r.id === overReqId)
    if (activeIdx !== -1 && overIdx !== -1 && activeIdx !== overIdx) {
      if (activeIdx < overIdx) {
        // dragging down — line appears below the over item
        insertLineBelowId = overReqId
      } else {
        // dragging up — line appears above the over item
        insertLineAboveId = overReqId
      }
    }
  }

  return (
    <div ref={setNodeRef} style={grpStyle}>
      <Collapsible.Root
        open={!group.collapsed || !!searchQuery}
        onOpenChange={() => useCollectionsStore.getState().toggleGroupCollapsed(group.id)}
      >
        {renamingGroup === group.id ? (
          <InlineInput
            placeholder={group.name}
            onConfirm={onRenameConfirm}
            onCancel={onRenameCancel}
            indent="pl-2"
          />
        ) : (
          <div className={cn(
            'group/grp relative flex items-center gap-1 rounded-sm px-2 py-0.5 text-th-text-muted hover:text-th-text-primary',
            selectedItem?.type === 'group' && selectedItem.id === group.id
              ? 'bg-th-surface-hover text-th-text-primary'
              : 'hover:bg-th-surface-raised/60'
          )}>
            <button
              {...listeners} {...attributes}
              className="cursor-grab shrink-0 rounded-sm p-0.5 text-th-text-faint opacity-0 hover:text-th-text-muted focus:outline-hidden group-hover/grp:opacity-100 active:cursor-grabbing"
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>

            <Collapsible.Trigger asChild>
              <button className="shrink-0 rounded-sm p-0.5 focus:outline-hidden" onClick={(e) => e.stopPropagation()}>
                {group.collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            </Collapsible.Trigger>

            <button
              onClick={onSelect}
              className={cn(
                'flex flex-1 items-center gap-1.5 truncate rounded-sm py-1 text-left text-sm font-semibold focus:outline-hidden',
                selectedItem?.type === 'group' && selectedItem.id === group.id
                  ? 'text-th-text-primary' : 'text-th-text-muted hover:text-th-text-primary',
                group.hidden && 'opacity-50'
              )}
            >
              <span className="truncate">{group.name}</span>
              {group.hidden && <EyeOff className="ml-auto h-3 w-3 shrink-0" />}
            </button>

            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/grp:opacity-100">
              <button title="Add request" onClick={onAddRequest} className="rounded-sm p-0.5 hover:bg-th-surface-hover focus:outline-hidden">
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button title="More" onClick={(e) => { e.stopPropagation(); onMenuToggle() }} className="rounded-sm p-0.5 hover:bg-th-surface-hover focus:outline-hidden">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </div>

            {groupMenuOpen === group.id && (
              <>
                <div className="fixed inset-0 z-10" onClick={onMenuClose} />
                <div className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-sm border border-th-border-strong bg-th-surface-raised shadow-lg">
                  <AiActionButton variant="menu-item" onClick={() => { onMenuClose(); onAiGroup() }} />
                  <div className="border-t border-th-border mx-2" />
                  <button className="flex w-full items-center gap-2 px-3 py-2 text-sm text-th-text-primary hover:bg-th-surface-hover"
                    onClick={(e) => { e.stopPropagation(); onMenuClose(); onRenameStart() }}>
                    <Pencil className="h-3.5 w-3.5" /> Rename
                  </button>
                  <button className="flex w-full items-center gap-2 px-3 py-2 text-sm text-rose-400 hover:bg-th-surface-hover"
                    onClick={(e) => { e.stopPropagation(); onMenuClose(); onDelete() }}>
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        <Collapsible.Content>
          <div className={cn('pl-1 rounded-sm transition-colors', isGroupDropTarget && 'ring-1 ring-blue-500/40 bg-blue-500/5')}>
            {filteredReqs.length === 0 && !searchQuery && (
              <div className="mx-2 my-1.5 rounded-sm border border-dashed border-th-border px-2 py-2 text-center">
                <p className="text-xs text-th-text-faint">No endpoints defined</p>
                <p className="mt-0.5 text-xs text-th-text-muted">Use + to add one</p>
              </div>
            )}
            <SortableContext items={filteredReqs.map((r) => `req:${r.id}`)} strategy={verticalListSortingStrategy}>
              {filteredReqs.map((req) => (
                <RequestTreeItem
                  key={req.id}
                  dndId={`req:${req.id}`}
                  request={req}
                  isActive={req.id === activeRequestId && !selectedItem}
                  insertLine={insertLineAboveId === req.id ? 'above' : insertLineBelowId === req.id ? 'below' : null}
                  onClick={() => onClickRequest(req)}
                  onDelete={() => onDeleteRequest(req.id)}
                />
              ))}
            </SortableContext>
          </div>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function GroupSection({ source, integration, collections, groups, requests, searchQuery, dragActiveId, dragOverId }: GroupSectionProps) {
  const [addingGroupTo, setAddingGroupTo] = useState<string | null>(null)
  const [renamingCollection, setRenamingCollection] = useState<string | null>(null)
  const [addingCollection, setAddingCollection] = useState(false)

  const {
    toggleSourceHidden,
    hiddenSources,
    deleteRequest,
    createGroup,
    addRequestToCollection,
    renameCollection,
    createLocalRequest,
    deleteGroup,
    renameGroup,
    load,
    toggleCollectionCollapsed,
  } = useCollectionsStore()
  const addToast = useUIStore((s) => s.addToast)
  const openDeleteCollection = useUIStore((s) => s.openDeleteCollection)
  const openGitAction = useUIStore((s) => s.openGitAction)
  const collapsedSources = useUIStore((s) => s.collapsedSources)
  const toggleSourceCollapsed = useUIStore((s) => s.toggleSourceCollapsed)
  const integrationsStore = useIntegrationsStore()
  const { activeRequestId, setActiveRequest, clearActiveRequest } = useRequestsStore()
  const { selectItem, clearSelectedItem, selectedItem } = useUIStore()

  const [renamingGroup, setRenamingGroup] = useState<string | null>(null)
  const [groupMenuOpen, setGroupMenuOpen] = useState<string | null>(null)

  const sourceCollections = integration
    ? collections.filter((c) => c.integrationId === integration.id)
    : collections.filter((c) => c.source === source && !c.integrationId)
  const isSourceHidden = hiddenSources.has(source)
  const isSourceOpen = !collapsedSources.has(source)

  const totalRequests = requests.filter((r) => {
    const group = groups.find((g) => g.id === r.groupId)
    return group && sourceCollections.some((c) => c.id === group.collectionId)
  })

  return (
    <Collapsible.Root open={isSourceOpen} onOpenChange={() => toggleSourceCollapsed(source)} className="mb-1">
      {/* Source header */}
      <div className="group/header flex items-center gap-1 rounded-sm px-2 py-0.5 text-th-text-muted hover:text-th-text-primary">
        <Collapsible.Trigger asChild>
          <button
            data-testid={`source-toggle-${source}`}
            className="shrink-0 rounded-sm p-0.5 focus:outline-hidden"
          >
            {isSourceOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        </Collapsible.Trigger>

        <span className="shrink-0 p-0.5">
          {integration ? SOURCE_ICONS[integration.type] : SOURCE_ICONS[source]}
        </span>

        <button
          onClick={() => {
            if (integration && ['git', 'github', 'gitlab'].includes(integration.type)) {
              selectItem('git-source', integration.id)
            } else {
              toggleSourceCollapsed(source)
            }
          }}
          className={`flex flex-1 items-center gap-1 truncate rounded-sm py-1 text-left text-sm font-semibold focus:outline-hidden ${selectedItem?.type === 'git-source' && selectedItem.id === integration?.id ? 'text-th-text-primary' : ''}`}
        >
          <span className="truncate">{integration ? integration.name : capitalize(source)}</span>
          <Badge variant="grey" className="ml-0.5">{totalRequests.length}</Badge>
        </button>

        {integration ? (
          <div className="flex items-center gap-0.5">
            {(integration.status === 'error' || integration.status === 'disconnected') && (
              <button
                onClick={() => integrationsStore.connect(integration.id)}
                className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-amber-400 hover:bg-th-surface-raised hover:text-amber-300 focus:outline-hidden"
                title="Reconnect"
              >
                <AlertCircle className="h-3 w-3" />
                <span className="hidden group-hover/header:inline">Reconnect</span>
              </button>
            )}
            <button
              onClick={() => { if (!isSourceOpen) toggleSourceCollapsed(source); setAddingCollection(true) }}
              className="rounded-sm p-0.5 text-th-text-faint opacity-0 hover:text-th-text-muted focus:outline-hidden group-hover/header:opacity-100"
              title="Add collection"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => selectItem('edit-integration', integration.id)}
              className="rounded-sm p-0.5 text-th-text-faint opacity-0 hover:text-th-text-muted focus:outline-hidden group-hover/header:opacity-100"
              title="Edit integration"
            >
              <Settings className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => { if (!isSourceOpen) toggleSourceCollapsed(source); setAddingCollection(true) }}
              className="rounded-sm p-0.5 text-th-text-faint opacity-0 hover:text-th-text-muted focus:outline-hidden group-hover/header:opacity-100"
              title="Add collection"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => toggleSourceHidden(source)}
              className="rounded-sm p-0.5 text-th-text-faint hover:text-th-text-muted focus:outline-hidden"
              title={isSourceHidden ? 'Show source' : 'Hide source'}
            >
              {isSourceHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}
      </div>

      <Collapsible.Content>
        <div data-testid={`source-content-${source}`} className={cn(isSourceHidden && 'opacity-40')}>
          {sourceCollections.length === 0 && !addingCollection && (
            <div className="mx-3 my-2 rounded-sm border border-dashed border-th-border px-3 py-3 text-center">
              <p className="text-xs text-th-text-faint">No collections yet</p>
              <p className="mt-0.5 text-xs text-th-text-muted">Use + to add one</p>
            </div>
          )}
          <SortableContext items={sourceCollections.map((c) => `col:${c.id}`)} strategy={verticalListSortingStrategy}>
          {sourceCollections.map((collection) => {
            const collectionGroups = groups
              .filter((g) => g.collectionId === collection.id)
              .sort((a, b) => a.sortOrder - b.sortOrder)
            const isOpen = !collection.collapsed

            return (
              <div key={collection.id} className="mb-0.5">
                {renamingCollection === collection.id ? (
                  <InlineInput
                    placeholder={collection.name}
                    onConfirm={(name) => {
                      renameCollection(collection.id, name)
                      setRenamingCollection(null)
                      if (['git', 'github', 'gitlab'].includes(collection.source)) {
                        openGitAction({ type: 'push', collectionId: collection.id, title: `Renamed collection to '${name}'` })
                      }
                    }}
                    onCancel={() => setRenamingCollection(null)}
                    indent="pl-3"
                  />
                ) : (
                  <CollectionRow
                    collection={collection}
                    open={isOpen}
                    dndId={`col:${collection.id}`}
                    isActive={selectedItem?.type === 'collection' && selectedItem.id === collection.id}
                    onToggle={() => toggleCollectionCollapsed(collection.id)}
                    onSelect={() => selectItem('collection', collection.id)}
                    onAddRequest={() => {
                      if (collection.collapsed) toggleCollectionCollapsed(collection.id)
                      addRequestToCollection(collection.id)
                    }}
                    onAddGroup={() => {
                      if (collection.collapsed) toggleCollectionCollapsed(collection.id)
                      setAddingGroupTo(collection.id)
                    }}
                    onRename={() => setRenamingCollection(collection.id)}
                    onDelete={() => {
                      if (['git', 'github', 'gitlab'].includes(collection.source)) {
                        openGitAction({ type: 'delete-collection', collectionId: collection.id, title: `Delete collection '${collection.name}'` })
                      } else {
                        openDeleteCollection(collection.id)
                      }
                    }}
                    onAi={() => selectItem('ai-collection', collection.id)}
                  />
                )}

                {(isOpen || !!searchQuery) && (
                  <div data-testid={`collection-content-${collection.id}`} className="pl-3">
                    <SortableContext items={collectionGroups.map((g) => `grp:${g.id}`)} strategy={verticalListSortingStrategy}>
                      {collectionGroups.map((group) => (
                        <SortableGroupRow
                          key={group.id}
                          group={group}
                          requests={requests}
                          searchQuery={searchQuery}
                          renamingGroup={renamingGroup}
                          groupMenuOpen={groupMenuOpen}
                          selectedItem={selectedItem}
                          activeRequestId={activeRequestId}
                          dragActiveId={dragActiveId}
                          dragOverId={dragOverId}
                          onRenameConfirm={(name) => {
                            renameGroup(group.id, name)
                            setRenamingGroup(null)
                            const col = collections.find((c) => c.id === group.collectionId)
                            if (col && ['git', 'github', 'gitlab'].includes(col.source)) {
                              openGitAction({ type: 'push', collectionId: col.id, title: `Renamed group to '${name}'`, subtitle: col.name })
                            }
                          }}
                          onRenameCancel={() => setRenamingGroup(null)}
                          onSelect={() => selectItem('group', group.id)}
                          onAddRequest={() => { createLocalRequest(group.id) }}
                          onMenuToggle={() => setGroupMenuOpen(groupMenuOpen === group.id ? null : group.id)}
                          onMenuClose={() => setGroupMenuOpen(null)}
                          onRenameStart={() => setRenamingGroup(group.id)}
                          onDelete={() => {
                            const col = collections.find((c) => c.id === group.collectionId)
                            deleteGroup(group.id).then(() => {
                              if (col && ['git', 'github', 'gitlab'].includes(col.source)) {
                                openGitAction({ type: 'push', collectionId: col.id, title: `Deleted group '${group.name}'`, subtitle: col.name })
                              }
                            })
                          }}
                          onAiGroup={() => selectItem('ai-group', group.id)}
                          onDeleteRequest={(reqId) => {
                            const col = collections.find((c) => c.id === group.collectionId)
                            deleteRequest(reqId).then(() => {
                              if (activeRequestId === reqId) clearActiveRequest()
                              if (col && ['git', 'github', 'gitlab'].includes(col.source)) {
                                openGitAction({ type: 'push', collectionId: col.id, title: 'Deleted endpoint', subtitle: col.name })
                              }
                            })
                          }}
                          onClickRequest={(req) => { clearSelectedItem(); setActiveRequest(req) }}
                        />
                      ))}
                    </SortableContext>

                    {!searchQuery && addingGroupTo === collection.id && (
                      <InlineInput
                        placeholder="Group name…"
                        onConfirm={(name) => {
                          setAddingGroupTo(null)
                          if (['git', 'github', 'gitlab'].includes(collection.source)) {
                            createGroup(collection.id, name).then((groupId) => {
                              if (!groupId) return
                              openGitAction({
                                type: 'push',
                                collectionId: collection.id,
                                title: `Created group '${name}'`,
                                subtitle: collection.name,
                                onCancel: () => deleteGroup(groupId),
                              })
                            })
                          } else {
                            createGroup(collection.id, name)
                          }
                        }}
                        onCancel={() => setAddingGroupTo(null)}
                        indent="pl-2"
                      />
                    )}

                    {!searchQuery && collectionGroups.length === 0 && addingGroupTo !== collection.id && (
                      <div className="mx-2 my-1.5 rounded-sm border border-dashed border-th-border px-2 py-2 text-center">
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

          {addingCollection && (
            <InlineInput
              placeholder="Collection name…"
              onConfirm={async (name) => {
                setAddingCollection(false)
                const payload: { name: string; source: string; integrationId?: string } = { name, source }
                if (integration) payload.integrationId = integration.id
                const { error, data } = await window.api.collections.create(payload)
                if (error) addToast('Failed to create collection', 'error')
                else {
                  await load()
                  if (['git', 'github', 'gitlab'].includes(source) && data?.id) {
                    const colId = data.id
                    openGitAction({
                      type: 'push',
                      collectionId: colId,
                      title: `Created collection '${name}'`,
                      onCancel: () => window.api.collections.delete({ id: colId }).then(() => load()),
                    })
                  }
                }
              }}
              onCancel={() => setAddingCollection(false)}
              indent="pl-2"
            />
          )}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}
