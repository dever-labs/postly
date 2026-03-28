import { create } from 'zustand'

interface ToastItem {
  id: string
  message: string
  type: 'success' | 'error' | 'info'
}

interface UIState {
  settingsOpen: boolean
  settingsTab: string
  sidebarTab: 'apis' | 'environments'
  selectedEnvId: string | null
  sidebarWidth: number
  editorHeight: number
  activeCommitRequestId: string | null
  toasts: ToastItem[]
  openSettings: (tab?: string) => void
  closeSettings: () => void
  setSidebarTab: (tab: 'apis' | 'environments') => void
  setSelectedEnvId: (id: string | null) => void
  setSidebarWidth: (w: number) => void
  setEditorHeight: (h: number) => void
  openCommitPanel: (requestId: string) => void
  closeCommitPanel: () => void
  addToast: (message: string, type: 'success' | 'error' | 'info') => void
  removeToast: (id: string) => void
}

export const useUIStore = create<UIState>((set) => ({
  settingsOpen: false,
  settingsTab: 'general',
  sidebarTab: 'apis',
  selectedEnvId: null,
  sidebarWidth: 280,
  editorHeight: 300,
  activeCommitRequestId: null,
  toasts: [],

  openSettings: (tab = 'general') => set({ settingsOpen: true, settingsTab: tab }),
  closeSettings: () => set({ settingsOpen: false }),

  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setSelectedEnvId: (id) => set({ selectedEnvId: id }),

  setSidebarWidth: (w: number) => set({ sidebarWidth: w }),
  setEditorHeight: (h: number) => set({ editorHeight: h }),

  openCommitPanel: (requestId: string) => set({ activeCommitRequestId: requestId }),
  closeCommitPanel: () => set({ activeCommitRequestId: null }),

  addToast: (message: string, type: 'success' | 'error' | 'info') => {
    const id = Math.random().toString(36).slice(2)
    set((state) => ({ toasts: [...state.toasts, { id, message, type }] }))
  },

  removeToast: (id: string) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
  },
}))
