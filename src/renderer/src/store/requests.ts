import { create } from 'zustand'
import type { HttpRequest, HttpResponse, KeyValuePair, Request } from '../types'

interface RequestsState {
  activeRequestId: string | null
  editingRequest: Request | null
  response: HttpResponse | null
  isLoading: boolean
  setActiveRequest: (request: Request) => void
  updateField: (field: keyof Request, value: unknown) => void
  sendRequest: () => Promise<void>
  saveRequest: () => Promise<void>
}

const DIRTY_FIELDS = new Set<keyof Request>([
  'name', 'method', 'url', 'params', 'headers',
  'bodyType', 'bodyContent', 'authType', 'authConfig', 'description',
])

function kvpToRecord(pairs: KeyValuePair[]): Record<string, string> {
  return pairs
    .filter((p) => p.enabled && p.key.trim() !== '')
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.key] = p.value
      return acc
    }, {})
}

function serializeRequest(req: Request): Record<string, unknown> {
  return {
    ...req,
    params: JSON.stringify(req.params),
    headers: JSON.stringify(req.headers),
    authConfig: JSON.stringify(req.authConfig),
  }
}

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

    const httpRequest: HttpRequest = {
      method: editingRequest.method,
      url: editingRequest.url,
      headers: kvpToRecord(editingRequest.headers),
      body: editingRequest.bodyType !== 'none' ? editingRequest.bodyContent : undefined,
      bodyType: editingRequest.bodyType,
      authType: editingRequest.authType,
      authConfig: editingRequest.authConfig,
    }

    // Merge enabled params into URL is handled by main process; pass them via headers record workaround
    // or attach to request object for the main process to handle
    ;(httpRequest as any).params = kvpToRecord(editingRequest.params)

    try {
      const { data, error } = await (window as any).api.http.execute(httpRequest)
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

    const payload = serializeRequest(editingRequest)
    const { error } = await (window as any).api.requests.update({ id: editingRequest.id, ...payload })
    if (error) {
      console.error('Failed to save request:', error)
      return
    }
    set((state) => ({
      editingRequest: state.editingRequest ? { ...state.editingRequest, isDirty: false } : null,
    }))
  },
}))
