import { useMemo } from 'react'
import { useCollectionsStore } from '@/store/collections'
import { useSettingsStore } from '@/store/settings'
import { ancestorLayers, resolveInherited, type InheritedNetwork } from '@/lib/networkSettings'

/** The timeout / redirect values a level inherits, given the folder it sits in (undefined for a collection). */
export function useInheritedNetwork(parentFolderId: string | undefined): InheritedNetwork {
  const folders = useCollectionsStore((s) => s.folders)
  const general = useSettingsStore((s) => s.general)
  return useMemo(
    () => resolveInherited(ancestorLayers(folders, parentFolderId), { timeout: general.defaultTimeout, followRedirects: general.followRedirects }),
    [folders, parentFolderId, general.defaultTimeout, general.followRedirects]
  )
}
