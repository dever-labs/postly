import { useShortcut } from '@/hooks/useShortcuts'
import { createRequestInContext } from '@/lib/requestActions'
import { useNavigationStore } from '@/store/navigation'
import { useRequestsStore } from '@/store/requests'
import { useShortcutHelpStore } from '@/store/shortcutHelp'

const editorVisible = (): boolean => document.querySelector('[data-testid="url-input"]') !== null

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

  useShortcut('help', () => { useShortcutHelpStore.getState().toggle(); return true })
}
