import React, { useState } from 'react'

interface GraphQLTabProps {
  query: string
  variables: string
  operationName: string
  schema?: string
  onQueryChange: (v: string) => void
  onVariablesChange: (v: string) => void
  onOperationNameChange: (v: string) => void
}

export function GraphQLTab({
  query,
  variables,
  operationName,
  schema,
  onQueryChange,
  onVariablesChange,
  onOperationNameChange,
}: GraphQLTabProps) {
  const [activeTab, setActiveTab] = useState<'query' | 'schema'>('query')

  return (
    <div className="flex flex-col gap-3 p-3">
      {schema && (
        <div className="flex gap-3 border-b border-th-border pb-2">
          {(['query', 'schema'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`text-xs font-semibold uppercase tracking-wider transition-colors ${activeTab === t ? 'text-th-text-primary' : 'text-th-text-subtle hover:text-th-text-secondary'}`}
            >
              {t === 'query' ? 'Query' : 'Schema'}
            </button>
          ))}
        </div>
      )}

      {activeTab === 'schema' && schema ? (
        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-th-text-subtle">
            Schema Definition <span className="font-normal normal-case text-th-text-faint">(read-only)</span>
          </div>
          <textarea
            readOnly
            className="h-96 w-full resize-y rounded-sm border border-th-border bg-th-surface px-3 py-2 font-mono text-sm text-th-text-primary focus:border-th-border-strong focus:outline-hidden"
            value={schema}
            spellCheck={false}
          />
        </div>
      ) : (
        <>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              {!schema && <span className="text-xs font-semibold uppercase tracking-wider text-th-text-subtle">Query</span>}
              <input
                className="w-48 rounded-sm border border-th-border bg-th-surface px-2 py-0.5 text-xs text-th-text-primary placeholder-th-text-faint focus:border-th-border-strong focus:outline-hidden"
                placeholder="Operation name (optional)"
                value={operationName}
                onChange={(e) => onOperationNameChange(e.target.value)}
              />
            </div>
            <textarea
              className="h-48 w-full resize-y rounded-sm border border-th-border bg-th-surface px-3 py-2 font-mono text-sm text-th-text-primary placeholder-th-text-faint focus:border-th-border-strong focus:outline-hidden"
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
              className="h-28 w-full resize-y rounded-sm border border-th-border bg-th-surface px-3 py-2 font-mono text-sm text-th-text-primary placeholder-th-text-faint focus:border-th-border-strong focus:outline-hidden"
              placeholder={'{\n  "id": "123"\n}'}
              value={variables}
              onChange={(e) => onVariablesChange(e.target.value)}
              spellCheck={false}
            />
          </div>
        </>
      )}
    </div>
  )
}
