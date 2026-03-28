import { create } from 'zustand'
import type { EnvVar, Environment } from '../types'

interface EnvironmentsState {
  environments: Environment[]
  activeEnv: Environment | null
  vars: EnvVar[]
  load: () => Promise<void>
  createEnvironment: (name: string) => Promise<void>
  deleteEnvironment: (id: string) => Promise<void>
  setActive: (id: string) => Promise<void>
  upsertVar: (envId: string, key: string, value: string, isSecret?: boolean, id?: string) => Promise<void>
  deleteVar: (id: string) => Promise<void>
}

function normalizeEnvironment(raw: Record<string, unknown>): Environment {
  return {
    id: raw.id as string,
    name: raw.name as string,
    isActive: Boolean(raw.isActive ?? raw.is_active ?? false),
  }
}

function normalizeEnvVar(raw: Record<string, unknown>): EnvVar {
  return {
    id: raw.id as string,
    envId: (raw.envId ?? raw.env_id) as string,
    key: raw.key as string,
    value: raw.value as string,
    isSecret: Boolean(raw.isSecret ?? raw.is_secret ?? false),
  }
}

export const useEnvironmentsStore = create<EnvironmentsState>((set) => ({
  environments: [],
  activeEnv: null,
  vars: [],

  load: async () => {
    const api = (window as any).api
    const { data, error } = await api.environments.list()
    if (error) {
      console.error('Failed to load environments:', error)
      return
    }

    const rawEnvs: Record<string, unknown>[] = data?.environments ?? data ?? []
    const rawVars: Record<string, unknown>[] = data?.vars ?? []

    const environments = rawEnvs.map(normalizeEnvironment)
    const activeEnv = environments.find((e) => e.isActive) ?? null
    const vars = rawVars.map(normalizeEnvVar)

    set({ environments, activeEnv, vars })
  },

  createEnvironment: async (name: string) => {
    const api = (window as any).api
    const { data, error } = await api.environments.create({ name })
    if (error) {
      console.error('Failed to create environment:', error)
      return
    }
    const env = normalizeEnvironment(data as Record<string, unknown>)
    set((state) => ({ environments: [...state.environments, env] }))
  },

  deleteEnvironment: async (id: string) => {
    const api = (window as any).api
    const { error } = await api.environments.delete({ id })
    if (error) {
      console.error('Failed to delete environment:', error)
      return
    }
    set((state) => {
      const environments = state.environments.filter((e) => e.id !== id)
      const activeEnv = state.activeEnv?.id === id ? null : state.activeEnv
      const vars = state.vars.filter((v) => v.envId !== id)
      return { environments, activeEnv, vars }
    })
  },

  setActive: async (id: string) => {
    const api = (window as any).api
    const { error } = await api.environments.setActive({ id })
    if (error) {
      console.error('Failed to set active environment:', error)
      return
    }
    set((state) => {
      const environments = state.environments.map((e) => ({ ...e, isActive: e.id === id }))
      const activeEnv = environments.find((e) => e.isActive) ?? null
      return { environments, activeEnv }
    })
  },

  upsertVar: async (envId: string, key: string, value: string, isSecret = false, id?: string) => {
    const api = (window as any).api
    const { data, error } = await api.environments.vars.upsert({ envId, key, value, isSecret, id })
    if (error) {
      console.error('Failed to upsert env var:', error)
      return
    }
    const upserted = normalizeEnvVar(data as Record<string, unknown>)
    set((state) => {
      const exists = state.vars.some((v) => v.id === upserted.id)
      const vars = exists
        ? state.vars.map((v) => (v.id === upserted.id ? upserted : v))
        : [...state.vars, upserted]
      return { vars }
    })
  },

  deleteVar: async (id: string) => {
    const api = (window as any).api
    const { error } = await api.environments.vars.delete({ id })
    if (error) {
      console.error('Failed to delete env var:', error)
      return
    }
    set((state) => ({ vars: state.vars.filter((v) => v.id !== id) }))
  },
}))
