import { useState, useCallback } from 'react'
import { useEnvironmentsStore } from '@/store/environments'
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
    const beforeCursor = value.slice(0, cursorPos)
    const match = beforeCursor.match(/\{\{([^}]*)$/)
    if (match) {
      setSearch(match[1])
      setShow(true)
      setSelectedIndex(0)
    } else {
      setShow(false)
      setSearch('')
    }
  }, [])

  const complete = useCallback(
    (value: string, cursorPos: number, key: string) => {
      const beforeCursor = value.slice(0, cursorPos)
      const openBrace = beforeCursor.lastIndexOf('{{')
      if (openBrace === -1) return { newValue: value, newCursorPos: cursorPos }

      const afterCursorRaw = value.slice(cursorPos)
      // Only consume trailing word chars if they are immediately closed by }}.
      // This handles editing inside an existing {{key}} without eating unrelated text.
      const trailingClose = afterCursorRaw.match(/^(\w*)(\}\})/)
      const afterCursor = trailingClose
        ? afterCursorRaw.slice(trailingClose[0].length)
        : afterCursorRaw

      const newValue = value.slice(0, openBrace) + `{{${key}}}` + afterCursor
      const newCursorPos = openBrace + key.length + 4
      setShow(false)
      setSearch('')
      return { newValue, newCursorPos }
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
