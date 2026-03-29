import { useState, useCallback } from 'react'
import { useEnvironmentsStore } from '@/store/environments'
import { detectEnvPattern, completeEnvVar } from '@/lib/envAutocomplete'
import type { EnvVar } from '@/types'

export interface EnvAutocompleteState {
  show: boolean
  filtered: EnvVar[]
  selectedIndex: number
  setSelectedIndex: (i: number) => void
  close: () => void
  detect: (value: string, cursorPos: number) => void
  complete: (value: string, cursorPos: number, key: string) => { newValue: string; newCursorPos: number }
}

/** Detects `{{partial` at the cursor and provides matching env var suggestions. */
export function useEnvAutocomplete(): EnvAutocompleteState {
  const vars = useEnvironmentsStore((s) => s.vars)
  const activeEnv = useEnvironmentsStore((s) => s.activeEnv)

  const [show, setShow] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const activeVars = vars.filter((v) => v.envId === activeEnv?.id)
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
    show: show && filtered.length > 0 && !!activeEnv,
    filtered,
    selectedIndex,
    setSelectedIndex,
    close,
    detect,
    complete,
  }
}
