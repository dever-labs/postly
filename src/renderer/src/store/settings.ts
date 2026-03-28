import { create } from 'zustand'
import type {
  BackstageSettings,
  CollectionSource,
  GeneralSettings,
  GitHubSettings,
  GitLabSettings,
} from '../types'

interface SettingsState {
  general: GeneralSettings
  backstage: BackstageSettings
  github: GitHubSettings
  gitlab: GitLabSettings
  loaded: boolean
  /** Sources that have been configured and should appear in the sidebar. 'local' is always included. */
  configuredSources: CollectionSource[]
  load: () => Promise<void>
}

const DEFAULT_GENERAL: GeneralSettings = {
  theme: 'dark',
  defaultTimeout: 30000,
  followRedirects: true,
  sslVerification: true,
}
const DEFAULT_BACKSTAGE: BackstageSettings = { baseUrl: '', token: '', autoSync: false }
const DEFAULT_GITHUB: GitHubSettings = { token: '', orgs: [] }
const DEFAULT_GITLAB: GitLabSettings = { baseUrl: 'https://gitlab.com', token: '', groups: [] }

function deriveConfiguredSources(
  backstage: BackstageSettings,
  github: GitHubSettings,
  gitlab: GitLabSettings,
): CollectionSource[] {
  const sources: CollectionSource[] = ['local']
  if (backstage.baseUrl?.trim()) sources.push('backstage')
  if (github.token?.trim()) sources.push('github')
  if (gitlab.token?.trim()) sources.push('gitlab')
  return sources
}

export const useSettingsStore = create<SettingsState>((set) => ({
  general: DEFAULT_GENERAL,
  backstage: DEFAULT_BACKSTAGE,
  github: DEFAULT_GITHUB,
  gitlab: DEFAULT_GITLAB,
  loaded: false,
  configuredSources: ['local'],

  load: async () => {
    const { data, error } = await (window as any).api.settings.getAll()
    if (error) {
      console.error('Failed to load settings:', error)
      return
    }

    const backstage: BackstageSettings = { ...DEFAULT_BACKSTAGE, ...(data?.backstage ?? {}) }
    const github: GitHubSettings = { ...DEFAULT_GITHUB, ...(data?.github ?? {}) }
    const gitlab: GitLabSettings = { ...DEFAULT_GITLAB, ...(data?.gitlab ?? {}) }
    const general: GeneralSettings = { ...DEFAULT_GENERAL, ...(data?.general ?? {}) }

    set({
      general,
      backstage,
      github,
      gitlab,
      loaded: true,
      configuredSources: deriveConfiguredSources(backstage, github, gitlab),
    })
  },
}))
