import * as Collapsible from '@radix-ui/react-collapsible'
import { AlertCircle, Check, ChevronDown, ChevronRight, Database, Eye, EyeOff, FolderOpen, FolderPlus, GitBranch, GitFork, GripVertical, MoreHorizontal, Pencil, Plus, Settings, Trash2, X } from 'lucide-react'
import React, { useMemo, useRef, useState } from 'react'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { CollectionSource, Folder, Integration, Request } from '@/types'
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
  folders: Folder[]
  requests: Request[]
  searchQuery: string
  dragActiveId?: string | null
  dragOverId?: string | null
}

interface InlineInputProps {
  placeholder: string
  onConfirm: (name: string) => void
  onCancel: () => void
  paddingLeft?: number
}

function InlineInput({ placeholder, onConfirm, onCancel, paddingLeft = 16 }: InlineInputProps) {
  const [value, setValue] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  React.useEffect(() => { ref.current?.focus() }, [])

  return (
    <div className="flex items-center gap-1 py-0.5 pr-2" style={{ paddingLeft }}>
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { if (value.trim()) onConfirm(value.trim()); else onCancel() }
          if (e.key === 'Escape') onCancel()
        }}
        placeholder={placeholder}
        className="flex-1 rounded-sm bg-th-surface-raised px-2 py-1 text-sm text-th-text-primary placeholder-th-text-subtle outline-hidden ring-1 ring-blue-500/50"
      />
      <button onClick={() => { if (value.trim()) onConfirm(value.trim()); else onCancel() }} className="text-green-400 hover:text-green-300"><Check className="h-3.5 w-3.5" /></button>
      <button onClick={onCancel} className="text-th-text-subtle hover:text-th-text-secondary"><X className="h-3.5 w-3.5" /></button>
    </div>
  )
}

function getRootCollection(folderId: string, folders: Folder[]): Folder | undefined {
  let current = folders.find((folder) => folder.id === folderId)
  while (current?.parentId) {
    current = folders.find((folder) => folder.id === current?.parentId)
  }
  return current
}

function subtreeMatches(folder: Folder, folders: Folder[], requests: Request[], query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (folder.name.toLowerCase().includes(q) || (folder.description ?? '').toLowerCase().includes(q)) return true
  if (requests.some((request) => request.folderId === folder.id && (`${request.name} ${request.url}`.toLowerCase().includes(q)))) return true
  return folders
    .filter((child) => child.parentId === folder.id)
    .some((child) => subtreeMatches(child, folders, requests, query))
}

interface FolderTreeRowProps {
  folder: Folder
  depth: number
  allFolders: Folder[]
  requests: Request[]
  searchQuery: string
  dragActiveId?: string | null
  dragOverId?: string | null
  renamingFolderId: string | null
  folderMenuOpen: string | null
  addingFolderTo: string | null
  addingRequestTo: string | null
  onRenameStart: (folderId: string) => void
  onRenameCancel: () => void
  onRenameConfirm: (folder: Folder, name: string) => void
  onMenuToggle: (folderId: string) => void
  onMenuClose: () => void
  onAddFolderStart: (folderId: string) => void
  onAddFolderCancel: () => void
  onAddFolderConfirm: (parent: Folder, name: string) => void
  onAddRequest: (folder: Folder) => void
  onDeleteFolder: (folder: Folder) => void
  onDeleteRequest: (folder: Folder, requestId: string) => void
}

function FolderTreeRow({
  folder,
  depth,
  allFolders,
  requests,
  searchQuery,
  dragActiveId,
  dragOverId,
  renamingFolderId,
  folderMenuOpen,
  addingFolderTo,
  addingRequestTo,
  onRenameStart,
  onRenameCancel,
  onRenameConfirm,
  onMenuToggle,
  onMenuClose,
  onAddFolderStart,
  onAddFolderCancel,
  onAddFolderConfirm,
  onAddRequest,
  onDeleteFolder,
  onDeleteRequest,
}: FolderTreeRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `fld:${folder.id}` })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }
  const toggleFolderCollapsed = useCollectionsStore((state) => state.toggleFolderCollapsed)
  const { activeRequestId, setActiveRequest, clearActiveRequest } = useRequestsStore()
  const { selectItem, clearSelectedItem, selectedItem } = useUIStore()
  const isDirty = useUIStore((state) => state.dirtyEditors.has(folder.id))

  const children = allFolders
    .filter((child) => child.parentId === folder.id)
    .filter((child) => subtreeMatches(child, allFolders, requests, searchQuery))
    .sort((a, b) => a.sortOrder - b.sortOrder)
  const folderRequests = requests
    .filter((request) => request.folderId === folder.id && (!searchQuery || `${request.name} ${request.url}`.toLowerCase().includes(searchQuery.toLowerCase())))
    .sort((a, b) => a.sortOrder - b.sortOrder)

  if (searchQuery && !subtreeMatches(folder, allFolders, requests, searchQuery)) return null

  const isRoot = !folder.parentId
  const isOpen = !folder.collapsed || !!searchQuery
  const isSelected = selectedItem?.id === folder.id && selectedItem.type === (isRoot ? 'collection' : 'group')

  const activeReqId = dragActiveId?.startsWith('req:') ? dragActiveId.slice(4) : null
  const activeReq = activeReqId ? requests.find((request) => request.id === activeReqId) : null
  const isExternalReqDrag = !!activeReq && activeReq.folderId !== folder.id
  const overIsThisFolder = dragOverId === `fld:${folder.id}` || folderRequests.some((request) => dragOverId === `req:${request.id}`)
  const showDropTarget = isExternalReqDrag && overIsThisFolder

  const overReqId = dragOverId?.startsWith('req:') ? dragOverId.slice(4) : null
  const isSameFolderDrag = !!activeReqId && activeReq?.folderId === folder.id
  let insertLineAboveId: string | null = null
  let insertLineBelowId: string | null = null
  if (isSameFolderDrag && overReqId) {
    const activeIdx = folderRequests.findIndex((request) => request.id === activeReqId)
    const overIdx = folderRequests.findIndex((request) => request.id === overReqId)
    if (activeIdx !== -1 && overIdx !== -1 && activeIdx !== overIdx) {
      if (activeIdx < overIdx) insertLineBelowId = overReqId
      else insertLineAboveId = overReqId
    }
  }

  const rowPadding = isRoot ? 8 : 8 + depth * 16

  return (
    <div ref={setNodeRef} style={style}>
      {renamingFolderId === folder.id ? (
        <InlineInput
          placeholder={folder.name}
          paddingLeft={rowPadding}
          onConfirm={(name) => onRenameConfirm(folder, name)}
          onCancel={onRenameCancel}
        />
      ) : (
        <Collapsible.Root open={isOpen} onOpenChange={() => toggleFolderCollapsed(folder.id)}>
          <div
            className={cn(
              'group relative flex items-center gap-1 rounded-sm px-2 py-0.5 text-th-text-muted hover:text-th-text-primary',
              isSelected ? 'bg-th-surface-hover text-th-text-primary' : 'hover:bg-th-surface-raised/60',
              showDropTarget && 'ring-1 ring-blue-500/40 bg-blue-500/5'
            )}
            style={{ paddingLeft: rowPadding }}
          >
            <button
              {...listeners}
              {...attributes}
              className="cursor-grab shrink-0 rounded-sm p-0.5 text-th-text-faint opacity-0 hover:text-th-text-muted focus:outline-hidden group-hover:opacity-100 active:cursor-grabbing"
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical className="h-3.5 w-3.5" />
            </button>

            <Collapsible.Trigger asChild>
              <button className="shrink-0 rounded-sm p-0.5 focus:outline-hidden" onClick={(e) => e.stopPropagation()}>
                {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
            </Collapsible.Trigger>

            <button
              onClick={() => selectItem(isRoot ? 'collection' : 'group', folder.id)}
              className={cn(
                'flex flex-1 items-center gap-1.5 truncate rounded-sm py-1 text-left text-sm font-semibold focus:outline-hidden',
                isSelected ? 'text-th-text-primary' : 'text-th-text-muted hover:text-th-text-primary',
                folder.hidden && 'opacity-50'
              )}
            >
              {isRoot ? <FolderOpen className="h-3.5 w-3.5 shrink-0" /> : <FolderPlus className="h-3.5 w-3.5 shrink-0" />}
              <span className="truncate">{folder.name}</span>
              {isRoot && <Badge variant="grey" className="ml-1">{folder.source}</Badge>}
              {isDirty && <span data-testid="group-dirty-dot" className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" title="Unsaved changes" />}
              {folder.hidden && <EyeOff className="ml-auto h-3 w-3 shrink-0" />}
            </button>

            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
              <button title="Add request" onClick={() => onAddRequest(folder)} className="rounded-sm p-0.5 hover:bg-th-surface-hover focus:outline-hidden">
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button title="Add folder" onClick={() => onAddFolderStart(folder.id)} className="rounded-sm p-0.5 hover:bg-th-surface-hover focus:outline-hidden">
                <FolderPlus className="h-3.5 w-3.5" />
              </button>
              <button title="More" onClick={(e) => { e.stopPropagation(); onMenuToggle(folder.id) }} className="rounded-sm p-0.5 hover:bg-th-surface-hover focus:outline-hidden">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </div>

            {folderMenuOpen === folder.id && (
              <>
                <div className="fixed inset-0 z-10" onClick={onMenuClose} />
                <div className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-sm border border-th-border-strong bg-th-surface-raised shadow-lg">
                  <AiActionButton variant="menu-item" onClick={() => { onMenuClose(); selectItem(isRoot ? 'ai-collection' : 'ai-group', folder.id) }} />
                  <div className="mx-2 border-t border-th-border" />
                  <button className="flex w-full items-center gap-2 px-3 py-2 text-sm text-th-text-primary hover:bg-th-surface-hover" onClick={() => { onMenuClose(); onRenameStart(folder.id) }}>
                    <Pencil className="h-3.5 w-3.5" /> Rename
                  </button>
                  <button className="flex w-full items-center gap-2 px-3 py-2 text-sm text-rose-400 hover:bg-th-surface-hover" onClick={() => { onMenuClose(); onDeleteFolder(folder) }}>
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                </div>
              </>
            )}
          </div>

          <Collapsible.Content>
            <div>
              {folderRequests.length === 0 && children.length === 0 && !addingFolderTo && !addingRequestTo && !searchQuery && (
                <div className="mx-2 my-1.5 rounded-sm border border-dashed border-th-border px-2 py-2 text-center" style={{ marginLeft: rowPadding + 28 }}>
                  <p className="text-xs text-th-text-faint">Folder is empty</p>
                  <p className="mt-0.5 text-xs text-th-text-muted">Use + to add content</p>
                </div>
              )}

              {addingFolderTo === folder.id && (
                <InlineInput
                  placeholder="Folder name…"
                  paddingLeft={rowPadding + 32}
                  onConfirm={(name) => onAddFolderConfirm(folder, name)}
                  onCancel={onAddFolderCancel}
                />
              )}

              <SortableContext items={folderRequests.map((request) => `req:${request.id}`)} strategy={verticalListSortingStrategy}>
                {folderRequests.map((request) => (
                  <div key={request.id} style={{ paddingLeft: rowPadding + 28 }}>
                    <RequestTreeItem
                      dndId={`req:${request.id}`}
                      request={request}
                      isActive={request.id === activeRequestId && !selectedItem}
                      insertLine={insertLineAboveId === request.id ? 'above' : insertLineBelowId === request.id ? 'below' : null}
                      onClick={() => { clearSelectedItem(); setActiveRequest(request) }}
                      onDelete={() => {
                        onDeleteRequest(folder, request.id)
                        if (activeRequestId === request.id) clearActiveRequest()
                      }}
                    />
                  </div>
                ))}
              </SortableContext>

              <SortableContext items={children.map((child) => `fld:${child.id}`)} strategy={verticalListSortingStrategy}>
                {children.map((child) => (
                  <FolderTreeRow
                    key={child.id}
                    folder={child}
                    depth={depth + 1}
                    allFolders={allFolders}
                    requests={requests}
                    searchQuery={searchQuery}
                    dragActiveId={dragActiveId}
                    dragOverId={dragOverId}
                    renamingFolderId={renamingFolderId}
                    folderMenuOpen={folderMenuOpen}
                    addingFolderTo={addingFolderTo}
                    addingRequestTo={addingRequestTo}
                    onRenameStart={onRenameStart}
                    onRenameCancel={onRenameCancel}
                    onRenameConfirm={onRenameConfirm}
                    onMenuToggle={onMenuToggle}
                    onMenuClose={onMenuClose}
                    onAddFolderStart={onAddFolderStart}
                    onAddFolderCancel={onAddFolderCancel}
                    onAddFolderConfirm={onAddFolderConfirm}
                    onAddRequest={onAddRequest}
                    onDeleteFolder={onDeleteFolder}
                    onDeleteRequest={onDeleteRequest}
                  />
                ))}
              </SortableContext>
            </div>
          </Collapsible.Content>
        </Collapsible.Root>
      )}
    </div>
  )
}

export function GroupSection({ source, integration, folders, requests, searchQuery, dragActiveId, dragOverId }: GroupSectionProps) {
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [addingCollection, setAddingCollection] = useState(false)
  const [addingFolderTo, setAddingFolderTo] = useState<string | null>(null)
  const [folderMenuOpen, setFolderMenuOpen] = useState<string | null>(null)

  const {
    toggleSourceHidden,
    hiddenSources,
    addRequestToFolder,
    createSubFolder,
    createRootFolder,
    renameCollection,
    deleteGroup,
    renameGroup,
    load,
  } = useCollectionsStore()
  const addToast = useUIStore((state) => state.addToast)
  const openDeleteCollection = useUIStore((state) => state.openDeleteCollection)
  const openGitAction = useUIStore((state) => state.openGitAction)
  const collapsedSources = useUIStore((state) => state.collapsedSources)
  const toggleSourceCollapsed = useUIStore((state) => state.toggleSourceCollapsed)
  const integrationsStore = useIntegrationsStore()
  const { selectItem, selectedItem } = useUIStore()

  const rootFolders = useMemo(() => {
    const candidates = folders.filter((folder) => !folder.parentId)
    return (integration
      ? candidates.filter((folder) => folder.integrationId === integration.id)
      : candidates.filter((folder) => folder.source === source && !folder.integrationId)
    ).sort((a, b) => a.sortOrder - b.sortOrder)
  }, [folders, integration, source])

  const isSourceHidden = hiddenSources.has(source)
  const isSourceOpen = !collapsedSources.has(source)

  const totalRequests = requests.filter((request) => {
    const collection = getRootCollection(request.folderId, folders)
    return collection && rootFolders.some((root) => root.id === collection.id)
  })

  const handleRenameConfirm = (folder: Folder, name: string) => {
    setRenamingFolderId(null)
    const collection = getRootCollection(folder.id, folders)
    if (!collection) return
    if (!folder.parentId) {
      renameCollection(folder.id, name)
      if (['git', 'github', 'gitlab'].includes(collection.source)) {
        openGitAction({ type: 'push', collectionId: collection.id, title: `Renamed collection to '${name}'` })
      }
      return
    }
    renameGroup(folder.id, name)
    if (['git', 'github', 'gitlab'].includes(collection.source)) {
      openGitAction({ type: 'push', collectionId: collection.id, title: `Renamed folder to '${name}'`, subtitle: collection.name })
    }
  }

  const handleAddFolderConfirm = async (parent: Folder, name: string) => {
    setAddingFolderTo(null)
    const folderId = await createSubFolder(parent.id, name)
    const collection = getRootCollection(parent.id, folders)
    if (folderId && collection && ['git', 'github', 'gitlab'].includes(collection.source)) {
      openGitAction({
        type: 'push',
        collectionId: collection.id,
        title: `Created folder '${name}'`,
        subtitle: collection.name,
        onCancel: () => deleteGroup(folderId),
      })
    }
  }

  const handleAddRequest = (folder: Folder) => {
    void addRequestToFolder(folder.id)
  }

  const handleDeleteFolder = (folder: Folder) => {
    const collection = getRootCollection(folder.id, folders)
    if (!folder.parentId) {
      if (['git', 'github', 'gitlab'].includes(folder.source)) {
        openGitAction({ type: 'delete-collection', collectionId: folder.id, title: `Delete collection '${folder.name}'` })
      } else {
        openDeleteCollection(folder.id)
      }
      return
    }

    void deleteGroup(folder.id).then(() => {
      if (collection && ['git', 'github', 'gitlab'].includes(collection.source)) {
        openGitAction({ type: 'push', collectionId: collection.id, title: `Deleted folder '${folder.name}'`, subtitle: collection.name })
      }
    })
  }

  const handleDeleteRequest = (folder: Folder, requestId: string) => {
    const collection = getRootCollection(folder.id, folders)
    void useCollectionsStore.getState().deleteRequest(requestId).then(() => {
      if (collection && ['git', 'github', 'gitlab'].includes(collection.source)) {
        openGitAction({ type: 'push', collectionId: collection.id, title: 'Deleted endpoint', subtitle: collection.name })
      }
    })
  }

  return (
    <Collapsible.Root open={isSourceOpen} onOpenChange={() => toggleSourceCollapsed(source)} className="mb-1">
      <div className="group/header flex items-center gap-1 rounded-sm px-2 py-0.5 text-th-text-muted hover:text-th-text-primary">
        <Collapsible.Trigger asChild>
          <button data-testid={`source-toggle-${source}`} className="shrink-0 rounded-sm p-0.5 focus:outline-hidden">
            {isSourceOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        </Collapsible.Trigger>

        <span className="shrink-0 p-0.5">{integration ? SOURCE_ICONS[integration.type] : SOURCE_ICONS[source]}</span>

        <button
          onClick={() => {
            if (integration && ['git', 'github', 'gitlab'].includes(integration.type)) selectItem('git-source', integration.id)
            else toggleSourceCollapsed(source)
          }}
          className={cn('flex flex-1 items-center gap-1 truncate rounded-sm py-1 text-left text-sm font-semibold focus:outline-hidden', selectedItem?.type === 'git-source' && selectedItem.id === integration?.id && 'text-th-text-primary')}
        >
          <span className="truncate">{integration ? integration.name : capitalize(source)}</span>
          <Badge variant="grey" className="ml-0.5">{totalRequests.length}</Badge>
        </button>

        {integration ? (
          <div className="flex items-center gap-0.5">
            {(integration.status === 'error' || integration.status === 'disconnected') && (
              <button onClick={() => integrationsStore.connect(integration.id)} className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-amber-400 hover:bg-th-surface-raised hover:text-amber-300 focus:outline-hidden" title="Reconnect">
                <AlertCircle className="h-3 w-3" />
                <span className="hidden group-hover/header:inline">Reconnect</span>
              </button>
            )}
            <button onClick={() => { if (!isSourceOpen) toggleSourceCollapsed(source); setAddingCollection(true) }} className="rounded-sm p-0.5 text-th-text-faint opacity-0 hover:text-th-text-muted focus:outline-hidden group-hover/header:opacity-100" title="Add collection">
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => selectItem('edit-integration', integration.id)} className="rounded-sm p-0.5 text-th-text-faint opacity-0 hover:text-th-text-muted focus:outline-hidden group-hover/header:opacity-100" title="Edit integration">
              <Settings className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-0.5">
            <button onClick={() => { if (!isSourceOpen) toggleSourceCollapsed(source); setAddingCollection(true) }} className="rounded-sm p-0.5 text-th-text-faint opacity-0 hover:text-th-text-muted focus:outline-hidden group-hover/header:opacity-100" title="Add collection">
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => toggleSourceHidden(source)} className="rounded-sm p-0.5 text-th-text-faint hover:text-th-text-muted focus:outline-hidden" title={isSourceHidden ? 'Show source' : 'Hide source'}>
              {isSourceHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}
      </div>

      <Collapsible.Content>
        <div data-testid={`source-content-${source}`} className={cn(isSourceHidden && 'opacity-40')}>
          {rootFolders.length === 0 && !addingCollection && (
            <div className="mx-3 my-2 rounded-sm border border-dashed border-th-border px-3 py-3 text-center">
              <p className="text-xs text-th-text-faint">No collections yet</p>
              <p className="mt-0.5 text-xs text-th-text-muted">Use + to add one</p>
            </div>
          )}

          <SortableContext items={rootFolders.map((folder) => `fld:${folder.id}`)} strategy={verticalListSortingStrategy}>
            {rootFolders.map((folder) => (
              <FolderTreeRow
                key={folder.id}
                folder={folder}
                depth={0}
                allFolders={folders}
                requests={requests}
                searchQuery={searchQuery}
                dragActiveId={dragActiveId}
                dragOverId={dragOverId}
                renamingFolderId={renamingFolderId}
                folderMenuOpen={folderMenuOpen}
                addingFolderTo={addingFolderTo}
                addingRequestTo={null}
                onRenameStart={setRenamingFolderId}
                onRenameCancel={() => setRenamingFolderId(null)}
                onRenameConfirm={handleRenameConfirm}
                onMenuToggle={(folderId) => setFolderMenuOpen(folderMenuOpen === folderId ? null : folderId)}
                onMenuClose={() => setFolderMenuOpen(null)}
                onAddFolderStart={setAddingFolderTo}
                onAddFolderCancel={() => setAddingFolderTo(null)}
                onAddFolderConfirm={handleAddFolderConfirm}
                onAddRequest={handleAddRequest}
                onDeleteFolder={handleDeleteFolder}
                onDeleteRequest={handleDeleteRequest}
              />
            ))}
          </SortableContext>

          {addingCollection && (
            <InlineInput
              placeholder="Collection name…"
              paddingLeft={16}
              onConfirm={async (name) => {
                setAddingCollection(false)
                const collectionId = await createRootFolder(name, source, integration?.id)
                if (!collectionId) {
                  addToast('Failed to create collection', 'error')
                  return
                }
                await load()
                if (['git', 'github', 'gitlab'].includes(source)) {
                  openGitAction({
                    type: 'push',
                    collectionId,
                    title: `Created collection '${name}'`,
                    onCancel: () => window.api.folders.delete({ id: collectionId }).then(() => load()),
                  })
                }
              }}
              onCancel={() => setAddingCollection(false)}
            />
          )}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}
