import { describe, it, expect } from 'vitest'
import { detectEnvPattern, completeEnvVar } from '../envAutocomplete'

describe('detectEnvPattern', () => {
  it('returns partial key when cursor is at end of {{API', () => {
    // cursor after 'I' = position 5 (string length)
    expect(detectEnvPattern('{{API', 5)).toBe('API')
  })

  it('returns empty string when cursor is right after {{', () => {
    expect(detectEnvPattern('{{', 2)).toBe('')
  })

  it('returns null when no {{ is open before cursor', () => {
    expect(detectEnvPattern('https://example.com', 19)).toBeNull()
  })

  it('returns null when template is already closed', () => {
    expect(detectEnvPattern('{{KEY}} extra', 13)).toBeNull()
  })

  it('returns partial key mid-string', () => {
    // 'Bearer {{TOK' = 12 chars; cursor at end (12)
    expect(detectEnvPattern('Bearer {{TOK', 12)).toBe('TOK')
  })

  it('returns null when cursor is before {{', () => {
    expect(detectEnvPattern('{{API_KEY}}', 0)).toBeNull()
  })

  it('handles cursor at start of an open {{', () => {
    expect(detectEnvPattern('{{', 2)).toBe('')
  })

  it('returns partial key when typing past existing text', () => {
    // 'url={{BASE_URL}}/path and {{API' = 31 chars; cursor at end (31)
    expect(detectEnvPattern('url={{BASE_URL}}/path and {{API', 31)).toBe('API')
  })
})

describe('completeEnvVar', () => {
  it('replaces {{partial with {{key}}', () => {
    const { newValue, newCursorPos } = completeEnvVar('{{API', 5, 'API_KEY')
    expect(newValue).toBe('{{API_KEY}}')
    expect(newCursorPos).toBe(11) // openBrace(0) + key.length(7) + 4
  })

  it('preserves text after cursor when no trailing }}', () => {
    const { newValue } = completeEnvVar('{{API/path', 5, 'BASE_URL')
    expect(newValue).toBe('{{BASE_URL}}/path')
  })

  it('removes trailing word}} when completing inside existing template', () => {
    // cursor is between {{ and KEY}} — value is "{{OLD_KEY}}"
    // cursor at position 2, after {{
    const { newValue } = completeEnvVar('{{OLD}}', 2, 'NEW')
    expect(newValue).toBe('{{NEW}}')
  })

  it('keeps text to the right when there is no closing }}', () => {
    const { newValue } = completeEnvVar('{{TO and more text', 4, 'TOKEN')
    expect(newValue).toBe('{{TOKEN}} and more text')
  })

  it('returns original value and cursor when {{ not found', () => {
    const { newValue, newCursorPos } = completeEnvVar('plain text', 5, 'KEY')
    expect(newValue).toBe('plain text')
    expect(newCursorPos).toBe(5)
  })

  it('handles empty value with {{', () => {
    const { newValue, newCursorPos } = completeEnvVar('{{', 2, 'HOST')
    expect(newValue).toBe('{{HOST}}')
    expect(newCursorPos).toBe(8)
  })

  it('places cursor right after closing }}', () => {
    const { newCursorPos } = completeEnvVar('{{X', 3, 'MY_KEY')
    // openBrace=0, key='MY_KEY'(6), +4 = 10
    expect(newCursorPos).toBe(10)
  })

  it('handles key in middle of URL', () => {
    // 'https://{{BASE/api' — cursor at 14 (after 'BASE'), afterCursorRaw = '/api'
    const { newValue } = completeEnvVar('https://{{BASE/api', 14, 'BASE_URL')
    expect(newValue).toBe('https://{{BASE_URL}}/api')
  })
})
