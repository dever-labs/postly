import React, { useEffect, useRef, useState } from 'react'
import { VariableTable } from '@/components/editor/VariableTable'
import { useUIStore } from '@/store/ui'
import { useVariablesStore, type VariableRow } from '@/store/variables'
import { DYNAMIC_VARIABLES, PRECEDENCE_HELP } from '../../../../../shared/variables'

export function VariablesSettings() {
  const globals = useVariablesStore((s) => s.globals)
  const save = useVariablesStore((s) => s.save)
  const addToast = useUIStore((s) => s.addToast)
  const [rows, setRows] = useState<VariableRow[]>(globals)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loaded = useRef(false)

  // Pick up the stored values once they arrive; after that the form owns its own rows
  useEffect(() => {
    if (!loaded.current && globals.length > 0) { loaded.current = true; setRows(globals) }
  }, [globals])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const change = (next: VariableRow[]) => {
    loaded.current = true
    setRows(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      const error = await save('global', '', next)
      if (error) addToast(`Could not save variables: ${error}`, 'error')
    }, 500)
  }

  return (
    <div className="flex flex-col gap-5" data-testid="variables-settings">
      <h3 className="text-sm font-semibold text-th-text-primary">Global variables</h3>
      <p className="text-xs text-th-text-subtle">Available in every request as <code>{'{{NAME}}'}</code>. {PRECEDENCE_HELP}</p>
      <VariableTable rows={rows} onChange={change} testId="global-vars" />

      <div>
        <div className="mb-2 text-xs font-medium text-th-text-muted">Built-in variables</div>
        <ul className="flex flex-col gap-1 text-xs text-th-text-subtle">
          {DYNAMIC_VARIABLES.map((d) => (
            <li key={d.name}><code className="text-amber-400">{`{{${d.name}}}`}</code> — {d.description}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
