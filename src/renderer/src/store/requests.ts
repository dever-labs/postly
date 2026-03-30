import { create } from 'zustand'
import type { HttpRequest, HttpResponse, Request } from '../types'
import { kvpToRecord, serializeRequest } from '@/lib/normalizers'
import { useCollectionsStore } from './collections'

interface RequestsState {
  activeRequestId: string | null
  editingRequest: Request | null
  response: HttpResponse | null
  isLoading: boolean
  setActiveRequest: (request: Request) => void
  clearActiveRequest: () => void
  updateField: (field: keyof Request, value: unknown) => void
  sendRequest: () => Promise<void>
  saveRequest: () => Promise<void>
  clearDirty: (requestId: string) => void
}

const DIRTY_FIELDS = new Set<keyof Request>([
  'name', 'method', 'url', 'params', 'headers',
  'bodyType', 'bodyContent', 'authType', 'authConfig', 'description',
  'sslVerification', 'protocol', 'protocolConfig',
])

export const useRequestsStore = create<RequestsState>((set, get) => ({
  activeRequestId: null,
  editingRequest: null,
  response: null,
  isLoading: false,

  setActiveRequest: (request: Request) => {
    set({
      activeRequestId: request.id,
      editingRequest: JSON.parse(JSON.stringify(request)) as Request,
      response: null,
    })
  },

  clearActiveRequest: () => {
    set({ activeRequestId: null, editingRequest: null, response: null })
  },

  updateField: (field: keyof Request, value: unknown) => {
    set((state) => {
      if (!state.editingRequest) return state
      const updated: Request = { ...state.editingRequest, [field]: value }
      if (DIRTY_FIELDS.has(field)) {
        updated.isDirty = true
      }
      return { editingRequest: updated }
    })
  },

  sendRequest: async () => {
    const { editingRequest } = get()
    if (!editingRequest) return

    set({ isLoading: true, response: null })

    const pc = editingRequest.protocolConfig ?? {}
    let bodyContent = editingRequest.bodyContent
    let bodyType = editingRequest.bodyType

    // For GraphQL, build the standard GQL request body
    if (editingRequest.protocol === 'graphql') {
      const gqlBody: Record<string, unknown> = { query: editingRequest.bodyContent }
      if (pc.variables) {
        try { gqlBody.variables = JSON.parse(pc.variables) } catch { gqlBody.variables = {} }
      }
      if (pc.operationName) gqlBody.operationName = pc.operationName
      bodyContent = JSON.stringify(gqlBody)
      bodyType = 'raw-json'
    }

    const httpRequest: HttpRequest = {
      method: editingRequest.protocol === 'graphql' ? 'POST' : editingRequest.method,
      url: editingRequest.url,
      headers: kvpToRecord(editingRequest.headers),
      body: bodyType !== 'none' ? bodyContent : undefined,
      bodyType,
      authType: editingRequest.authType,
      authConfig: editingRequest.authConfig,
      sslVerification: editingRequest.sslVerification,
      groupId: editingRequest.groupId,
    }
    httpRequest.params = kvpToRecord(editingRequest.params)

    try {
      const { data, error } = await window.api.http.execute(httpRequest)
      if (error) {
        const errorResponse: HttpResponse = {
          status: 0,
          statusText: String(error),
          headers: {},
          body: String(error),
          duration: 0,
          size: 0,
        }
        set({ response: errorResponse, isLoading: false })
        return
      }
      set({ response: data as HttpResponse, isLoading: false })
    } catch (err) {
      const errorResponse: HttpResponse = {
        status: 0,
        statusText: String(err),
        headers: {},
        body: String(err),
        duration: 0,
        size: 0,
      }
      set({ response: errorResponse, isLoading: false })
    }
  },

  saveRequest: async () => {
    const { editingRequest } = get()
    if (!editingRequest) return

    // Clear dirty flag before serializing so the DB is written with is_dirty = 0
    const saved = { ...editingRequest, isDirty: false }
    const payload = serializeRequest(saved)
    const { error } = await window.api.requests.update({ id: editingRequest.id, ...payload })
    if (error) {
      console.error('Failed to save request:', error)
      return
    }
    set({ editingRequest: saved })
    useCollectionsStore.getState().syncRequest(saved)

    // For git-sourced collections, mark the request as uncommitted to git
    const { groups, collections, markDirty } = useCollectionsStore.getState()
    const group = groups.find((g) => g.id === editingRequest.groupId)
    const collection = group ? collections.find((c) => c.id === group.collectionId) : null
    if (['git', 'github', 'gitlab'].includes(collection?.source ?? '')) {
      markDirty(editingRequest.id)
    }
  },

  clearDirty: (requestId: string) => {
    const { editingRequest } = get()
    if (editingRequest?.id === requestId) {
      const cleared = { ...editingRequest, isDirty: false }
      set({ editingRequest: cleared })
      useCollectionsStore.getState().syncRequest(cleared)
    } else {
      // Update in collections store only
      const { requests } = useCollectionsStore.getState()
      const req = requests.find((r) => r.id === requestId)
      if (req) useCollectionsStore.getState().syncRequest({ ...req, isDirty: false })
    }
  },
}))
