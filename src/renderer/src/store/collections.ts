import { create } from 'zustand'
import type { AuthType, Collection, CollectionSource, Folder, Group, Request, SslVerification } from '../types'
import { normalizeFolder, normalizeRequest } from '@/lib/normalizers'

interface CollectionsState {
  folders: Folder[]
  collections: Collection[]
  groups: Group[]
  requests: Request[]
  searchQuery: string
  hiddenSources: Set<CollectionSource>
  load: () => Promise<void>
  toggleFolderCollapsed: (folderId: string) => Promise<void>
  toggleGroupCollapsed: (groupId: string) => Promise<void>
  toggleCollectionCollapsed: (collectionId: string) => Promise<void>
  toggleSourceHidden: (source: CollectionSource) => void
  setSearchQuery: (q: string) => void
  createSubFolder: (parentId: string, name: string) => Promise<string | null>
  createRootFolder: (name: string, source?: CollectionSource, integrationId?: string) => Promise<string | null>
  createGroup: (parentId: string, name: string) => Promise<string | null>
  addRequestToFolder: (folderId: string) => Promise<void>
  addRequestToCollection: (collectionId: string) => Promise<void>
  deleteCollection: (id: string, commitMessage?: string) => Promise<void>
  renameCollection: (id: string, name: string) => Promise<void>
  deleteRequest: (id: string) => Promise<void>
  markDirty: (requestId: string) => void
  syncRequest: (request: Request) => void
  clearDirtyForCollection: (collectionId: string) => void
  updateCollection: (id: string, updates: { name?: string; description?: string; authType?: AuthType; authConfig?: Record<string, string>; sslVerification?: SslVerification; collapsed?: boolean }) => Promise<void>
  updateGroup: (id: string, updates: { name?: string; description?: string; authType?: AuthType; authConfig?: Record<string, string>; sslVerification?: SslVerification; collapsed?: boolean }) => Promise<void>
  deleteGroup: (id: string) => Promise<void>
  renameGroup: (id: string, name: string) => Promise<void>
  createLocalRequest: (folderId: string) => Promise<void>
  moveRequestToFolder: (requestId: string, newFolderId: string, insertBeforeId: string | null) => Promise<void>
  moveRequestToGroup: (requestId: string, newFolderId: string, insertBeforeId: string | null) => Promise<void>
  moveFolder: (folderId: string, newParentId: string | null, insertBeforeId: string | null) => Promise<void>
  moveGroupToCollection: (folderId: string, newParentId: string, insertBeforeId: string | null) => Promise<void>
  moveCollectionToSource: (collectionId: string, newSource: CollectionSource) => Promise<void>
}

function deriveFoldersState(folders: Folder[]) {
  return {
    folders,
    collections: folders.filter((folder) => !folder.parentId),
    groups: folders.filter((folder) => !!folder.parentId),
  }
}

function getDescendantFolderIds(folders: Folder[], rootId: string): Set<string> {
  const ids = new Set<string>([rootId])
  let added = true
  while (added) {
    added = false
    for (const folder of folders) {
      if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id)
        added = true
      }
    }
  }
  return ids
}

export const useCollectionsStore = create<CollectionsState>((set, get) => ({
  folders: [],
  collections: [],
  groups: [],
  requests: [],
  searchQuery: '',
  hiddenSources: new Set<CollectionSource>(),

  load: async () => {
    const [{ data, error }, { data: reqData, error: reqError }] = await Promise.all([
      window.api.folders.list(),
      window.api.requests.listAll(),
    ])
    if (error || !data) {
      console.error('Failed to load folders:', error)
      return
    }
    if (reqError) {
      console.error('Failed to load requests:', reqError)
      return
    }

    const folders = (data as Record<string, unknown>[]).map(normalizeFolder)
    const requests = ((reqData ?? []) as Record<string, unknown>[]).map(normalizeRequest)

    set({
      ...deriveFoldersState(folders),
      requests,
    })
  },

  toggleFolderCollapsed: async (folderId: string) => {
    const folder = get().folders.find((item) => item.id === folderId)
    if (!folder) return
    const collapsed = !folder.collapsed
    const { error } = await window.api.folders.update({ id: folderId, collapsed })
    if (error) {
      console.error('Failed to update folder:', error)
      return
    }
    set((state) => {
      const folders = state.folders.map((item) => item.id === folderId ? { ...item, collapsed } : item)
      return deriveFoldersState(folders)
    })
  },

  toggleGroupCollapsed: async (groupId: string) => {
    await get().toggleFolderCollapsed(groupId)
  },

  toggleCollectionCollapsed: async (collectionId: string) => {
    await get().toggleFolderCollapsed(collectionId)
  },

  toggleSourceHidden: (source: CollectionSource) => {
    set((state) => {
      const next = new Set(state.hiddenSources)
      if (next.has(source)) next.delete(source)
      else next.add(source)
      return { hiddenSources: next }
    })
  },

  setSearchQuery: (q: string) => set({ searchQuery: q }),

  createSubFolder: async (parentId: string, name: string) => {
    const { data, error } = await window.api.folders.create({ parentId, name, source: 'local' })
    if (error) {
      console.error('Failed to create folder:', error)
      return null
    }
    const folder = normalizeFolder(data as Record<string, unknown>)
    set((state) => {
      const folders = [...state.folders, folder]
      return deriveFoldersState(folders)
    })
    return folder.id
  },

  createRootFolder: async (name: string, source = 'local', integrationId?: string) => {
    const { data, error } = await window.api.folders.create({ name, source, integrationId })
    if (error) {
      console.error('Failed to create collection:', error)
      return null
    }
    const folder = normalizeFolder(data as Record<string, unknown>)
    set((state) => {
      const folders = [...state.folders, folder]
      return deriveFoldersState(folders)
    })
    return folder.id
  },

  createGroup: async (parentId: string, name: string) => get().createSubFolder(parentId, name),

  addRequestToFolder: async (folderId: string) => {
    const { data, error } = await window.api.requests.create({ folderId, name: 'New Request', method: 'GET' })
    if (error) {
      console.error('Failed to create request:', error)
      return
    }
    const request = normalizeRequest(data as Record<string, unknown>)
    set((state) => ({ requests: [...state.requests, request] }))
  },

  addRequestToCollection: async (collectionId: string) => {
    await get().addRequestToFolder(collectionId)
  },

  deleteCollection: async (id: string, commitMessage?: string) => {
    const { error } = await window.api.folders.delete({ id, commitMessage })
    if (error) {
      console.error('Failed to delete collection:', error)
      return
    }
    set((state) => {
      const folderIds = getDescendantFolderIds(state.folders, id)
      const folders = state.folders.filter((folder) => !folderIds.has(folder.id))
      return {
        ...deriveFoldersState(folders),
        requests: state.requests.filter((request) => !folderIds.has(request.folderId)),
      }
    })
  },

  renameCollection: async (id: string, name: string) => {
    const { error } = await window.api.folders.rename({ id, name })
    if (error) {
      console.error('Failed to rename collection:', error)
      return
    }
    set((state) => {
      const folders = state.folders.map((folder) => folder.id === id ? { ...folder, name } : folder)
      return deriveFoldersState(folders)
    })
  },

  deleteRequest: async (id: string) => {
    const { error } = await window.api.requests.delete({ id })
    if (error) {
      console.error('Failed to delete request:', error)
      return
    }
    set((state) => ({ requests: state.requests.filter((request) => request.id !== id) }))
  },

  markDirty: (requestId: string) => {
    window.api.requests.markDirty({ id: requestId, isDirty: true })
    set((state) => ({
      requests: state.requests.map((request) => request.id === requestId ? { ...request, isDirty: true } : request),
    }))
  },

  syncRequest: (request: Request) => {
    set((state) => ({
      requests: state.requests.map((item) => item.id === request.id ? { ...item, ...request } : item),
    }))
  },

  clearDirtyForCollection: (collectionId: string) => {
    set((state) => {
      const folderIds = getDescendantFolderIds(state.folders, collectionId)
      return {
        requests: state.requests.map((request) => folderIds.has(request.folderId) ? { ...request, isDirty: false } : request),
      }
    })
  },

  updateCollection: async (id, updates) => {
    const { error } = await window.api.folders.update({ id, ...updates })
    if (error) {
      console.error('Failed to update collection:', error)
      return
    }
    set((state) => {
      const folders = state.folders.map((folder) => folder.id === id ? { ...folder, ...updates } : folder)
      return deriveFoldersState(folders)
    })
  },

  updateGroup: async (id, updates) => {
    const { error } = await window.api.folders.update({ id, ...updates })
    if (error) {
      console.error('Failed to update folder:', error)
      return
    }
    set((state) => {
      const folders = state.folders.map((folder) => folder.id === id ? { ...folder, ...updates } : folder)
      return deriveFoldersState(folders)
    })
  },

  deleteGroup: async (id: string) => {
    const { error } = await window.api.folders.delete({ id })
    if (error) {
      console.error('Failed to delete folder:', error)
      return
    }
    set((state) => {
      const folderIds = getDescendantFolderIds(state.folders, id)
      const folders = state.folders.filter((folder) => !folderIds.has(folder.id))
      return {
        ...deriveFoldersState(folders),
        requests: state.requests.filter((request) => !folderIds.has(request.folderId)),
      }
    })
  },

  renameGroup: async (id: string, name: string) => {
    const { error } = await window.api.folders.rename({ id, name })
    if (error) {
      console.error('Failed to rename folder:', error)
      return
    }
    set((state) => {
      const folders = state.folders.map((folder) => folder.id === id ? { ...folder, name } : folder)
      return deriveFoldersState(folders)
    })
  },

  createLocalRequest: async (folderId: string) => {
    await get().addRequestToFolder(folderId)
  },

  moveRequestToFolder: async (requestId: string, newFolderId: string, insertBeforeId: string | null) => {
    const state = get()
    const request = state.requests.find((item) => item.id === requestId)
    if (!request) return
    const oldFolderId = request.folderId

    const targetRequests = state.requests
      .filter((item) => item.folderId === newFolderId && item.id !== requestId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    const insertIdx = insertBeforeId ? targetRequests.findIndex((item) => item.id === insertBeforeId) : targetRequests.length
    const finalIdx = insertIdx === -1 ? targetRequests.length : insertIdx
    targetRequests.splice(finalIdx, 0, { ...request, folderId: newFolderId })

    const sourceRequests = oldFolderId !== newFolderId
      ? state.requests.filter((item) => item.folderId === oldFolderId && item.id !== requestId).sort((a, b) => a.sortOrder - b.sortOrder)
      : []

    set((current) => ({
      requests: current.requests.map((item) => {
        const targetIdx = targetRequests.findIndex((candidate) => candidate.id === item.id)
        if (targetIdx !== -1) return { ...item, folderId: newFolderId, sortOrder: targetIdx }
        const sourceIdx = sourceRequests.findIndex((candidate) => candidate.id === item.id)
        if (sourceIdx !== -1) return { ...item, sortOrder: sourceIdx }
        return item
      }),
    }))

    const updates = [
      ...targetRequests.map((item, index) => ({ id: item.id, sortOrder: index, newParentId: newFolderId })),
      ...sourceRequests.map((item, index) => ({ id: item.id, sortOrder: index })),
    ]
    await window.api.reorder({ type: 'request', updates })
  },

  moveRequestToGroup: async (requestId, newFolderId, insertBeforeId) => {
    await get().moveRequestToFolder(requestId, newFolderId, insertBeforeId)
  },

  moveFolder: async (folderId: string, newParentId: string | null, insertBeforeId: string | null) => {
    const state = get()
    const folder = state.folders.find((item) => item.id === folderId)
    if (!folder) return
    const oldParentId = folder.parentId ?? null

    const targetFolders = state.folders
      .filter((item) => (item.parentId ?? null) === newParentId && item.id !== folderId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    const insertIdx = insertBeforeId ? targetFolders.findIndex((item) => item.id === insertBeforeId) : targetFolders.length
    const finalIdx = insertIdx === -1 ? targetFolders.length : insertIdx
    targetFolders.splice(finalIdx, 0, { ...folder, parentId: newParentId ?? undefined })

    const sourceFolders = oldParentId !== newParentId
      ? state.folders.filter((item) => (item.parentId ?? null) === oldParentId && item.id !== folderId).sort((a, b) => a.sortOrder - b.sortOrder)
      : []

    set((current) => {
      const folders = current.folders.map((item) => {
        const targetIdx = targetFolders.findIndex((candidate) => candidate.id === item.id)
        if (targetIdx !== -1) return { ...item, parentId: newParentId ?? undefined, sortOrder: targetIdx }
        const sourceIdx = sourceFolders.findIndex((candidate) => candidate.id === item.id)
        if (sourceIdx !== -1) return { ...item, sortOrder: sourceIdx }
        return item
      })
      return deriveFoldersState(folders)
    })

    const updates = [
      ...targetFolders.map((item, index) => ({ id: item.id, sortOrder: index, newParentId: newParentId })),
      ...sourceFolders.map((item, index) => ({ id: item.id, sortOrder: index })),
    ]
    await window.api.reorder({ type: 'folder', updates })
  },

  moveGroupToCollection: async (folderId, newParentId, insertBeforeId) => {
    await get().moveFolder(folderId, newParentId, insertBeforeId)
  },

  moveCollectionToSource: async (collectionId: string, newSource: CollectionSource) => {
    set((state) => {
      const folders = state.folders.map((folder) => folder.id === collectionId ? { ...folder, source: newSource } : folder)
      return deriveFoldersState(folders)
    })
    await window.api.folders.moveSource({ id: collectionId, source: newSource })
  },
}))
