import { Plus, Trash2 } from 'lucide-react'
import React from 'react'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import {
  parseRules, serializeRules, SOURCE_LABELS, validateRule,
  type ExtractRule, type ExtractScope, type ExtractSource,
} from '../../../../../shared/extract'

interface ExtractTabProps {
  /** The raw JSON stored on the request. */
  value: string | undefined
  onChange: (value: string) => void
}

const PLACEHOLDERS: Record<ExtractSource, string> = {
  json: '$.data.token  or  /data/token',
  header: 'Header name',
  status: '',
  cookie: 'Cookie name',
  regex: 'token=(\\w+)',
}

const field = 'rounded-sm border border-th-border-strong bg-th-surface px-2 py-1.5 text-sm text-th-text-primary placeholder:text-th-text-subtle focus:border-th-border-strong focus:outline-hidden focus:ring-1 focus:ring-th-border-strong'

export const ExtractTab = React.memo(function ExtractTab({ value, onChange }: ExtractTabProps) {
  const rules = parseRules(value)
  const commit = (next: ExtractRule[]) => onChange(serializeRules(next))
  const update = (id: string, patch: Partial<ExtractRule>) => commit(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const add = () => commit([...rules, { id: crypto.randomUUID(), source: 'json', expression: '', variable: '', scope: 'environment', enabled: true }])

  return (
    <div data-testid="extract-tab" className="flex flex-col gap-2 p-3">
      <p className="text-xs text-th-text-faint">
        After each response, copy a value into a variable for later requests. Failures are listed in the Console and never fail the request.
        Collection scope saves with the collection; environment scope needs an active environment.
      </p>

      {rules.map((rule) => {
        const error = validateRule(rule)
        return (
          <div key={rule.id} data-testid="extract-rule" className={cn('flex flex-col gap-1', !rule.enabled && 'opacity-50')}>
            <div className="grid grid-cols-[24px_130px_1fr_20px_160px_130px_28px] items-center gap-1">
              <input
                type="checkbox"
                aria-label="Enabled"
                checked={rule.enabled}
                onChange={(e) => update(rule.id, { enabled: e.target.checked })}
                className="h-4 w-4 cursor-pointer accent-th-text-subtle"
              />
              <select
                aria-label="Source"
                data-testid="extract-source"
                value={rule.source}
                onChange={(e) => update(rule.id, { source: e.target.value as ExtractSource })}
                className={field}
              >
                {(Object.keys(SOURCE_LABELS) as ExtractSource[]).map((s) => <option key={s} value={s}>{SOURCE_LABELS[s]}</option>)}
              </select>
              <input
                aria-label="Expression"
                data-testid="extract-expression"
                value={rule.expression}
                disabled={rule.source === 'status'}
                placeholder={PLACEHOLDERS[rule.source]}
                onChange={(e) => update(rule.id, { expression: e.target.value })}
                className={cn(field, 'font-mono')}
              />
              <span className="text-center text-th-text-faint">→</span>
              <input
                aria-label="Variable name"
                data-testid="extract-variable"
                value={rule.variable}
                placeholder="variable"
                onChange={(e) => update(rule.id, { variable: e.target.value })}
                className={cn(field, 'font-mono')}
              />
              <select
                aria-label="Scope"
                data-testid="extract-scope"
                value={rule.scope}
                onChange={(e) => update(rule.id, { scope: e.target.value as ExtractScope })}
                className={field}
              >
                <option value="environment">Environment</option>
                <option value="collection">Collection</option>
              </select>
              <button
                aria-label="Remove rule"
                onClick={() => commit(rules.filter((r) => r.id !== rule.id))}
                className="flex h-8 w-7 items-center justify-center rounded-sm text-th-text-faint hover:bg-th-surface-raised hover:text-rose-400 focus:outline-hidden"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            {error && rule.enabled && (rule.expression || rule.variable) && (
              <p role="alert" data-testid="extract-error" className="pl-7 text-xs text-rose-400">{error}</p>
            )}
          </div>
        )
      })}

      <Button variant="ghost" size="sm" data-testid="extract-add" className="w-fit gap-1.5 text-th-text-muted" onClick={add}>
        <Plus className="h-3.5 w-3.5" /> Add rule
      </Button>
    </div>
  )
})
