import { useShortcut } from '@/hooks/useShortcuts'
import { createRequestInContext } from '@/lib/requestActions'
import { useNavigationStore } from '@/store/navigation'
import { useRequestsStore } from '@/store/requests'
import { useUIStore } from '@/store/ui'
import { useShortcutHelpStore } from '@/store/shortcutHelp'

/** True while the request editor (not an environment, collection or other page) is the visible view. */
const editorVisible = (): boolean => {
  const { sidebarTab, selectedItem } = useUIStore.getState()
  return sidebarTab !== 'environments' && selectedItem === null
}

/** Behaviour for the shortcuts that only touch stores. Save and the palette are attached by their own components. */
export function useAppShortcuts(): void {
  useShortcut('send', (e) => {
    const { editingRequest, isLoading, sendRequest } = useRequestsStore.getState()
    if (!editorVisible() || !editingRequest || (editingRequest.protocol !== 'http' && editingRequest.protocol !== 'graphql')) return false
    const target = e.target as HTMLElement | null
    // The URL bar flushes its debounced text before sending; let its own Enter handler do it
    if (target?.dataset.testid === 'url-input') return false
    if (isLoading) return true
    // Other fields debounce store writes by ~100 ms; wait so the latest text is sent
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) setTimeout(() => void sendRequest(), 150)
    else void sendRequest()
    return true
  })

  useShortcut('cancel', () => {
    const { isLoading, cancelRequest } = useRequestsStore.getState()
    if (!editorVisible() || !isLoading) return false
    cancelRequest()
    return true
  })

  useShortcut('new-request', () => { void createRequestInContext(); return true })

  useShortcut('focus-url', () => {
    const input = document.querySelector<HTMLInputElement>('[data-testid="url-input"]')
    if (!input) return false
    input.focus()
    input.select()
    return true
  })

  useShortcut('undo', () => {
    if (!editorVisible() || !useRequestsStore.getState().editingRequest) return false
    useRequestsStore.getState().undoRequest()
    return true
  })

  useShortcut('back', () => { useNavigationStore.getState().go(-1); return true })
  useShortcut('forward', () => { useNavigationStore.getState().go(1); return true })

  useShortcut('settings', () => { useUIStore.getState().openSettings(); return true })

  useShortcut('focus-search', () => {
    const ui = useUIStore.getState()
    if (ui.sidebarTab !== 'apis') ui.setSidebarTab('apis')
    // The search box may mount after the tab switch
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>('[data-testid="sidebar-search"]')
      input?.focus()
      input?.select()
    })
    return true
  })

  useShortcut('help', () => { useShortcutHelpStore.getState().toggle(); return true })
}
