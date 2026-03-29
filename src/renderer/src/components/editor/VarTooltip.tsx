import React from 'react'
import { Globe } from 'lucide-react'
import { useEnvironmentsStore } from '@/store/environments'

interface Props {
  /** The variable key, e.g. "baseUrl" for {{baseUrl}} */
  varKey: string
  /** Left offset in pixels from the wrapper div — used to anchor the tooltip under the token */
  x: number
}

/**
 * Small popover shown when hovering a {{varKey}} token in an EnvInput.
 * Displays the resolved value and the active environment name.
 */
export function VarTooltip({ varKey, x }: Props) {
  const activeEnv = useEnvironmentsStore((s) => s.activeEnv)
  const vars = useEnvironmentsStore((s) => s.vars)
  const envVar = vars.find((v) => v.envId === activeEnv?.id && v.key === varKey)

  return (
    <div
      className="absolute top-full z-50 mt-1 min-w-[180px] max-w-xs rounded-md border border-th-border bg-th-surface shadow-lg"
      style={{ left: Math.max(0, x) }}
    >
      {/* Environment badge */}
      <div className="flex items-center gap-1.5 border-b border-th-border px-3 py-1.5">
        <Globe className="h-3 w-3 shrink-0 text-th-text-faint" />
        <span className="text-xs text-th-text-subtle">
          {activeEnv ? activeEnv.name : 'No environment selected'}
        </span>
      </div>

      {/* Variable value */}
      <div className="flex items-baseline gap-2 px-3 py-2 text-xs">
        <span className="shrink-0 font-mono text-amber-400">{`{{${varKey}}}`}</span>
        {envVar ? (
          envVar.isSecret ? (
            <span className="tracking-widest text-th-text-faint">••••••••</span>
          ) : (
            <span className="break-all text-th-text-primary">
              {envVar.value !== '' ? envVar.value : <em className="text-th-text-faint">empty</em>}
            </span>
          )
        ) : (
          <span className="italic text-red-400">not defined</span>
        )}
      </div>
    </div>
  )
}
