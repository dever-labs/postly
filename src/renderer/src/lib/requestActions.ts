import type { Request } from '@/types'
import { useCollectionsStore } from '@/store/collections'
import { useRequestsStore, isScratchId } from '@/store/requests'
import { useUIStore } from '@/store/ui'

/** Creates a request next to the one being edited (or in the first collection) and opens it. */
export async function createRequestInContext(): Promise<Request | null> {
  const ui = useUIStore.getState()
  const { folders, requests, addRequestToFolder } = useCollectionsStore.getState()
  const active = useRequestsStore.getState().editingRequest
  const selected = ui.selectedItem
  const openFolder = selected && (selected.type === 'group' || selected.type === 'collection') && folders.some((f) => f.id === selected.id) ? selected.id : null
  const activeFolder = !selected && active && !isScratchId(active.id) ? active.folderId : null
  const target = openFolder || activeFolder || folders.find((f) => !f.parentId)?.id
  if (!target) { ui.addToast('Create a collection first', 'info'); return null }
  const before = requests.length
  await addRequestToFolder(target)
  const created = useCollectionsStore.getState().requests
  if (created.length > before) {
    ui.setSidebarTab('apis')
    ui.clearSelectedItem()
    const request = created[created.length - 1]
    useRequestsStore.getState().setActiveRequest(request)
    return request
  }
  return null
}
