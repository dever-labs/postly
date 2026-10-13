import { describe, it, expect } from 'vitest'
import { deriveFilename, extensionForContentType, isBinaryContentType, looksBinary, sanitizeFilename } from '../response-file'

describe('deriveFilename', () => {
  it('prefers Content-Disposition over the URL', () => {
    expect(deriveFilename({ contentDisposition: 'attachment; filename="report.pdf"', url: 'https://x.test/download/1', contentType: 'application/pdf' })).toBe('report.pdf')
  })

  it('decodes the RFC 5987 filename* form', () => {
    expect(deriveFilename({ contentDisposition: "attachment; filename*=UTF-8''na%C3%AFve%20file.txt" })).toBe('naïve file.txt')
  })

  it('prefers filename* over a plain fallback', () => {
    expect(deriveFilename({ contentDisposition: "attachment; filename=\"fallback.txt\"; filename*=UTF-8''real.txt" })).toBe('real.txt')
  })

  it('handles an unquoted filename', () => {
    expect(deriveFilename({ contentDisposition: 'attachment; filename=data.csv' })).toBe('data.csv')
  })

  it('falls back to the last URL segment and adds an extension from Content-Type', () => {
    expect(deriveFilename({ url: 'https://x.test/api/users/42?x=1', contentType: 'application/json; charset=utf-8' })).toBe('42.json')
    expect(deriveFilename({ url: 'https://x.test/files/logo.png', contentType: 'image/png' })).toBe('logo.png')
  })

  it('uses "response" when nothing else is known', () => {
    expect(deriveFilename({ url: 'https://x.test/', contentType: 'text/html' })).toBe('response.html')
    expect(deriveFilename({})).toBe('response')
  })

  it('never lets a header write outside the chosen folder', () => {
    expect(deriveFilename({ contentDisposition: 'attachment; filename="../../etc/passwd"' })).not.toMatch(/[\\/]/)
    expect(deriveFilename({ contentDisposition: 'attachment; filename="..\\\\evil.exe"' })).not.toMatch(/[\\/]/)
  })
})

describe('sanitizeFilename', () => {
  it('replaces characters Windows forbids', () => {
    expect(sanitizeFilename('a<b>c:d"e|f?g*h')).toBe('a_b_c_d_e_f_g_h')
  })

  it('avoids reserved device names, leading dots and trailing dots', () => {
    expect(sanitizeFilename('CON.txt')).toBe('_CON.txt')
    expect(sanitizeFilename('.hidden')).toBe('hidden')
    expect(sanitizeFilename('name. ')).toBe('name')
  })

  it('shortens long names but keeps the extension', () => {
    const out = sanitizeFilename(`${'a'.repeat(300)}.json`)
    expect(out.length).toBeLessThanOrEqual(120)
    expect(out.endsWith('.json')).toBe(true)
  })
})

describe('content type helpers', () => {
  it('maps common types to extensions, including +json and +xml', () => {
    expect(extensionForContentType('image/jpeg')).toBe('jpg')
    expect(extensionForContentType('application/problem+json')).toBe('json')
    expect(extensionForContentType('application/atom+xml')).toBe('xml')
    expect(extensionForContentType('application/x-unknown')).toBeUndefined()
  })

  it('flags only types that are certainly binary', () => {
    expect(isBinaryContentType('image/png')).toBe(true)
    expect(isBinaryContentType('application/pdf')).toBe(true)
    expect(isBinaryContentType('image/svg+xml')).toBe(false)
    expect(isBinaryContentType('application/json')).toBe(false)
    expect(isBinaryContentType('application/octet-stream')).toBe(false)
    expect(isBinaryContentType(undefined)).toBe(false)
  })

  it('sniffs NUL bytes', () => {
    expect(looksBinary(Buffer.from([0x68, 0x00, 0x69]))).toBe(true)
    expect(looksBinary(Buffer.from('plain text'))).toBe(false)
  })
})
