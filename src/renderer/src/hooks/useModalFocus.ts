import { useEffect, type RefObject } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
}

interface Options {
  /** Set false while the dialog is not rendered. */
  active?: boolean
  /** Called on Escape. Omit when the dialog already handles it. */
  onEscape?: () => void
}

/**
 * Makes a dialog behave as a modal for keyboard and screen reader users: focus moves into it
 * (unless something inside already took it), Tab and Shift+Tab stay inside, and focus returns
 * to the element that opened it when it closes.
 */
export function useModalFocus(ref: RefObject<HTMLElement | null>, { active = true, onEscape }: Options = {}) {
  useEffect(() => {
    if (!active) return
    const opener = document.activeElement as HTMLElement | null
    const root = ref.current
    if (root && !root.contains(document.activeElement)) (focusableWithin(root)[0] ?? root).focus()

    const onKey = (e: KeyboardEvent) => {
      const dialog = ref.current
      if (!dialog) return
      if (e.key === 'Escape' && onEscape) { e.preventDefault(); onEscape(); return }
      if (e.key !== 'Tab') return
      const items = focusableWithin(dialog)
      if (items.length === 0) { e.preventDefault(); dialog.focus(); return }
      const first = items[0]
      const last = items[items.length - 1]
      const current = document.activeElement
      if (!dialog.contains(current)) { e.preventDefault(); first.focus() }
      else if (e.shiftKey && current === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && current === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (opener && opener.isConnected) opener.focus()
    }
    // onEscape is read through the latest render by design: dialogs pass stable store actions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ref])
}
