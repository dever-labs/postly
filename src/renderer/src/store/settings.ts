import { create } from 'zustand'
import type {
  AiSettings,
  BackstageSettings,
  GeneralSettings,
  GitHubSettings,
  GitLabSettings,
} from '../types'

interface SettingsState {
  general: GeneralSettings
  backstage: BackstageSettings
  github: GitHubSettings
  gitlab: GitLabSettings
  ai: AiSettings
  loaded: boolean
  load: () => Promise<void>
  save: (key: string, value: unknown) => Promise<void>
}

const DEFAULT_GENERAL: GeneralSettings = {
  theme: 'dark',
  defaultTimeout: 30000,
  followRedirects: true,
  sslVerification: true,
}
const DEFAULT_BACKSTAGE: BackstageSettings = { baseUrl: '', token: '', autoSync: false, authProvider: 'token' }
const DEFAULT_GITHUB: GitHubSettings = { baseUrl: 'https://github.com', clientId: '', clientSecret: '', token: '', repo: '', orgs: [] }
const DEFAULT_GITLAB: GitLabSettings = { baseUrl: 'https://gitlab.com', clientId: '', token: '', repo: '', groups: [] }
const DEFAULT_AI: AiSettings = { provider: 'openai', apiKey: '', model: '' }

export const useSettingsStore = create<SettingsState>((set) => ({
  general: DEFAULT_GENERAL,
  backstage: DEFAULT_BACKSTAGE,
  github: DEFAULT_GITHUB,
  gitlab: DEFAULT_GITLAB,
  ai: DEFAULT_AI,
  loaded: false,

  load: async () => {
    const { data, error } = await window.api.settings.getAll()
    if (error) {
      console.error('Failed to load settings:', error)
      return
    }

    const backstage: BackstageSettings = { ...DEFAULT_BACKSTAGE, ...(data?.backstage ?? {}) }
    const github: GitHubSettings = { ...DEFAULT_GITHUB, ...(data?.github ?? {}) }
    const gitlab: GitLabSettings = { ...DEFAULT_GITLAB, ...(data?.gitlab ?? {}) }
    const general: GeneralSettings = { ...DEFAULT_GENERAL, ...(data?.general ?? {}) }
    const ai: AiSettings = { ...DEFAULT_AI, ...(data?.ai ?? {}) }

    set({
      general,
      backstage,
      github,
      gitlab,
      ai,
      loaded: true,
    })
  },

  save: async (key: string, value: unknown) => {
    await window.api.settings.set({ key, value })
    set((state) => ({ ...state, [key]: value }))
  },
}))
