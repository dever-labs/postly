import { create } from 'zustand'
import type { HistoryEntryDetail, HistoryEntrySummary } from '../types'

interface HistoryState {
  entries: HistoryEntrySummary[]
  search: string
  loading: boolean
  load: () => Promise<void>
  setSearch: (search: string) => void
  open: (id: string) => Promise<HistoryEntryDetail | null>
  remove: (id: string) => Promise<void>
  clear: () => Promise<void>
}

let loadSeq = 0

export const useHistoryStore = create<HistoryState>((set, get) => ({
  entries: [],
  search: '',
  loading: false,

  load: async () => {
    const seq = ++loadSeq
    set({ loading: true })
    const res = (await window.api.history.list({ search: get().search })) as { data?: HistoryEntrySummary[] }
    // ignore stale responses from earlier searches
    if (seq !== loadSeq) return
    set({ entries: res.data ?? [], loading: false })
  },

  setSearch: (search) => set({ search }),

  open: async (id) => {
    const res = (await window.api.history.get({ id })) as { data?: HistoryEntryDetail | null }
    return res.data ?? null
  },

  remove: async (id) => {
    await window.api.history.delete({ id })
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }))
  },

  clear: async () => {
    await window.api.history.clear()
    set({ entries: [] })
  },
}))
