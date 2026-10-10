import React, { useEffect, useState } from 'react'
import { VariableTable } from '@/components/editor/VariableTable'
import { Button } from '@/components/ui/Button'
import { useUIStore } from '@/store/ui'
import { useVariablesStore, type VariableRow } from '@/store/variables'
import { PRECEDENCE_HELP } from '../../../../shared/variables'

const same = (a: VariableRow[], b: VariableRow[]) => JSON.stringify(a) === JSON.stringify(b)
const NONE: VariableRow[] = []

interface Props {
  collectionId: string
  collectionName: string
  isGit: boolean
}

/** Variables shared by every request in a collection. They have their own Save so they work the same for local and git collections. */
export function CollectionVariables({ collectionId, collectionName, isGit }: Props) {
  const stored = useVariablesStore((s) => s.collections[collectionId]) ?? NONE
  const save = useVariablesStore((s) => s.save)
  const addToast = useUIStore((s) => s.addToast)
  const openGitAction = useUIStore((s) => s.openGitAction)
  const [rows, setRows] = useState<VariableRow[]>(stored)
  const [saving, setSaving] = useState(false)
  const dirty = !same(rows, stored)

  // Follow the stored values when switching collection or after a save, but never overwrite unsaved edits
  const storedKey = JSON.stringify(stored)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on content so a reload with identical values does not reset edits
  useEffect(() => { setRows(stored) }, [collectionId, storedKey])

  const commit = async () => {
    setSaving(true)
    const error = await save('collection', collectionId, rows)
    setSaving(false)
    if (error) { addToast(`Could not save variables: ${error}`, 'error'); return }
    if (isGit) openGitAction({ type: 'push', collectionId, title: `Updated variables in '${collectionName}'` })
    else addToast('Variables saved', 'success')
  }

  return (
    <div data-testid="collection-variables" className="flex flex-col gap-3">
      <p className="text-xs text-th-text-faint">
        Available to every request in this collection as <code>{'{{NAME}}'}</code>. {PRECEDENCE_HELP}
        {isGit && ' Values are committed with the collection, except secrets, which stay on this machine.'}
      </p>
      <VariableTable rows={rows} onChange={setRows} testId="collection-vars" />
      {dirty && (
        <div className="flex gap-2">
          <Button size="sm" data-testid="collection-vars-save" disabled={saving} onClick={() => void commit()}>{saving ? 'Saving…' : 'Save variables'}</Button>
          <Button size="sm" variant="ghost" onClick={() => setRows(stored)}>Discard</Button>
        </div>
      )}
    </div>
  )
}
