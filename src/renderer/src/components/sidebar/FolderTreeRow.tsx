import * as Collapsible from '@radix-ui/react-collapsible'
import { ChevronDown, ChevronRight, EyeOff, FolderOpen, FolderPlus, GripVertical, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Folder, Request } from '@/types'
import { AiActionButton } from '@/components/ai/AiActionButton'
import { RequestTreeItem } from '@/components/sidebar/RequestTreeItem'
import { Badge } from '@/components/ui/Badge'
import { useCollectionsStore } from '@/store/collections'
import { useRequestsStore } from '@/store/requests'
import { useUIStore } from '@/store/ui'
import { cn } from '@/lib/utils'
import { InlineInput } from '@/components/sidebar/InlineInput'
import { subtreeMatches } from '@/lib/folder-tree'

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

export function FolderTreeRow({
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
              <button data-testid={`${isRoot ? 'collection' : 'group'}-toggle-${folder.id}`} className="shrink-0 rounded-sm p-0.5 focus:outline-hidden" onClick={(e) => e.stopPropagation()}>
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
              {isDirty && <span data-testid={isRoot ? 'collection-dirty-dot' : 'group-dirty-dot'} className="h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" title="Unsaved changes" />}
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

          <Collapsible.Content data-testid={`${isRoot ? 'collection' : 'group'}-content-${folder.id}`}>
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
