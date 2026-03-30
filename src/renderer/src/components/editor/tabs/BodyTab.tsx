import Editor, { useMonaco } from '@monaco-editor/react'
import { Plus, Trash2, Upload } from 'lucide-react'
import React, { useCallback, useEffect, useRef } from 'react'
import type { BodyType, KeyValuePair } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { EnvInput } from '@/components/editor/EnvInput'
import { useEnvironmentsStore } from '@/store/environments'
import { useUIStore } from '@/store/ui'
import { cn } from '@/lib/utils'

interface BodyTabProps {
  bodyType: BodyType
  bodyContent: string
  onTypeChange: (t: BodyType) => void
  onContentChange: (c: string) => void
}

type TopTab = 'none' | 'form-data' | 'x-www-form-urlencoded' | 'raw' | 'binary' | 'graphql'
type RawSubtype = 'raw-text' | 'raw-javascript' | 'raw-json' | 'raw-html' | 'raw-xml'

const TOP_TABS: { value: TopTab; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'form-data', label: 'Form Data' },
  { value: 'x-www-form-urlencoded', label: 'URL Encoded' },
  { value: 'raw', label: 'Raw' },
  { value: 'binary', label: 'Binary' },
  { value: 'graphql', label: 'GraphQL' },
]

const RAW_SUBTYPES: { value: RawSubtype; label: string; language: string }[] = [
  { value: 'raw-text', label: 'Text', language: 'plaintext' },
  { value: 'raw-javascript', label: 'JavaScript', language: 'javascript' },
  { value: 'raw-json', label: 'JSON', language: 'json' },
  { value: 'raw-html', label: 'HTML', language: 'html' },
  { value: 'raw-xml', label: 'XML', language: 'xml' },
]

function toTopTab(bodyType: BodyType): TopTab {
  if (bodyType === 'none') return 'none'
  if (bodyType === 'form-data') return 'form-data'
  if (bodyType === 'x-www-form-urlencoded') return 'x-www-form-urlencoded'
  if (bodyType === 'binary') return 'binary'
  if (bodyType === 'graphql') return 'graphql'
  if (bodyType.startsWith('raw-')) return 'raw'
  if (bodyType === 'json') return 'raw'
  if (bodyType === 'raw') return 'raw'
  return 'none'
}

function toRawSubtype(bodyType: BodyType): RawSubtype {
  if (bodyType.startsWith('raw-')) return bodyType as RawSubtype
  if (bodyType === 'json') return 'raw-json'
  return 'raw-text'
}

function KVEditor({ pairs, onChange }: { pairs: KeyValuePair[]; onChange: (pairs: KeyValuePair[]) => void }) {
  const add = () => onChange([...pairs, { id: crypto.randomUUID(), key: '', value: '', enabled: true }])
  const update = (id: string, field: keyof KeyValuePair, value: unknown) =>
    onChange(pairs.map((p) => (p.id === id ? { ...p, [field]: value } : p)))
  const remove = (id: string) => onChange(pairs.filter((p) => p.id !== id))

  return (
    <div className="flex flex-col gap-1 p-3">
      {pairs.map((pair) => (
        <div
          key={pair.id}
          className={cn('grid grid-cols-[24px_1fr_1fr_28px] items-center gap-1', !pair.enabled && 'opacity-50')}
        >
          <input
            type="checkbox"
            checked={pair.enabled}
            onChange={(e) => update(pair.id, 'enabled', e.target.checked)}
            className="h-4 w-4 cursor-pointer accent-th-text-subtle"
          />
          <EnvInput value={pair.key} onChange={(v) => update(pair.id, 'key', v)} placeholder="Key" className="w-full rounded-sm border border-th-border-strong bg-th-surface px-3 py-1.5 text-sm text-th-text-primary placeholder:text-th-text-subtle focus:border-th-border-strong focus:outline-hidden focus:ring-1 focus:ring-th-border-strong" />
          <EnvInput value={pair.value} onChange={(v) => update(pair.id, 'value', v)} placeholder="Value" className="w-full rounded-sm border border-th-border-strong bg-th-surface px-3 py-1.5 text-sm text-th-text-primary placeholder:text-th-text-subtle focus:border-th-border-strong focus:outline-hidden focus:ring-1 focus:ring-th-border-strong" />
          <button
            onClick={() => remove(pair.id)}
            className="flex h-8 w-7 items-center justify-center rounded-sm text-th-text-faint hover:bg-th-surface-raised hover:text-rose-400 focus:outline-hidden"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <Button variant="ghost" size="sm" className="mt-1 w-fit gap-1.5 text-th-text-muted" onClick={add}>
        <Plus className="h-3.5 w-3.5" /> Add field
      </Button>
    </div>
  )
}

function FormDataEditor({ pairs, onChange }: { pairs: KeyValuePair[]; onChange: (pairs: KeyValuePair[]) => void }) {
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const add = () =>
    onChange([...pairs, { id: crypto.randomUUID(), key: '', value: '', enabled: true, fieldType: 'text' }])
  const update = (id: string, field: keyof KeyValuePair, value: unknown) =>
    onChange(pairs.map((p) => (p.id === id ? { ...p, [field]: value } : p)))
  const remove = (id: string) => onChange(pairs.filter((p) => p.id !== id))

  return (
    <div className="flex flex-col gap-1 p-3">
      {pairs.map((pair) => (
        <div
          key={pair.id}
          className={cn('grid grid-cols-[24px_1fr_auto_28px] items-center gap-1', !pair.enabled && 'opacity-50')}
        >
          <input
            type="checkbox"
            checked={pair.enabled}
            onChange={(e) => update(pair.id, 'enabled', e.target.checked)}
            className="h-4 w-4 cursor-pointer accent-th-text-subtle"
          />
          <EnvInput value={pair.key} onChange={(v) => update(pair.id, 'key', v)} placeholder="Key" className="w-full rounded-sm border border-th-border-strong bg-th-surface px-3 py-1.5 text-sm text-th-text-primary placeholder:text-th-text-subtle focus:border-th-border-strong focus:outline-hidden focus:ring-1 focus:ring-th-border-strong" />

          <div className="flex min-w-0 items-center gap-1">
            <div className="flex shrink-0 overflow-hidden rounded-sm border border-th-border text-xs">
              {(['text', 'file'] as const).map((ft) => (
                <button
                  key={ft}
                  onClick={() => onChange(pairs.map((p) =>
                    p.id === pair.id ? { ...p, fieldType: ft, value: ft === 'file' ? '' : p.value } : p
                  ))}
                  className={cn(
                    'px-2 py-1 transition-colors focus:outline-hidden',
                    (pair.fieldType ?? 'text') === ft
                      ? 'bg-th-surface-hover text-th-text-primary'
                      : 'text-th-text-faint hover:text-th-text-subtle'
                  )}
                >
                  {ft === 'text' ? 'T' : <Upload className="h-3 w-3" />}
                </button>
              ))}
            </div>

            {(pair.fieldType ?? 'text') === 'text' ? (
              <Input
                className="min-w-0"
                value={pair.value}
                onChange={(e) => update(pair.id, 'value', e.target.value)}
                placeholder="Value"
              />
            ) : (
              <>
                <input
                  type="file"
                  className="hidden"
                  ref={(el) => { fileRefs.current[pair.id] = el }}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) update(pair.id, 'value', (file as File & { path?: string }).path ?? file.name)
                  }}
                />
                <button
                  onClick={() => fileRefs.current[pair.id]?.click()}
                  className="flex min-w-0 flex-1 items-center gap-1.5 truncate rounded-sm border border-th-border px-2 py-1 text-xs text-th-text-subtle hover:bg-th-surface-raised hover:text-th-text-secondary"
                >
                  <span className="truncate">{pair.value ? pair.value.split(/[\\/]/).pop() : 'Choose file\u2026'}</span>
                </button>
              </>
            )}
          </div>

          <button
            onClick={() => remove(pair.id)}
            className="flex h-8 w-7 items-center justify-center rounded-sm text-th-text-faint hover:bg-th-surface-raised hover:text-rose-400 focus:outline-hidden"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <Button variant="ghost" size="sm" className="mt-1 w-fit gap-1.5 text-th-text-muted" onClick={add}>
        <Plus className="h-3.5 w-3.5" /> Add field
      </Button>
    </div>
  )
}

export function BodyTab({ bodyType, bodyContent, onTypeChange, onContentChange }: BodyTabProps) {
  const theme = useUIStore((s) => s.theme)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const monaco = useMonaco()
  const activeEnv = useEnvironmentsStore((s) => s.activeEnv)
  const vars = useEnvironmentsStore((s) => s.vars)
  const activeVarsRef = useRef(vars.filter((v) => v.envId === activeEnv?.id))
  activeVarsRef.current = vars.filter((v) => v.envId === activeEnv?.id)

  // Register completion provider once per Monaco instance
  useEffect(() => {
    if (!monaco) return
    const LANGS = ['plaintext', 'javascript', 'json', 'html', 'xml', 'graphql']
    const disposables = LANGS.map((lang) =>
      monaco.languages.registerCompletionItemProvider(lang, {
        // No triggerCharacters — we manually trigger via onDidChangeModelContent instead.
        // This avoids the issue where Monaco won't re-trigger on a second consecutive `{`.
        provideCompletionItems: (model, position) => {
          const lineUntil = model.getValueInRange({
            startLineNumber: position.lineNumber, startColumn: 1,
            endLineNumber: position.lineNumber, endColumn: position.column,
          })
          const match = lineUntil.match(/\{\{(\w*)$/)
          if (!match) return { suggestions: [] }
          const startCol = position.column - match[0].length
          return {
            suggestions: activeVarsRef.current.map((v) => ({
              label: v.key,
              kind: monaco.languages.CompletionItemKind.Variable,
              detail: v.isSecret ? '••••••' : v.value,
              documentation: `Environment variable · {{${v.key}}}`,
              insertText: `{{${v.key}}}`,
              filterText: `{{${v.key}`,
              range: {
                startLineNumber: position.lineNumber, endLineNumber: position.lineNumber,
                startColumn: startCol, endColumn: position.column,
              },
            })),
          }
        },
      })
    )
    return () => disposables.forEach((d) => d.dispose())
  }, [monaco])

  // Attach to a Monaco editor instance: auto-trigger suggestions when `{{` is typed
  const attachEnvSuggest = useCallback((editor: Parameters<NonNullable<React.ComponentProps<typeof Editor>['onMount']>>[0]) => {
    editor.onDidChangeModelContent(() => {
      const pos = editor.getPosition()
      if (!pos) return
      const model = editor.getModel()
      if (!model) return
      const lineUntil = model.getValueInRange({
        startLineNumber: pos.lineNumber, startColumn: 1,
        endLineNumber: pos.lineNumber, endColumn: pos.column,
      })
      if (/\{\{(\w*)$/.test(lineUntil)) {
        editor.trigger('postly', 'editor.action.triggerSuggest', {})
      }
    })
  }, [])

  const monacoOptions = {
    minimap: { enabled: false },
    fontSize: 12,
    lineNumbers: 'off' as const,
    scrollBeyondLastLine: false,
    wordWrap: 'on' as const,
    padding: { top: 8 },
    // Allow suggestions everywhere including inside strings
    quickSuggestions: { other: true, comments: true, strings: true },
    suggestOnTriggerCharacters: true,
  }

  const topTab = toTopTab(bodyType)
  const rawSubtype = toRawSubtype(bodyType)
  const rawLang = RAW_SUBTYPES.find((r) => r.value === rawSubtype)?.language ?? 'plaintext'

  const parsedPairs = (): KeyValuePair[] => {
    try { return JSON.parse(bodyContent) } catch { return [] }
  }

  const parsedGql = (): { query: string; variables: string } => {
    try { return JSON.parse(bodyContent) } catch { return { query: '', variables: '' } }
  }

  const handleTopTabChange = (tab: TopTab) => {
    if (tab === 'none') { onTypeChange('none'); return }
    if (tab === 'form-data') { onTypeChange('form-data'); onContentChange(JSON.stringify([])); return }
    if (tab === 'x-www-form-urlencoded') { onTypeChange('x-www-form-urlencoded'); onContentChange(JSON.stringify([])); return }
    if (tab === 'raw') { onTypeChange('raw-text'); return }
    if (tab === 'binary') { onTypeChange('binary'); onContentChange(''); return }
    if (tab === 'graphql') { onTypeChange('graphql'); onContentChange(JSON.stringify({ query: '', variables: '' })); return }
  }

  return (
    <div className="flex flex-col">
      <div className="flex gap-0 border-b border-th-border">
        {TOP_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => handleTopTabChange(t.value)}
            className={cn(
              'px-3 py-1.5 text-xs transition-colors focus:outline-hidden',
              topTab === t.value
                ? 'border-b-2 border-th-text-primary text-th-text-primary'
                : 'text-th-text-subtle hover:text-th-text-secondary'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {topTab === 'raw' && (
        <div className="flex gap-0 border-b border-th-border bg-th-surface-raised px-2">
          {RAW_SUBTYPES.map((r) => (
            <button
              key={r.value}
              onClick={() => onTypeChange(r.value)}
              className={cn(
                'px-2.5 py-1 text-xs transition-colors focus:outline-hidden',
                rawSubtype === r.value
                  ? 'text-th-text-primary underline underline-offset-2'
                  : 'text-th-text-faint hover:text-th-text-subtle'
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1">
        {topTab === 'none' && (
          <div className="flex items-center justify-center py-8 text-sm text-th-text-faint">No body</div>
        )}

        {topTab === 'form-data' && (
          <FormDataEditor
            pairs={parsedPairs()}
            onChange={(p) => onContentChange(JSON.stringify(p))}
          />
        )}

        {topTab === 'x-www-form-urlencoded' && (
          <KVEditor
            pairs={parsedPairs()}
            onChange={(p) => onContentChange(JSON.stringify(p))}
          />
        )}

        {topTab === 'raw' && (
          <Editor
            height="220px"
            language={rawLang}
            theme={theme === 'light' ? 'vs' : 'vs-dark'}
            value={bodyContent}
            onChange={(v) => onContentChange(v ?? '')}
            onMount={(editor) => {
              attachEnvSuggest(editor)
              if (rawSubtype === 'raw-json') {
                editor.getAction('editor.action.formatDocument')?.run()
              }
            }}
            options={monacoOptions}
          />
        )}

        {topTab === 'binary' && (
          <div className="flex flex-col gap-3 p-4">
            <input type="file" className="hidden" ref={fileInputRef} onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onContentChange((file as File & { path?: string }).path ?? file.name)
            }} />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center gap-2 rounded-sm border border-dashed border-th-border py-6 text-sm text-th-text-subtle hover:border-th-border-strong hover:text-th-text-secondary"
            >
              <Upload className="h-4 w-4" />
              {bodyContent ? bodyContent.split(/[\\/]/).pop() : 'Select file\u2026'}
            </button>
            {bodyContent && (
              <p className="truncate text-xs text-th-text-faint">{bodyContent}</p>
            )}
          </div>
        )}

        {topTab === 'graphql' && (
          <div className="flex flex-col gap-0">
            <div className="border-b border-th-border px-3 py-1 text-xs text-th-text-faint">Query</div>
            <Editor
              height="160px"
              language="graphql"
              theme={theme === 'light' ? 'vs' : 'vs-dark'}
              value={parsedGql().query}
              onChange={(v) => onContentChange(JSON.stringify({ ...parsedGql(), query: v ?? '' }))}
              onMount={attachEnvSuggest}
              options={monacoOptions}
            />
            <div className="border-b border-t border-th-border px-3 py-1 text-xs text-th-text-faint">Variables</div>
            <Editor
              height="100px"
              language="json"
              theme={theme === 'light' ? 'vs' : 'vs-dark'}
              value={parsedGql().variables}
              onChange={(v) => onContentChange(JSON.stringify({ ...parsedGql(), variables: v ?? '' }))}
              onMount={attachEnvSuggest}
              options={monacoOptions}
            />
          </div>
        )}
      </div>
    </div>
  )
}
