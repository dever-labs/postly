import { create } from 'zustand'

interface ShortcutHelpState {
  open: boolean
  show: () => void
  hide: () => void
  toggle: () => void
}

export const useShortcutHelpStore = create<ShortcutHelpState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  toggle: () => set((s) => ({ open: !s.open })),
}))
