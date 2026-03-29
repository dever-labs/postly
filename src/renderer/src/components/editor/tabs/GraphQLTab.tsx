import React from 'react'

interface GraphQLTabProps {
  query: string
  variables: string
  operationName: string
  onQueryChange: (v: string) => void
  onVariablesChange: (v: string) => void
  onOperationNameChange: (v: string) => void
}

export function GraphQLTab({
  query,
  variables,
  operationName,
  onQueryChange,
  onVariablesChange,
  onOperationNameChange,
}: GraphQLTabProps) {
  return (
    <div className="flex flex-col gap-3 p-3">
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-th-text-subtle">Query</span>
          <input
            className="w-48 rounded border border-th-border bg-th-surface px-2 py-0.5 text-xs text-th-text-primary placeholder-th-text-faint focus:border-th-border-strong focus:outline-none"
            placeholder="Operation name (optional)"
            value={operationName}
            onChange={(e) => onOperationNameChange(e.target.value)}
          />
        </div>
        <textarea
          className="h-48 w-full resize-y rounded border border-th-border bg-th-surface px-3 py-2 font-mono text-sm text-th-text-primary placeholder-th-text-faint focus:border-th-border-strong focus:outline-none"
          placeholder={'query {\n  # your query here\n}'}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          spellCheck={false}
        />
      </div>

      <div>
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-th-text-subtle">
          Variables <span className="font-normal normal-case text-th-text-faint">(JSON)</span>
        </div>
        <textarea
          className="h-28 w-full resize-y rounded border border-th-border bg-th-surface px-3 py-2 font-mono text-sm text-th-text-primary placeholder-th-text-faint focus:border-th-border-strong focus:outline-none"
          placeholder={'{\n  "id": "123"\n}'}
          value={variables}
          onChange={(e) => onVariablesChange(e.target.value)}
          spellCheck={false}
        />
      </div>
    </div>
  )
}
