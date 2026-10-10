import { useState, useCallback } from 'react'
import { useScopedVars } from '@/hooks/useScopedVars'
import type { ScopedVar } from '@/lib/variableScopes'
import { detectEnvPattern, completeEnvVar } from '@/lib/envAutocomplete'

export interface EnvAutocompleteState {
  show: boolean
  filtered: ScopedVar[]
  selectedIndex: number
  setSelectedIndex: (i: number) => void
  close: () => void
  detect: (value: string, cursorPos: number) => void
  complete: (value: string, cursorPos: number, key: string) => { newValue: string; newCursorPos: number }
}

/** Detects `{{partial` at the cursor and provides matching variable suggestions from every scope. */
export function useEnvAutocomplete(): EnvAutocompleteState {
  const activeVars = useScopedVars()

  const [show, setShow] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const filtered = activeVars.filter(
    (v) => !search || v.key.toLowerCase().includes(search.toLowerCase())
  )

  const detect = useCallback((value: string, cursorPos: number) => {
    const partial = detectEnvPattern(value, cursorPos)
    if (partial !== null) {
      setSearch(partial)
      setShow(true)
      setSelectedIndex(0)
    } else {
      setShow(false)
      setSearch('')
    }
  }, [])

  const complete = useCallback(
    (value: string, cursorPos: number, key: string) => {
      const result = completeEnvVar(value, cursorPos, key)
      setShow(false)
      setSearch('')
      return result
    },
    []
  )

  const close = useCallback(() => { setShow(false); setSearch('') }, [])

  return {
    show: show && filtered.length > 0,
    filtered,
    selectedIndex,
    setSelectedIndex,
    close,
    detect,
    complete,
  }
}
