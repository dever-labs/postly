import { create } from 'zustand'
import type { HttpRequest, HttpResponse, Request } from '../types'
import { kvpToRecord, serializeRequest } from '@/lib/normalizers'
import { useCollectionsStore } from './collections'

interface RequestsState {
  activeRequestId: string | null
  editingRequest: Request | null
  savedRequest: Request | null
  response: HttpResponse | null
  isLoading: boolean
  setActiveRequest: (request: Request) => void
  clearActiveRequest: () => void
  updateField: (field: keyof Request, value: unknown) => void
  undoRequest: () => void
  sendRequest: () => Promise<void>
  saveRequest: () => Promise<void>
  discardDraft: () => Promise<void>
  clearDirty: (requestId: string) => void
}

const DIRTY_FIELDS = new Set<keyof Request>([
  'name', 'method', 'url', 'params', 'headers',
  'bodyType', 'bodyContent', 'authType', 'authConfig', 'description',
  'sslVerification', 'protocol', 'protocolConfig',
])

const MAX_UNDO_STEPS = 50

let draftSaveTimer: ReturnType<typeof setTimeout> | null = null
let pendingDraftRequest: Request | null = null

function upsertDraftNow(request: Request): void {
  const s = serializeRequest(request)
  window.api.drafts.request.upsert({
    requestId: request.id,
    method: s.method as string | undefined,
    url: s.url as string | undefined,
    params: typeof s.params === 'string' ? s.params : JSON.stringify(s.params),
    headers: typeof s.headers === 'string' ? s.headers : JSON.stringify(s.headers),
    bodyType: s.bodyType as string | undefined,
    bodyContent: s.bodyContent as string | undefined,
    authType: s.authType as string | undefined,
    authConfig: typeof s.authConfig === 'string' ? s.authConfig : JSON.stringify(s.authConfig),
    sslVerification: s.sslVerification as string | undefined,
    protocol: s.protocol as string | undefined,
    protocolConfig: typeof s.protocolConfig === 'string' ? s.protocolConfig : JSON.stringify(s.protocolConfig),
  })
}

function scheduleDraftSave(request: Request): void {
  if (draftSaveTimer) clearTimeout(draftSaveTimer)
  pendingDraftRequest = request
  draftSaveTimer = setTimeout(() => {
    draftSaveTimer = null
    if (pendingDraftRequest) { upsertDraftNow(pendingDraftRequest); pendingDraftRequest = null }
  }, 500)
}

function flushPendingDraftSave(): void {
  if (draftSaveTimer) { clearTimeout(draftSaveTimer); draftSaveTimer = null }
  if (pendingDraftRequest) { upsertDraftNow(pendingDraftRequest); pendingDraftRequest = null }
}


// Undo stack lives outside the store so it does not trigger re-renders
const undoStack: Request[] = []
let lastUndoField: keyof Request | null = null
let undoPushTimer: ReturnType<typeof setTimeout> | null = null

function pushUndo(snapshot: Request): void {
  if (undoStack.length >= MAX_UNDO_STEPS) undoStack.shift()
  undoStack.push(JSON.parse(JSON.stringify(snapshot)) as Request)
}

function clearUndo(): void {
  undoStack.length = 0
  lastUndoField = null
  if (undoPushTimer) { clearTimeout(undoPushTimer); undoPushTimer = null }
}

function isEqualToSaved(a: Request, b: Request): boolean {
  for (const field of DIRTY_FIELDS) {
    const av = a[field]
    const bv = b[field]
    if (JSON.stringify(av) !== JSON.stringify(bv)) return false
  }
  return true
}
export const useRequestsStore = create<RequestsState>((set, get) => ({
  activeRequestId: null,
  editingRequest: null,
  savedRequest: null,
  response: null,
  isLoading: false,

  setActiveRequest: (request: Request) => {
    // Flush any pending draft save for the outgoing request before switching
    flushPendingDraftSave()
    clearUndo()
    const saved: Request = JSON.parse(JSON.stringify(request)) as Request
    const base: Request = JSON.parse(JSON.stringify(request)) as Request
    // Set state immediately so the UI responds without waiting for IPC
    set({ activeRequestId: request.id, editingRequest: base, savedRequest: saved, response: null })
    // Load any persisted draft in the background; discard result if user already moved on
    void window.api.drafts.request.get({ requestId: request.id })
      .then((result) => {
        const { data } = result as { data: Record<string, unknown> | null }
        if (!data || get().activeRequestId !== request.id) return
        const draft: Request = JSON.parse(JSON.stringify(base)) as Request
        if (data.method != null) draft.method = data.method as Request['method']
        if (data.url != null) draft.url = data.url as string
        if (data.params != null) draft.params = typeof data.params === 'string' ? JSON.parse(data.params as string) : data.params as Request['params']
        if (data.headers != null) draft.headers = typeof data.headers === 'string' ? JSON.parse(data.headers as string) : data.headers as Request['headers']
        if (data.body_type != null) draft.bodyType = data.body_type as Request['bodyType']
        if (data.body_content != null) draft.bodyContent = data.body_content as string
        if (data.auth_type != null) draft.authType = data.auth_type as Request['authType']
        if (data.auth_config != null) draft.authConfig = typeof data.auth_config === 'string' ? JSON.parse(data.auth_config as string) : data.auth_config as Record<string, string>
        if (data.ssl_verification != null) draft.sslVerification = data.ssl_verification as Request['sslVerification']
        if (data.protocol != null) draft.protocol = data.protocol as Request['protocol']
        if (data.protocol_config != null) draft.protocolConfig = typeof data.protocol_config === 'string' ? JSON.parse(data.protocol_config as string) : data.protocol_config as Record<string, string>
        draft.isDirty = true
        if (get().activeRequestId !== request.id) return
        set({ editingRequest: draft })
        useCollectionsStore.getState().syncRequest({ ...request, isDirty: true })
      })
      .catch(() => {
        // Draft load failure is non-fatal — fall back to saved request already set above
      })
  },

  clearActiveRequest: () => {
    flushPendingDraftSave()
    clearUndo()
    set({ activeRequestId: null, editingRequest: null, savedRequest: null, response: null })
  },

  updateField: (field: keyof Request, value: unknown) => {
    set((state) => {
      if (!state.editingRequest) return state

      if (DIRTY_FIELDS.has(field)) {
        // Push undo snapshot when: switching to a different field, OR 1s since last push
        if (field !== lastUndoField) {
          if (undoPushTimer) { clearTimeout(undoPushTimer); undoPushTimer = null }
          pushUndo(state.editingRequest)
          lastUndoField = field
        } else {
          // Same field — restart the 1s debounce timer; capture latest state when it fires
          if (undoPushTimer) { clearTimeout(undoPushTimer); undoPushTimer = null }
          undoPushTimer = setTimeout(() => {
            undoPushTimer = null
            const current = get().editingRequest
            if (current) pushUndo(current)
          }, 1000)
        }
      }

      const updated: Request = { ...state.editingRequest, [field]: value }
      if (DIRTY_FIELDS.has(field)) {
        const { savedRequest } = state
        // If the change restores us to the saved state (e.g. native Ctrl+Z in an input),
        // clear dirty and delete the draft rather than marking it dirty again.
        if (savedRequest && isEqualToSaved(updated, savedRequest)) {
          updated.isDirty = false
          if (draftSaveTimer) { clearTimeout(draftSaveTimer); draftSaveTimer = null }
          pendingDraftRequest = null
          window.api.drafts.request.delete({ requestId: updated.id })
          useCollectionsStore.getState().syncRequest({ ...updated, isDirty: false })
        } else {
          updated.isDirty = true
          if (!state.editingRequest.isDirty) {
            useCollectionsStore.getState().syncRequest({ ...state.editingRequest, isDirty: true })
          }
          scheduleDraftSave(updated)
        }
      }
      return { editingRequest: updated }
    })
  },

  undoRequest: () => {
    const { savedRequest } = get()
    const previous = undoStack.pop()
    if (!previous) return

    if (undoPushTimer) { clearTimeout(undoPushTimer); undoPushTimer = null }
    lastUndoField = null

    // Dirty only if the restored state differs from the originally saved (pre-draft) state
    const isDirty = savedRequest ? !isEqualToSaved(previous, savedRequest) : (undoStack.length > 0 || previous.isDirty)
    const restored: Request = { ...previous, isDirty }
    set({ editingRequest: restored })
    useCollectionsStore.getState().syncRequest(restored)

    if (isDirty) {
      scheduleDraftSave(restored)
    } else {
      // Back to saved state — cancel any pending draft save and delete the draft
      if (draftSaveTimer) { clearTimeout(draftSaveTimer); draftSaveTimer = null }
      pendingDraftRequest = null
      window.api.drafts.request.delete({ requestId: restored.id })
    }
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
      const { data, error, logs } = await window.api.http.execute(httpRequest) as { data?: HttpResponse; error?: string; logs?: HttpResponse['logs'] }
      if (error) {
        const errorResponse: HttpResponse = {
          status: 0,
          statusText: String(error),
          headers: {},
          body: String(error),
          duration: 0,
          size: 0,
          logs,
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

    // Cancel any pending draft save and clear undo history
    if (draftSaveTimer) { clearTimeout(draftSaveTimer); draftSaveTimer = null }
    clearUndo()

    // Clear dirty flag before serializing so the DB is written with is_dirty = 0
    const saved = { ...editingRequest, isDirty: false }
    const payload = serializeRequest(saved)
    const { error } = await window.api.requests.update({ id: editingRequest.id, ...payload })
    if (error) {
      console.error('Failed to save request:', error)
      return
    }
    // Delete the draft now that it has been promoted to long-term storage
    await window.api.drafts.request.delete({ requestId: editingRequest.id })

    set({ editingRequest: saved, savedRequest: JSON.parse(JSON.stringify(saved)) as Request })
    useCollectionsStore.getState().syncRequest(saved)

    // For git-sourced collections, mark the request as uncommitted to git
    const { groups, collections, markDirty } = useCollectionsStore.getState()
    const group = groups.find((g) => g.id === editingRequest.groupId)
    const collection = group ? collections.find((c) => c.id === group.collectionId) : null
    if (['git', 'github', 'gitlab'].includes(collection?.source ?? '')) {
      markDirty(editingRequest.id)
    }
  },

  discardDraft: async () => {
    const { editingRequest } = get()
    if (!editingRequest) return

    if (draftSaveTimer) { clearTimeout(draftSaveTimer); draftSaveTimer = null }
    clearUndo()
    await window.api.drafts.request.delete({ requestId: editingRequest.id })

    // Reload the saved request from the DB
    const { data } = await window.api.requests.get({ id: editingRequest.id }) as { data: Record<string, unknown> | null }
    if (!data) return

    // Normalise snake_case DB row to camelCase Request
    const saved: Request = {
      id: data.id as string,
      groupId: data.group_id as string,
      name: data.name as string,
      protocol: (data.protocol as Request['protocol']) ?? 'http',
      method: data.method as Request['method'],
      url: data.url as string,
      params: typeof data.params === 'string' ? JSON.parse(data.params as string) : (data.params as Request['params']) ?? [],
      headers: typeof data.headers === 'string' ? JSON.parse(data.headers as string) : (data.headers as Request['headers']) ?? [],
      bodyType: (data.body_type as Request['bodyType']) ?? 'none',
      bodyContent: (data.body_content as string) ?? '',
      authType: (data.auth_type as Request['authType']) ?? 'none',
      authConfig: typeof data.auth_config === 'string' ? JSON.parse(data.auth_config as string) : (data.auth_config as Record<string, string>) ?? {},
      protocolConfig: typeof data.protocol_config === 'string' ? JSON.parse(data.protocol_config as string) : (data.protocol_config as Record<string, string>) ?? {},
      sslVerification: (data.ssl_verification as Request['sslVerification']) ?? 'inherit',
      description: data.description as string | undefined,
      scmPath: data.scm_path as string | undefined,
      scmSha: data.scm_sha as string | undefined,
      isDirty: false,
      sortOrder: (data.sort_order as number) ?? 0,
    }
    set({ editingRequest: saved, savedRequest: JSON.parse(JSON.stringify(saved)) as Request })
    useCollectionsStore.getState().syncRequest(saved)
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
