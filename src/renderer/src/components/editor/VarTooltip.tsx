import React from 'react'
import { Globe } from 'lucide-react'
import { useEnvironmentsStore } from '@/store/environments'

/** Extracts all unique {{varName}} tokens from a string. */
function extractVars(value: string): string[] {
  const matches = value.matchAll(/\{\{([^}]+)\}\}/g)
  return [...new Set([...matches].map((m) => m[1].trim()))]
}

interface Props {
  value: string
}

/**
 * Rendered inside EnvInput's relative wrapper. Shows a popover below the
 * field when the field value contains {{variable}} tokens, listing each
 * variable's resolved value from the active environment.
 */
export function VarTooltip({ value }: Props) {
  const activeEnv = useEnvironmentsStore((s) => s.activeEnv)
  const vars = useEnvironmentsStore((s) => s.vars)

  const tokens = extractVars(value)
  if (tokens.length === 0) return null

  const activeVars = vars.filter((v) => v.envId === activeEnv?.id)
  const resolve = (key: string) => activeVars.find((v) => v.key === key)

  return (
    <div className="absolute left-0 top-full z-50 mt-1 min-w-[220px] max-w-xs rounded-md border border-th-border bg-th-surface shadow-lg">
      {/* Environment badge */}
      <div className="flex items-center gap-1.5 border-b border-th-border px-3 py-1.5">
        <Globe className="h-3 w-3 shrink-0 text-th-text-faint" />
        <span className="text-xs font-medium text-th-text-subtle">
          {activeEnv ? activeEnv.name : 'No environment selected'}
        </span>
      </div>

      {/* Variable rows */}
      <div className="px-3 py-1.5 flex flex-col gap-1">
        {tokens.map((token) => {
          const envVar = resolve(token)
          return (
            <div key={token} className="grid grid-cols-[auto_1fr] items-baseline gap-2 text-xs">
              <span className="font-mono text-amber-400">{`{{${token}}}`}</span>
              {envVar ? (
                envVar.isSecret ? (
                  <span className="text-th-text-faint tracking-widest">••••••••</span>
                ) : (
                  <span className="truncate text-th-text-primary">{envVar.value || <em className="text-th-text-faint">empty</em>}</span>
                )
              ) : (
                <span className="text-red-400 italic">undefined</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
