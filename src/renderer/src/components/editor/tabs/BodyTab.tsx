import Editor from '@monaco-editor/react'
import { Plus, Trash2 } from 'lucide-react'
import React from 'react'
import type { BodyType, KeyValuePair } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/utils'

interface BodyTabProps {
  bodyType: BodyType
  bodyContent: string
  onTypeChange: (t: BodyType) => void
  onContentChange: (c: string) => void
}

const BODY_TYPES: BodyType[] = ['none', 'json', 'form-data', 'raw']

export function BodyTab({ bodyType, bodyContent, onTypeChange, onContentChange }: BodyTabProps) {
  const [formPairs, setFormPairs] = React.useState<KeyValuePair[]>(() => {
    try { return JSON.parse(bodyContent) } catch { return [] }
  })

  const syncFormPairs = (pairs: KeyValuePair[]) => {
    setFormPairs(pairs)
    onContentChange(JSON.stringify(pairs))
  }

  const addFormRow = () => {
    syncFormPairs([...formPairs, { id: crypto.randomUUID(), key: '', value: '', enabled: true }])
  }

  const updateFormRow = (id: string, field: keyof KeyValuePair, value: unknown) => {
    syncFormPairs(formPairs.map((p) => (p.id === id ? { ...p, [field]: value } : p)))
  }

  const deleteFormRow = (id: string) => {
    syncFormPairs(formPairs.filter((p) => p.id !== id))
  }

  return (
    <div className="flex flex-col">
      {/* Type selector */}
      <div className="flex gap-0 border-b border-neutral-800">
        {BODY_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => onTypeChange(t)}
            className={cn(
              'px-3 py-1.5 text-xs transition-colors focus:outline-none',
              bodyType === t
                ? 'border-b-2 border-neutral-100 text-neutral-100'
                : 'text-neutral-500 hover:text-neutral-300'
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1">
        {bodyType === 'none' && (
          <div className="flex items-center justify-center py-8 text-sm text-neutral-600">No body</div>
        )}

        {(bodyType === 'json' || bodyType === 'raw') && (
          <Editor
            height="200px"
            language={bodyType === 'json' ? 'json' : 'plaintext'}
            theme="vs-dark"
            value={bodyContent}
            onChange={(v) => onContentChange(v ?? '')}
            onMount={(editor, monaco) => {
              if (bodyType === 'json') {
                editor.getAction('editor.action.formatDocument')?.run()
              }
            }}
            options={{
              minimap: { enabled: false },
              fontSize: 12,
              lineNumbers: 'off',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              padding: { top: 8 },
            }}
          />
        )}

        {bodyType === 'form-data' && (
          <div className="flex flex-col gap-1 p-3">
            {formPairs.map((pair) => (
              <div
                key={pair.id}
                className={cn(
                  'grid grid-cols-[24px_1fr_1fr_28px] items-center gap-1',
                  !pair.enabled && 'opacity-50'
                )}
              >
                <input
                  type="checkbox"
                  checked={pair.enabled}
                  onChange={(e) => updateFormRow(pair.id, 'enabled', e.target.checked)}
                  className="h-4 w-4 cursor-pointer accent-neutral-500"
                />
                <Input
                  value={pair.key}
                  onChange={(e) => updateFormRow(pair.id, 'key', e.target.value)}
                  placeholder="Key"
                />
                <Input
                  value={pair.value}
                  onChange={(e) => updateFormRow(pair.id, 'value', e.target.value)}
                  placeholder="Value"
                />
                <button
                  onClick={() => deleteFormRow(pair.id)}
                  className="flex h-8 w-7 items-center justify-center rounded text-neutral-600 hover:bg-neutral-800 hover:text-rose-400 focus:outline-none"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <Button variant="ghost" size="sm" className="mt-1 w-fit gap-1.5 text-neutral-400" onClick={addFormRow}>
              <Plus className="h-3.5 w-3.5" /> Add field
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
