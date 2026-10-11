import { useMemo } from 'react'
import { mergeScopedVars, rootCollectionId, type ScopedVar } from '@/lib/variableScopes'
import { useCollectionsStore } from '@/store/collections'
import { useEnvironmentsStore } from '@/store/environments'
import { useRequestsStore } from '@/store/requests'
import { useVariablesStore } from '@/store/variables'

/** Variables available to the open request, merged across scopes with built-ins. */
export function useScopedVars(): ScopedVar[] {
  const activeEnv = useEnvironmentsStore((s) => s.activeEnv)
  const envVars = useEnvironmentsStore((s) => s.vars)
  const globals = useVariablesStore((s) => s.globals)
  const collections = useVariablesStore((s) => s.collections)
  const folders = useCollectionsStore((s) => s.folders)
  const folderId = useRequestsStore((s) => s.editingRequest?.folderId)

  return useMemo(() => {
    const collectionId = rootCollectionId(folderId, folders)
    return mergeScopedVars({
      environment: envVars.filter((v) => v.envId === activeEnv?.id),
      collection: collectionId ? collections[collectionId] ?? [] : [],
      global: globals,
    })
  }, [activeEnv?.id, envVars, globals, collections, folders, folderId])
}
