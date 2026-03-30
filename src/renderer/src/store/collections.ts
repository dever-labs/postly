import { create } from 'zustand'
import type { AuthType, Collection, CollectionSource, Group, Request, SslVerification } from '../types'
import { parseJsonField, normalizeRequest, normalizeGroup } from '@/lib/normalizers'

interface CollectionsState {
  collections: Collection[]
  groups: Group[]
  requests: Request[]
  searchQuery: string
  hiddenSources: Set<CollectionSource>
  load: () => Promise<void>
  toggleGroupCollapsed: (groupId: string) => Promise<void>
  toggleSourceHidden: (source: CollectionSource) => void
  setSearchQuery: (q: string) => void
  createGroup: (collectionId: string, name: string) => Promise<void>
  addRequestToCollection: (collectionId: string) => Promise<void>
  deleteCollection: (id: string, commitMessage?: string) => Promise<void>
  renameCollection: (id: string, name: string) => Promise<void>
  deleteRequest: (id: string) => Promise<void>
  markDirty: (requestId: string) => void
  syncRequest: (request: Request) => void
  updateCollection: (id: string, updates: { name?: string; description?: string; authType?: AuthType; authConfig?: Record<string, string>; sslVerification?: SslVerification }) => Promise<void>
  updateGroup: (id: string, updates: { name?: string; description?: string; authType?: AuthType; authConfig?: Record<string, string>; sslVerification?: SslVerification }) => Promise<void>
  deleteGroup: (id: string) => Promise<void>
  renameGroup: (id: string, name: string) => Promise<void>
  createLocalRequest: (groupId: string) => Promise<void>
  moveRequestToGroup: (requestId: string, newGroupId: string, insertBeforeId: string | null) => Promise<void>
  moveGroupToCollection: (groupId: string, newCollectionId: string, insertBeforeId: string | null) => Promise<void>
  moveCollectionToSource: (collectionId: string, newSource: CollectionSource) => Promise<void>
}

export const useCollectionsStore = create<CollectionsState>((set, get) => ({
  collections: [],
  groups: [],
  requests: [],
  searchQuery: '',
  hiddenSources: new Set<CollectionSource>(),

  load: async () => {
    const api = window.api
    const { data, error: collectionsError } = await api.collections.list()
    if (collectionsError || !data) {
      console.error('Failed to load collections:', collectionsError)
      return
    }

    // IPC returns { collections: [...], groups: [...] } as two flat arrays
    const rawCollections: Record<string, unknown>[] = data.collections ?? []
    const rawGroups: Record<string, unknown>[] = data.groups ?? []

    const collections: Collection[] = rawCollections.map((c) => ({
      id: c.id as string,
      name: c.name as string,
      description: (c.description ?? '') as string,
      source: (c.source ?? 'local') as CollectionSource,
      sourceMeta: parseJsonField<Record<string, string> | undefined>(c.source_meta, undefined),
      integrationId: (c.integration_id ?? undefined) as string | undefined,
      authType: (c.auth_type ?? 'none') as AuthType,
      authConfig: parseJsonField<Record<string, string>>(c.auth_config, {}),
      sslVerification: (c.ssl_verification ?? 'inherit') as SslVerification,
      createdAt: (c.created_at ?? 0) as number,
      updatedAt: (c.updated_at ?? 0) as number,
    }))

    const allGroups: Group[] = rawGroups.map(normalizeGroup)
    const allRequests: Request[] = []

    for (const group of allGroups) {
      const { data: reqData, error: reqError } = await api.requests.list({ groupId: group.id })
      if (reqError) {
        console.error(`Failed to load requests for group ${group.id}:`, reqError)
        continue
      }
      const reqs: Request[] = (reqData ?? []).map((r: Record<string, unknown>) => normalizeRequest(r))
      allRequests.push(...reqs)
    }

    set({ collections, groups: allGroups, requests: allRequests })
  },

  toggleGroupCollapsed: async (groupId: string) => {
    const group = get().groups.find((g) => g.id === groupId)
    if (!group) return
    const newCollapsed = !group.collapsed
    const api = window.api
    const { error } = await api.groups.update({ id: groupId, collapsed: newCollapsed })
    if (error) {
      console.error('Failed to update group:', error)
      return
    }
    set((state) => ({
      groups: state.groups.map((g) => (g.id === groupId ? { ...g, collapsed: newCollapsed } : g)),
    }))
  },

  toggleSourceHidden: (source: CollectionSource) => {
    set((state) => {
      const next = new Set(state.hiddenSources)
      if (next.has(source)) {
        next.delete(source)
      } else {
        next.add(source)
      }
      return { hiddenSources: next }
    })
  },

  setSearchQuery: (q: string) => set({ searchQuery: q }),

  createGroup: async (collectionId: string, name: string) => {
    const api = window.api
    const { data, error } = await api.groups.create({ collectionId, name })
    if (error) {
      console.error('Failed to create group:', error)
      return
    }
    const group = normalizeGroup(data as Record<string, unknown>)
    set((state) => ({ groups: [...state.groups, group] }))
  },

  deleteCollection: async (id: string, commitMessage?: string) => {
    const api = window.api
    const { error } = await api.collections.delete({ id, commitMessage })
    if (error) { console.error('Failed to delete collection:', error); return }
    set((state) => ({
      collections: state.collections.filter((c) => c.id !== id),
      groups: state.groups.filter((g) => g.collectionId !== id),
    }))
  },

  renameCollection: async (id: string, name: string) => {
    const api = window.api
    const { error } = await api.collections.rename({ id, name })
    if (error) { console.error('Failed to rename collection:', error); return }
    set((state) => ({
      collections: state.collections.map((c) => c.id === id ? { ...c, name } : c),
    }))
  },

  addRequestToCollection: async (collectionId: string) => {
    const api = window.api
    // reuse an existing group or auto-create a "Default" one
    let group = get().groups.find((g) => g.collectionId === collectionId)
    if (!group) {
      const { data, error } = await api.groups.create({ collectionId, name: 'Default' })
      if (error) { console.error('Failed to create default group:', error); return }
      const newGroup = normalizeGroup(data as Record<string, unknown>)
      group = newGroup
      set((state) => ({ groups: [...state.groups, newGroup] }))
    }
    const { data, error } = await api.requests.create({ groupId: group.id, name: 'New Request', method: 'GET' })
    if (error) { console.error('Failed to create request:', error); return }
    const req = normalizeRequest(data as Record<string, unknown>)
    set((state) => ({ requests: [...state.requests, req] }))
  },

  createLocalRequest: async (groupId: string) => {
    const api = window.api
    const { data, error } = await api.requests.create({ groupId, name: 'New Request', method: 'GET' })
    if (error) {
      console.error('Failed to create request:', error)
      return
    }
    const req = normalizeRequest(data as Record<string, unknown>)
    set((state) => ({ requests: [...state.requests, req] }))
  },

  deleteRequest: async (id: string) => {
    const api = window.api
    const { error } = await api.requests.delete({ id })
    if (error) { console.error('Failed to delete request:', error); return }
    set((state) => ({ requests: state.requests.filter((r) => r.id !== id) }))
  },

  markDirty: (requestId: string) => {
    const api = window.api
    api.requests.markDirty({ id: requestId, isDirty: true })
    set((state) => ({
      requests: state.requests.map((r) => (r.id === requestId ? { ...r, isDirty: true } : r)),
    }))
  },

  syncRequest: (request: Request) => {
    set((state) => ({
      requests: state.requests.map((r) => (r.id === request.id ? { ...r, ...request } : r)),
    }))
  },

  updateCollection: async (id: string, updates: { name?: string; description?: string; authType?: AuthType; authConfig?: Record<string, string>; sslVerification?: SslVerification }) => {
    const api = window.api
    const { error } = await api.collections.update({ id, ...updates })
    if (error) { console.error('Failed to update collection:', error); return }
    set((state) => ({
      collections: state.collections.map((c) =>
        c.id === id ? { ...c, ...updates } : c
      ),
    }))
  },

  updateGroup: async (id: string, updates: { name?: string; description?: string; authType?: AuthType; authConfig?: Record<string, string>; sslVerification?: SslVerification }) => {
    const api = window.api
    const { error } = await api.groups.update({ id, ...updates })
    if (error) { console.error('Failed to update group:', error); return }
    set((state) => ({
      groups: state.groups.map((g) =>
        g.id === id ? { ...g, ...updates } : g
      ),
    }))
  },

  deleteGroup: async (id: string) => {
    const api = window.api
    const { error } = await api.groups.delete({ id })
    if (error) { console.error('Failed to delete group:', error); return }
    set((state) => ({
      groups: state.groups.filter((g) => g.id !== id),
      requests: state.requests.filter((r) => r.groupId !== id),
    }))
  },

  renameGroup: async (id: string, name: string) => {
    const api = window.api
    const { error } = await api.groups.update({ id, name })
    if (error) { console.error('Failed to rename group:', error); return }
    set((state) => ({
      groups: state.groups.map((g) => g.id === id ? { ...g, name } : g),
    }))
  },

  moveRequestToGroup: async (requestId: string, newGroupId: string, insertBeforeId: string | null) => {
    const state = get()
    const req = state.requests.find((r) => r.id === requestId)
    if (!req) return
    const oldGroupId = req.groupId

    const targetReqs = state.requests
      .filter((r) => r.groupId === newGroupId && r.id !== requestId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    const insertIdx = insertBeforeId ? targetReqs.findIndex((r) => r.id === insertBeforeId) : targetReqs.length
    const finalIdx = insertIdx === -1 ? targetReqs.length : insertIdx
    targetReqs.splice(finalIdx, 0, { ...req, groupId: newGroupId })

    const sourceReqs = oldGroupId !== newGroupId
      ? state.requests.filter((r) => r.groupId === oldGroupId && r.id !== requestId).sort((a, b) => a.sortOrder - b.sortOrder)
      : []

    set((s) => ({
      requests: s.requests.map((r) => {
        const tIdx = targetReqs.findIndex((x) => x.id === r.id)
        if (tIdx !== -1) return { ...r, groupId: newGroupId, sortOrder: tIdx }
        const sIdx = sourceReqs.findIndex((x) => x.id === r.id)
        if (sIdx !== -1) return { ...r, sortOrder: sIdx }
        return r
      }),
    }))

    const updates = [
      ...targetReqs.map((r, i) => ({ id: r.id, sortOrder: i, newParentId: newGroupId })),
      ...sourceReqs.map((r, i) => ({ id: r.id, sortOrder: i })),
    ]
    await window.api.reorder({ type: 'request', updates })
  },

  moveGroupToCollection: async (groupId: string, newCollectionId: string, insertBeforeId: string | null) => {
    const state = get()
    const grp = state.groups.find((g) => g.id === groupId)
    if (!grp) return
    const oldCollectionId = grp.collectionId

    const targetGroups = state.groups
      .filter((g) => g.collectionId === newCollectionId && g.id !== groupId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    const insertIdx = insertBeforeId ? targetGroups.findIndex((g) => g.id === insertBeforeId) : targetGroups.length
    const finalIdx = insertIdx === -1 ? targetGroups.length : insertIdx
    targetGroups.splice(finalIdx, 0, { ...grp, collectionId: newCollectionId })

    const sourceGroups = oldCollectionId !== newCollectionId
      ? state.groups.filter((g) => g.collectionId === oldCollectionId && g.id !== groupId).sort((a, b) => a.sortOrder - b.sortOrder)
      : []

    set((s) => ({
      groups: s.groups.map((g) => {
        const tIdx = targetGroups.findIndex((x) => x.id === g.id)
        if (tIdx !== -1) return { ...g, collectionId: newCollectionId, sortOrder: tIdx }
        const sIdx = sourceGroups.findIndex((x) => x.id === g.id)
        if (sIdx !== -1) return { ...g, sortOrder: sIdx }
        return g
      }),
    }))

    const updates = [
      ...targetGroups.map((g, i) => ({ id: g.id, sortOrder: i, newParentId: newCollectionId })),
      ...sourceGroups.map((g, i) => ({ id: g.id, sortOrder: i })),
    ]
    await window.api.reorder({ type: 'group', updates })
  },

  moveCollectionToSource: async (collectionId: string, newSource: CollectionSource) => {
    set((s) => ({
      collections: s.collections.map((c) => c.id === collectionId ? { ...c, source: newSource } : c),
    }))
    await window.api.collections.moveSource({ id: collectionId, source: newSource })
  },
}))
