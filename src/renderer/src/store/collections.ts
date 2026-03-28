import { create } from 'zustand'
import type { Collection, CollectionSource, Group, Request } from '../types'

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
  createLocalRequest: (groupId: string) => Promise<void>
  deleteRequest: (id: string) => Promise<void>
  markDirty: (requestId: string) => void
}

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
  if (value != null) return value as T
  return fallback
}

function normalizeRequest(raw: Record<string, unknown>): Request {
  return {
    id: raw.id as string,
    groupId: (raw.groupId ?? raw.group_id) as string,
    name: raw.name as string,
    method: (raw.method ?? 'GET') as Request['method'],
    url: (raw.url ?? '') as string,
    params: parseJsonField<Request['params']>(raw.params, []),
    headers: parseJsonField<Request['headers']>(raw.headers, []),
    bodyType: (raw.bodyType ?? raw.body_type ?? 'none') as Request['bodyType'],
    bodyContent: (raw.bodyContent ?? raw.body_content ?? '') as string,
    authType: (raw.authType ?? raw.auth_type ?? 'none') as Request['authType'],
    authConfig: parseJsonField<Record<string, string>>(raw.authConfig ?? raw.auth_config, {}),
    description: raw.description as string | undefined,
    scmPath: (raw.scmPath ?? raw.scm_path) as string | undefined,
    scmSha: (raw.scmSha ?? raw.scm_sha) as string | undefined,
    isDirty: Boolean(raw.isDirty ?? raw.is_dirty ?? false),
    sortOrder: (raw.sortOrder ?? raw.sort_order ?? 0) as number,
  }
}

function normalizeGroup(raw: Record<string, unknown>): Group {
  return {
    id: raw.id as string,
    collectionId: (raw.collectionId ?? raw.collection_id) as string,
    name: raw.name as string,
    description: raw.description as string | undefined,
    collapsed: Boolean(raw.collapsed ?? false),
    hidden: Boolean(raw.hidden ?? false),
    sortOrder: (raw.sortOrder ?? raw.sort_order ?? 0) as number,
  }
}

export const useCollectionsStore = create<CollectionsState>((set, get) => ({
  collections: [],
  groups: [],
  requests: [],
  searchQuery: '',
  hiddenSources: new Set<CollectionSource>(),

  load: async () => {
    const api = (window as any).api
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
      source: (c.source ?? 'local') as CollectionSource,
      sourceMeta: parseJsonField<Record<string, string>>(c.source_meta, undefined as any),
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
    const api = (window as any).api
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

  createLocalRequest: async (groupId: string) => {
    const api = (window as any).api
    const { data, error } = await api.requests.create({ groupId, name: 'New Request', method: 'GET' })
    if (error) {
      console.error('Failed to create request:', error)
      return
    }
    const req = normalizeRequest(data as Record<string, unknown>)
    set((state) => ({ requests: [...state.requests, req] }))
  },

  deleteRequest: async (id: string) => {
    const api = (window as any).api
    const { error } = await api.requests.delete({ id })
    if (error) {
      console.error('Failed to delete request:', error)
      return
    }
    set((state) => ({ requests: state.requests.filter((r) => r.id !== id) }))
  },

  markDirty: (requestId: string) => {
    const api = (window as any).api
    api.requests.markDirty({ id: requestId, isDirty: true })
    set((state) => ({
      requests: state.requests.map((r) => (r.id === requestId ? { ...r, isDirty: true } : r)),
    }))
  },
}))
