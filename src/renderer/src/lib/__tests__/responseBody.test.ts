import { describe, it, expect } from 'vitest'
import { formatSize, isPreviewableImage, prettyBody } from '../responseBody'

describe('formatSize', () => {
  it('uses B, KB and MB', () => {
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(2048)).toBe('2.0 KB')
    expect(formatSize(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})

describe('prettyBody', () => {
  it('re-indents JSON and leaves other content alone', () => {
    expect(prettyBody('{"a":1}', 'application/json')).toBe('{\n  "a": 1\n}')
    expect(prettyBody('{"a":1}', 'text/plain')).toBe('{"a":1}')
    expect(prettyBody('not json', 'application/json')).toBe('not json')
  })
})

describe('isPreviewableImage', () => {
  it('accepts raster images and SVG only', () => {
    expect(isPreviewableImage('image/png')).toBe(true)
    expect(isPreviewableImage('image/svg+xml; charset=utf-8')).toBe(true)
    expect(isPreviewableImage('application/pdf')).toBe(false)
    expect(isPreviewableImage('')).toBe(false)
  })
})
