// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import type { BodyType } from '@/types'

// ── Monaco mock ───────────────────────────────────────────────────────────────
// @monaco-editor/react is a heavy runtime dependency not available in jsdom.

vi.mock('@monaco-editor/react', async () => {
  const React = await import('react')
  const Editor = ({ value, onChange, 'data-testid': testId }: {
    value?: string
    onChange?: (v: string) => void
    language?: string
    'data-testid'?: string
  }) => (
    <textarea
      data-testid={testId ?? 'monaco-editor'}
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
    />
  )
  return { default: Editor, useMonaco: () => null }
})

// ── Store mocks ───────────────────────────────────────────────────────────────

vi.mock('@/store/ui', () => ({
  useUIStore: (selector: (s: { theme: string }) => unknown) => selector({ theme: 'dark' }),
}))

vi.mock('@/store/environments', () => ({
  useEnvironmentsStore: (selector: (s: { activeEnv: null; vars: [] }) => unknown) =>
    selector({ activeEnv: null, vars: [] }),
}))

// ── EnvInput / ResizablePanel mocks ───────────────────────────────────────────

vi.mock('@/components/editor/EnvInput', () => ({
  EnvInput: ({ value, onChange, placeholder }: {
    value?: string
    onChange?: (v: string) => void
    placeholder?: string
  }) => (
    <input
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
      placeholder={placeholder}
    />
  ),
}))

vi.mock('@/components/layout/ResizablePanel', () => ({
  ResizablePanel: () => <div data-testid="resizable-panel" />,
}))

import { BodyTab } from '../BodyTab'

afterEach(cleanup)

function renderBody(bodyType: BodyType, bodyContent = '', overrides: Partial<{
  onTypeChange: (t: BodyType) => void
  onContentChange: (c: string) => void
}> = {}) {
  const onTypeChange = vi.fn()
  const onContentChange = vi.fn()
  render(
    <BodyTab
      bodyType={bodyType}
      bodyContent={bodyContent}
      onTypeChange={overrides.onTypeChange ?? onTypeChange}
      onContentChange={overrides.onContentChange ?? onContentChange}
    />
  )
  return { onTypeChange, onContentChange }
}

// ── Tab bar rendering ─────────────────────────────────────────────────────────

describe('BodyTab — tab bar', () => {
  it('renders all top-level tab options', () => {
    renderBody('none')
    expect(screen.getByText('None')).toBeDefined()
    expect(screen.getByText('Form Data')).toBeDefined()
    expect(screen.getByText('URL Encoded')).toBeDefined()
    expect(screen.getByText('Raw')).toBeDefined()
    expect(screen.getByText('Binary')).toBeDefined()
    expect(screen.getByText('GraphQL')).toBeDefined()
  })
})

// ── None tab ──────────────────────────────────────────────────────────────────

describe('BodyTab — None tab', () => {
  it('shows "No body" placeholder for bodyType=none', () => {
    renderBody('none')
    expect(screen.getByText('No body')).toBeDefined()
  })

  it('calls onTypeChange("none") when None is clicked', async () => {
    const { onTypeChange } = renderBody('raw-json')
    await userEvent.click(screen.getByText('None'))
    expect(onTypeChange).toHaveBeenCalledWith('none')
  })
})

// ── Raw tab ───────────────────────────────────────────────────────────────────

describe('BodyTab — Raw tab', () => {
  it('shows the raw subtype selector when bodyType is raw-*', () => {
    renderBody('raw-json')
    expect(screen.getByText('Text')).toBeDefined()
    expect(screen.getByText('JSON')).toBeDefined()
    expect(screen.getByText('HTML')).toBeDefined()
    expect(screen.getByText('XML')).toBeDefined()
  })

  it('calls onTypeChange("raw-text") when switching to Raw from None', async () => {
    const { onTypeChange } = renderBody('none')
    await userEvent.click(screen.getByText('Raw'))
    expect(onTypeChange).toHaveBeenCalledWith('raw-text')
  })

  it('calls onTypeChange("raw-json") when JSON subtype is clicked', async () => {
    const { onTypeChange } = renderBody('raw-text')
    await userEvent.click(screen.getByText('JSON'))
    expect(onTypeChange).toHaveBeenCalledWith('raw-json')
  })

  it('renders the Monaco editor for raw body types', () => {
    renderBody('raw-text', 'hello world')
    expect(screen.getByTestId('monaco-editor')).toBeDefined()
  })

  it('displays bodyContent in the editor', () => {
    renderBody('raw-json', '{"key":"value"}')
    const editor = screen.getByTestId('monaco-editor') as HTMLTextAreaElement
    expect(editor.value).toBe('{"key":"value"}')
  })
})

// ── Form Data tab ─────────────────────────────────────────────────────────────

describe('BodyTab — Form Data tab', () => {
  it('calls onTypeChange("form-data") and onContentChange("[]") when Form Data clicked', async () => {
    const { onTypeChange, onContentChange } = renderBody('none')
    await userEvent.click(screen.getByText('Form Data'))
    expect(onTypeChange).toHaveBeenCalledWith('form-data')
    expect(onContentChange).toHaveBeenCalledWith(JSON.stringify([]))
  })

  it('renders the form-data KV editor with an Add field button', () => {
    renderBody('form-data', '[]')
    expect(screen.getByText('Add field')).toBeDefined()
  })

  it('adds a new row when "Add field" is clicked', async () => {
    const { onContentChange } = renderBody('form-data', '[]')
    await userEvent.click(screen.getByText('Add field'))

    expect(onContentChange).toHaveBeenCalled()
    const updated = JSON.parse(onContentChange.mock.calls[0][0] as string)
    expect(updated).toHaveLength(1)
    expect(updated[0]).toMatchObject({ key: '', value: '', enabled: true })
  })
})

// ── URL Encoded tab ───────────────────────────────────────────────────────────

describe('BodyTab — URL Encoded tab', () => {
  it('calls onTypeChange("x-www-form-urlencoded") and initialises with empty array', async () => {
    const { onTypeChange, onContentChange } = renderBody('none')
    await userEvent.click(screen.getByText('URL Encoded'))
    expect(onTypeChange).toHaveBeenCalledWith('x-www-form-urlencoded')
    expect(onContentChange).toHaveBeenCalledWith(JSON.stringify([]))
  })

  it('renders the KV editor with an Add field button', () => {
    renderBody('x-www-form-urlencoded', '[]')
    expect(screen.getByText('Add field')).toBeDefined()
  })
})

// ── Binary tab ────────────────────────────────────────────────────────────────

describe('BodyTab — Binary tab', () => {
  it('calls onTypeChange("binary") and onContentChange("") when Binary clicked', async () => {
    const { onTypeChange, onContentChange } = renderBody('none')
    await userEvent.click(screen.getByText('Binary'))
    expect(onTypeChange).toHaveBeenCalledWith('binary')
    expect(onContentChange).toHaveBeenCalledWith('')
  })

  it('shows "Select file…" prompt when no file is selected', () => {
    renderBody('binary', '')
    expect(screen.getByText('Select file\u2026')).toBeDefined()
  })

  it('shows the filename when a file path is set', () => {
    renderBody('binary', '/home/user/payload.bin')
    expect(screen.getByText('payload.bin')).toBeDefined()
  })
})

// ── GraphQL tab ───────────────────────────────────────────────────────────────

describe('BodyTab — GraphQL tab', () => {
  it('calls onTypeChange("graphql") and initialises with empty query+variables', async () => {
    const { onTypeChange, onContentChange } = renderBody('none')
    await userEvent.click(screen.getByText('GraphQL'))
    expect(onTypeChange).toHaveBeenCalledWith('graphql')
    expect(onContentChange).toHaveBeenCalledWith(JSON.stringify({ query: '', variables: '' }))
  })

  it('renders Query and Variables labels', () => {
    renderBody('graphql', JSON.stringify({ query: 'query {}', variables: '{}' }))
    expect(screen.getByText('Query')).toBeDefined()
    expect(screen.getByText('Variables')).toBeDefined()
  })
})
