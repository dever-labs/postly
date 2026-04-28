import { create } from 'zustand'
import type { Integration } from '../types'

interface IntegrationsState {
  integrations: Integration[]
  load: () => Promise<void>
  connect: (id: string) => Promise<{ error?: string }>
  disconnect: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  update: (id: string, fields: Partial<Integration>) => Promise<void>
}

function normalize(raw: Record<string, unknown>): Integration {
  let connectedUser = null
  try { if (raw.connected_user) connectedUser = JSON.parse(raw.connected_user as string) } catch { /* empty */ }
  return {
    id: raw.id as string,
    type: raw.type as Integration['type'],
    name: raw.name as string,
    baseUrl: (raw.base_url ?? raw.baseUrl ?? '') as string,
    clientId: (raw.client_id ?? raw.clientId ?? '') as string,
    clientSecret: (raw.client_secret ?? raw.clientSecret ?? '') as string,
    token: (raw.token ?? '') as string,
    connectedUser,
    repo: (raw.repo ?? '') as string,
    branch: (raw.branch ?? 'main') as string,
    status: (raw.status ?? 'disconnected') as Integration['status'],
    errorMessage: (raw.error_message ?? raw.errorMessage ?? '') as string,
    sslVerification: (raw.ssl_verification ?? raw.sslVerification) !== 'disabled',
    createdAt: (raw.created_at ?? raw.createdAt ?? 0) as number,
    updatedAt: (raw.updated_at ?? raw.updatedAt ?? 0) as number,
  }
}

export const useIntegrationsStore = create<IntegrationsState>((set) => ({
  integrations: [],

  load: async () => {
    const { data, error } = await window.api.integrations.list()
    if (error) { console.error('Failed to load integrations:', error); return }
    set({ integrations: (data ?? []).map((r: Record<string, unknown>) => normalize(r)) })
  },

  connect: async (id: string) => {
    const { data, error } = await window.api.integrations.connect({ id })
    if (error) return { error }
    if (data) set((s) => ({ integrations: s.integrations.map((i) => i.id === id ? normalize(data as Record<string, unknown>) : i) }))
    return {}
  },

  disconnect: async (id: string) => {
    await window.api.integrations.disconnect({ id })
    set((s) => ({ integrations: s.integrations.map((i) => i.id === id ? { ...i, status: 'disconnected' as const, token: '', connectedUser: null } : i) }))
  },

  remove: async (id: string) => {
    await window.api.integrations.delete({ id })
    set((s) => ({ integrations: s.integrations.filter((i) => i.id !== id) }))
  },

  update: async (id: string, fields: Partial<Integration>) => {
    await window.api.integrations.update({ id, ...fields })
    set((s) => ({ integrations: s.integrations.map((i) => i.id === id ? { ...i, ...fields } : i) }))
  },
}))
