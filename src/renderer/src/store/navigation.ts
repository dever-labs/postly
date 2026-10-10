import { create } from 'zustand'
import { useRequestsStore, isScratchId } from './requests'
import { useCollectionsStore } from './collections'
import { useUIStore } from './ui'

const MAX_ENTRIES = 50

interface NavigationState {
  stack: string[]
  index: number
  go: (delta: -1 | 1) => void
}

let navigating = false

const exists = (id: string): boolean => useCollectionsStore.getState().requests.some((r) => r.id === id)

export const useNavigationStore = create<NavigationState>((set, get) => ({
  stack: [],
  index: -1,

  go: (delta) => {
    const { stack, index } = get()
    // skip entries whose request has since been deleted
    // when the active request isn't the stack entry (e.g. a history request), Back returns to that entry
    const offTrack = useRequestsStore.getState().activeRequestId !== stack[index]
    let i = delta === -1 && offTrack ? index : index + delta
    while (i >= 0 && i < stack.length && !exists(stack[i])) i += delta
    if (i < 0 || i >= stack.length) return
    const request = useCollectionsStore.getState().requests.find((r) => r.id === stack[i])
    if (!request) return
    navigating = true
    try {
      useUIStore.getState().clearSelectedItem()
      useRequestsStore.getState().setActiveRequest(request)
    } finally {
      navigating = false
    }
    set({ index: i })
  },
}))

useRequestsStore.subscribe((state, prev) => {
  const id = state.activeRequestId
  if (navigating || !id || id === prev.activeRequestId || isScratchId(id)) return
  useNavigationStore.setState((s) => {
    const trimmed = s.stack.slice(0, s.index + 1)
    if (trimmed[trimmed.length - 1] === id) return s
    const stack = [...trimmed, id].slice(-MAX_ENTRIES)
    return { stack, index: stack.length - 1 }
  })
})
