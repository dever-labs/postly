import { create } from 'zustand'

export type Theme = 'dark' | 'light'

function applyThemeClass(theme: Theme) {
  if (theme === 'light') {
    document.documentElement.classList.add('light')
  } else {
    document.documentElement.classList.remove('light')
  }
}

const storedTheme = localStorage.getItem('postly-theme') as Theme | null
const initialTheme: Theme = storedTheme === 'light' ? 'light' : 'dark'

interface ToastItem {
  id: string
  message: string
  type: 'success' | 'error' | 'info'
}

export type GitPendingAction =
  | { type: 'push'; collectionId: string; title: string; subtitle?: string; onCancel?: () => void | Promise<void> }
  | { type: 'delete-collection'; collectionId: string; title: string; subtitle?: string; onCancel?: () => void | Promise<void> }

interface UIState {
  theme: Theme
  settingsOpen: boolean
  settingsTab: string
  sidebarTab: 'apis' | 'environments'
  selectedEnvId: string | null
  sidebarWidth: number
  editorHeight: number
  pendingGitAction: GitPendingAction | null
  deletingCollectionId: string | null
  toasts: ToastItem[]
  selectedItem: { type: 'collection' | 'group' | 'ai-collection' | 'ai-group' | 'ai-request' | 'add-integration' | 'edit-integration' | 'export-page' | 'import-page' | 'git-source'; id: string } | null
  toggleTheme: () => void
  setTheme: (theme: Theme) => void
  openSettings: (tab?: string) => void
  closeSettings: () => void
  setSidebarTab: (tab: 'apis' | 'environments') => void
  setSelectedEnvId: (id: string | null) => void
  setSidebarWidth: (w: number) => void
  setEditorHeight: (h: number) => void
  openGitAction: (action: GitPendingAction) => void
  closeGitAction: () => void
  openDeleteCollection: (collectionId: string) => void
  closeDeleteCollection: () => void
  addToast: (message: string, type: 'success' | 'error' | 'info') => void
  removeToast: (id: string) => void
  selectItem: (type: 'collection' | 'group' | 'ai-collection' | 'ai-group' | 'ai-request' | 'add-integration' | 'edit-integration' | 'export-page' | 'import-page' | 'git-source', id: string) => void
  clearSelectedItem: () => void
}

export const useUIStore = create<UIState>((set, get) => ({
  theme: initialTheme,
  settingsOpen: false,
  settingsTab: 'general',
  sidebarTab: 'apis',
  selectedEnvId: null,
  sidebarWidth: 280,
  editorHeight: 300,
  pendingGitAction: null,
  deletingCollectionId: null,
  toasts: [],
  selectedItem: null,

  toggleTheme: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark'
    localStorage.setItem('postly-theme', next)
    applyThemeClass(next)
    set({ theme: next })
  },

  setTheme: (theme: Theme) => {
    localStorage.setItem('postly-theme', theme)
    applyThemeClass(theme)
    set({ theme })
  },

  openSettings: (tab = 'general') => set({ settingsOpen: true, settingsTab: tab }),
  closeSettings: () => set({ settingsOpen: false }),

  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setSelectedEnvId: (id) => set({ selectedEnvId: id }),

  setSidebarWidth: (w: number) => set({ sidebarWidth: isNaN(w) ? 280 : w }),
  setEditorHeight: (h: number) => set({ editorHeight: isNaN(h) ? 300 : h }),

  openGitAction: (action: GitPendingAction) => set({ pendingGitAction: action }),
  closeGitAction: () => set({ pendingGitAction: null }),

  openDeleteCollection: (collectionId: string) => set({ deletingCollectionId: collectionId }),
  closeDeleteCollection: () => set({ deletingCollectionId: null }),

  addToast: (message: string, type: 'success' | 'error' | 'info') => {
    const id = Math.random().toString(36).slice(2)
    set((state) => ({ toasts: [...state.toasts, { id, message, type }] }))
  },

  removeToast: (id: string) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
  },

  selectItem: (type: 'collection' | 'group' | 'ai-collection' | 'ai-group' | 'ai-request' | 'add-integration' | 'edit-integration' | 'export-page' | 'import-page' | 'git-source', id: string) => set({ selectedItem: { type, id } }),
  clearSelectedItem: () => set({ selectedItem: null }),
}))
