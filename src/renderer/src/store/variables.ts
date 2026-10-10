import { create } from 'zustand'

export interface VariableRow {
  key: string
  value: string
  isSecret: boolean
}

interface VariablesState {
  globals: VariableRow[]
  /** Collection variables by collection (root folder) id. */
  collections: Record<string, VariableRow[]>
  load: () => Promise<void>
  save: (scope: 'global' | 'collection', ownerId: string, vars: VariableRow[]) => Promise<string | null>
}

export const useVariablesStore = create<VariablesState>((set, get) => ({
  globals: [],
  collections: {},

  load: async () => {
    const { data, error } = (await window.api.variables.list()) as { data?: { global: VariableRow[]; collections: Record<string, VariableRow[]> }; error?: string }
    if (error || !data) return
    set({ globals: data.global, collections: data.collections })
  },

  /** Returns an error message, or null when saved. */
  save: async (scope, ownerId, vars) => {
    const { error } = (await window.api.variables.set({ scope, ownerId, vars })) as { error?: string }
    if (error) return error
    await get().load()
    return null
  },
}))
