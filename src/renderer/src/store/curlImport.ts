import { create } from 'zustand'

interface CurlImportState {
  open: boolean
  show: () => void
  hide: () => void
}

export const useCurlImportStore = create<CurlImportState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}))
