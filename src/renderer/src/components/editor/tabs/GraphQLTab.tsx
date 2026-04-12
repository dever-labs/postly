import Editor, { useMonaco } from '@monaco-editor/react'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useUIStore } from '@/store/ui'

interface GraphQLTabProps {
  query: string
  variables: string
  operationName: string
  schema?: string
  onQueryChange: (v: string) => void
  onVariablesChange: (v: string) => void
  onOperationNameChange: (v: string) => void
}

// ─── Schema parsing helpers ────────────────────────────────────────────────────

type FieldDef = { name: string; type: string }
type TypeMap = Record<string, FieldDef[]>
type RootTypes = { query: string; mutation: string; subscription: string }

function parseSchemaFields(sdl: string): TypeMap {
  const typeMap: TypeMap = {}
  let currentType: string | null = null
  for (const rawLine of sdl.split('\n')) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue
    const typeMatch = line.match(/^(?:type|input|interface|extend\s+type)\s+(\w+)/)
    if (typeMatch) {
      currentType = typeMatch[1]
      if (!typeMap[currentType]) typeMap[currentType] = []
      continue
    }
    if (line === '}') { currentType = null; continue }
    if (currentType) {
      const fieldMatch = line.match(/^(\w+)(?:\([^)]*\))?:\s*([\[\]!\w]+)/)
      if (fieldMatch) typeMap[currentType].push({ name: fieldMatch[1], type: fieldMatch[2] })
    }
  }
  return typeMap
}

function getRootTypes(sdl: string): RootTypes {
  const roots: RootTypes = { query: 'Query', mutation: 'Mutation', subscription: 'Subscription' }
  const block = sdl.match(/schema\s*\{([^}]+)\}/)
  if (block) {
    const q = block[1].match(/\bquery\s*:\s*(\w+)/); if (q) roots.query = q[1]
    const m = block[1].match(/\bmutation\s*:\s*(\w+)/); if (m) roots.mutation = m[1]
    const s = block[1].match(/\bsubscription\s*:\s*(\w+)/); if (s) roots.subscription = s[1]
  }
  return roots
}

/**
 * Walk query text from start up to the cursor to determine the GraphQL type
 * currently being selected into. Returns null when the cursor is outside any
 * selection set (e.g. at the root level before the first `{`).
 */
function getTypeAtCursor(text: string, typeMap: TypeMap, roots: RootTypes): string | null {
  const stack: string[] = []
  let i = 0
  let word = ''
  let inComment = false

  while (i < text.length) {
    const ch = text[i]
    if (ch === '#') inComment = true
    if (ch === '\n') { inComment = false; word = ''; i++; continue }
    if (inComment) { i++; continue }

    if (/\w/.test(ch)) {
      word += ch
    } else if (ch === '(') {
      // Skip argument lists
      let depth = 1; i++
      while (i < text.length && depth > 0) {
        if (text[i] === '(') depth++
        else if (text[i] === ')') depth--
        i++
      }
      continue
    } else if (ch === '{') {
      if (stack.length === 0) {
        const lw = word.toLowerCase()
        stack.push(lw === 'mutation' ? roots.mutation : lw === 'subscription' ? roots.subscription : roots.query)
      } else {
        const curType = stack[stack.length - 1]
        const field = (typeMap[curType] || []).find(f => f.name === word)
        stack.push(field ? field.type.replace(/[\[\]!]/g, '') : word)
      }
      word = ''
    } else if (ch === '}') {
      stack.pop()
      word = ''
    } else {
      if (!/\s/.test(ch)) word = ''
    }
    i++
  }
  return stack.length > 0 ? stack[stack.length - 1] : null
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function GraphQLTab({
  query,
  variables,
  operationName,
  schema,
  onQueryChange,
  onVariablesChange,
  onOperationNameChange,
}: GraphQLTabProps) {
  const theme = useUIStore((s) => s.theme)
  const [activeTab, setActiveTab] = useState<'query' | 'schema'>('query')
  const monaco = useMonaco()

  // Keep schema data in refs so the completion provider always reads fresh values
  // without needing to be re-registered on every schema change.
  const typeMapRef = useRef<TypeMap>({})
  const rootTypesRef = useRef<RootTypes>({ query: 'Query', mutation: 'Mutation', subscription: 'Subscription' })

  useEffect(() => {
    if (!schema) { typeMapRef.current = {}; return }
    typeMapRef.current = parseSchemaFields(schema)
    rootTypesRef.current = getRootTypes(schema)
  }, [schema])

  // Register schema completion provider once per Monaco instance.
  // Uses refs so it never needs to be re-registered when the schema changes.
  useEffect(() => {
    if (!monaco) return
    const disposable = monaco.languages.registerCompletionItemProvider('graphql', {
      triggerCharacters: ['{', '\n'],
      provideCompletionItems: (model, position) => {
        const typeMap = typeMapRef.current
        if (!Object.keys(typeMap).length) return { suggestions: [] }

        const textUntil = model.getValueInRange({
          startLineNumber: 1, startColumn: 1,
          endLineNumber: position.lineNumber, endColumn: position.column,
        })
        const currentType = getTypeAtCursor(textUntil, typeMap, rootTypesRef.current)
        if (!currentType) return { suggestions: [] }

        const fields = typeMap[currentType] || []
        const wordMatch = textUntil.match(/(\w*)$/)
        const wordLen = wordMatch?.[1].length ?? 0
        const range = {
          startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
          startColumn: position.column - wordLen, endColumn: position.column,
        }

        return {
          suggestions: fields.map((f) => ({
            label: f.name,
            kind: monaco.languages.CompletionItemKind.Field,
            detail: f.type,
            documentation: `${currentType}.${f.name}: ${f.type}`,
            insertText: f.name,
            range,
          })),
        }
      },
    })
    return () => disposable.dispose()
  }, [monaco])

  // Only auto-trigger immediately after '{' — all other triggers are user-initiated
  // (Ctrl+Space). This avoids suggestions blocking Enter on every keystroke.
  const attachGraphQLSuggest = useCallback(
    (editor: Parameters<NonNullable<React.ComponentProps<typeof Editor>['onMount']>>[0]) => {
      editor.onDidChangeModelContent(() => {
        const pos = editor.getPosition()
        if (!pos) return
        const model = editor.getModel()
        if (!model) return
        const lastChar = model.getValueInRange({
          startLineNumber: pos.lineNumber, startColumn: Math.max(1, pos.column - 1),
          endLineNumber: pos.lineNumber, endColumn: pos.column,
        })
        if (lastChar === '{') {
          editor.trigger('postly', 'editor.action.triggerSuggest', {})
        }
      })
    },
    []
  )

  const monacoOptions = {
    minimap: { enabled: false },
    fontSize: 12,
    lineNumbers: 'off' as const,
    scrollBeyondLastLine: false,
    wordWrap: 'on' as const,
    padding: { top: 8 },
    // Don't auto-show on every keystroke — only on '{' (via onDidChangeModelContent)
    // or Ctrl+Space. Prevents suggestions blocking the Enter key.
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
    // Enter always inserts a newline; Tab accepts the selected suggestion.
    acceptSuggestionOnEnter: 'smart' as const,
  }

  const monacoTheme = theme === 'light' ? 'vs' : 'vs-dark'

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
          <Editor
            height="380px"
            language="graphql"
            theme={monacoTheme}
            value={schema}
            options={{ ...monacoOptions, readOnly: true, lineNumbers: 'on' as const }}
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
            <div className="overflow-hidden rounded-sm border border-th-border">
              <Editor
                height="220px"
                language="graphql"
                theme={monacoTheme}
                value={query}
                onChange={(v) => onQueryChange(v ?? '')}
                onMount={attachGraphQLSuggest}
                options={monacoOptions}
              />
            </div>
            {schema && (
              <p className="mt-1 text-xs text-th-text-faint">
                Schema loaded — type <kbd className="rounded bg-th-surface-raised px-1 font-mono text-th-text-subtle">{'{'}</kbd> to autocomplete fields, <kbd className="rounded bg-th-surface-raised px-1 font-mono text-th-text-subtle">Tab</kbd> to accept, <kbd className="rounded bg-th-surface-raised px-1 font-mono text-th-text-subtle">Ctrl+Space</kbd> to re-open
              </p>
            )}
          </div>

          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-th-text-subtle">
              Variables <span className="font-normal normal-case text-th-text-faint">(JSON)</span>
            </div>
            <div className="overflow-hidden rounded-sm border border-th-border">
              <Editor
                height="120px"
                language="json"
                theme={monacoTheme}
                value={variables}
                onChange={(v) => onVariablesChange(v ?? '')}
                options={monacoOptions}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
