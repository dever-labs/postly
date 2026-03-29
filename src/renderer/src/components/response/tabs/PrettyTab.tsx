import Editor from '@monaco-editor/react'
import React, { useMemo } from 'react'
import { useUIStore } from '@/store/ui'

function getLanguage(contentType: string): string {
  if (contentType.includes('application/json')) return 'json'
  if (contentType.includes('text/html')) return 'html'
  if (contentType.includes('application/xml') || contentType.includes('text/xml')) return 'xml'
  return 'plaintext'
}

function prettyBody(body: string, language: string): string {
  if (language === 'json') {
    try { return JSON.stringify(JSON.parse(body), null, 2) } catch { /* fallthrough */ }
  }
  return body
}

interface PrettyTabProps {
  body: string
  contentType: string
}

export function PrettyTab({ body, contentType }: PrettyTabProps) {
  const language = getLanguage(contentType)
  const value = useMemo(() => prettyBody(body, language), [body, language])
  const theme = useUIStore((s) => s.theme)

  return (
    <Editor
      height="100%"
      language={language}
      theme={theme === 'light' ? 'vs' : 'vs-dark'}
      value={value}
      options={{
        readOnly: true,
        minimap: { enabled: false },
        fontSize: 12,
        lineNumbers: 'off',
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        padding: { top: 8 },
      }}
    />
  )
}
