import { create } from 'zustand'
import { useRequestsStore, isScratchId } from './requests'

export const MAX_RECENT = 8
const PINNED_KEY = 'postly-pinned-requests'

function loadPinned(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PINNED_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
  } catch { return [] }
}

interface WorkingSetState {
  /** Most recently opened first. Session-only. */
  recent: string[]
  pinned: string[]
  touch: (id: string) => void
  dismiss: (id: string) => void
  togglePin: (id: string) => void
}

export const useWorkingSetStore = create<WorkingSetState>((set, get) => ({
  recent: [],
  pinned: loadPinned(),

  touch: (id) => set((s) => ({ recent: [id, ...s.recent.filter((r) => r !== id)].slice(0, MAX_RECENT) })),
  dismiss: (id) => set((s) => ({ recent: s.recent.filter((r) => r !== id) })),

  togglePin: (id) => {
    const pinned = get().pinned.includes(id) ? get().pinned.filter((p) => p !== id) : [...get().pinned, id]
    localStorage.setItem(PINNED_KEY, JSON.stringify(pinned))
    set({ pinned })
  },
}))

let touchSuppressed = false

/** Run `fn` without reordering the recent list, so stepping through the set doesn't shuffle it under the user. */
export function withoutTouch(fn: () => void): void {
  touchSuppressed = true
  try { fn() } finally { touchSuppressed = false }
}

useRequestsStore.subscribe((state, prev) => {
  const id = state.activeRequestId
  if (!touchSuppressed && id && id !== prev.activeRequestId && !isScratchId(id)) useWorkingSetStore.getState().touch(id)
})

/** Ids to show, in a stable order: pinned, then unsaved, then recent. Each request appears once. */
export function buildWorkingSet(pinned: string[], dirty: string[], recent: string[], exists: (id: string) => boolean): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of [...pinned, ...dirty, ...recent]) {
    if (seen.has(id) || !exists(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** The id `delta` steps from the active one, wrapping around. With no active match, the first (or last) item. */
export function stepWorkingSet(ids: string[], activeId: string | null, delta: 1 | -1): string | null {
  if (ids.length === 0) return null
  const i = activeId ? ids.indexOf(activeId) : -1
  if (i === -1) return delta === 1 ? ids[0] : ids[ids.length - 1]
  return ids[(i + delta + ids.length) % ids.length]
}
