import * as Collapsible from '@radix-ui/react-collapsible'
import { AlertCircle, ChevronDown, ChevronRight, Database, Eye, EyeOff, FolderOpen, GitBranch, GitFork, Plus, Settings } from 'lucide-react'
import React, { useMemo, useState } from 'react'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { CollectionSource, Folder, Integration, Request } from '@/types'
import { Badge } from '@/components/ui/Badge'
import { useCollectionsStore } from '@/store/collections'
import { useIntegrationsStore } from '@/store/integrations'
import { useUIStore } from '@/store/ui'
import { cn } from '@/lib/utils'
import { FolderTreeRow } from '@/components/sidebar/FolderTreeRow'
import { InlineInput } from '@/components/sidebar/InlineInput'
import { getRootCollection } from '@/lib/folder-tree'

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
