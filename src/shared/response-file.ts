/** Helpers for turning an HTTP response into a file: binary detection and a safe suggested filename. */

const EXTENSIONS: Record<string, string> = {
  'application/json': 'json',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/gzip': 'gz',
  'application/x-gzip': 'gz',
  'application/x-tar': 'tar',
  'application/xml': 'xml',
  'application/javascript': 'js',
  'application/yaml': 'yaml',
  'application/x-yaml': 'yaml',
  'application/octet-stream': 'bin',
  'application/x-www-form-urlencoded': 'txt',
  'text/plain': 'txt',
  'text/html': 'html',
  'text/css': 'css',
  'text/csv': 'csv',
  'text/xml': 'xml',
  'text/markdown': 'md',
  'text/event-stream': 'txt',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'audio/mpeg': 'mp3',
  'video/mp4': 'mp4',
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
const MAX_NAME_LENGTH = 120

export function mimeOf(contentType: string | undefined): string {
  return (contentType ?? '').split(';')[0].trim().toLowerCase()
}

export function extensionForContentType(contentType: string | undefined): string | undefined {
  const mime = mimeOf(contentType)
  if (EXTENSIONS[mime]) return EXTENSIONS[mime]
  const suffix = mime.match(/\+(json|xml)$/)
  return suffix ? suffix[1] : undefined
}

/** Types that are certainly not text. Anything else is sniffed, so unusual text types still display. */
export function isBinaryContentType(contentType: string | undefined): boolean {
  const mime = mimeOf(contentType)
  if (!mime) return false
  if (mime === 'image/svg+xml') return false
  if (/^(image|audio|video|font)\//.test(mime)) return true
  return /^application\/(pdf|zip|gzip|x-gzip|x-tar|x-7z-compressed|x-rar-compressed|vnd\.rar|wasm|vnd\.ms-excel|msword|vnd\.openxmlformats-officedocument\..+)$/.test(mime)
}

/** A NUL byte in the first chunk is a reliable sign that the body is not text. */
export function looksBinary(chunk: Uint8Array): boolean {
  const end = Math.min(chunk.length, 8192)
  for (let i = 0; i < end; i++) if (chunk[i] === 0) return true
  return false
}

export function sanitizeFilename(name: string): string {
  let out = name
    .replace(/[\\/]/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f<>:"|?*]/g, '_')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
  if (WINDOWS_RESERVED.test(out)) out = `_${out}`
  if (out.length > MAX_NAME_LENGTH) {
    const dot = out.lastIndexOf('.')
    const ext = dot > 0 && out.length - dot <= 10 ? out.slice(dot) : ''
    out = out.slice(0, MAX_NAME_LENGTH - ext.length) + ext
  }
  return out
}

function filenameFromDisposition(value: string | undefined): string | undefined {
  if (!value) return undefined
  const star = value.match(/filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i)
  if (star) {
    try { return decodeURIComponent(star[2].trim().replace(/^"|"$/g, '')) } catch { /* fall through to plain filename */ }
  }
  const plain = value.match(/filename\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]+))/i)
  const raw = plain ? (plain[1] ?? plain[2]).trim() : undefined
  return raw ? raw.replace(/\\(.)/g, '$1') : undefined
}

function filenameFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  try {
    const segment = new URL(url).pathname.split('/').filter(Boolean).pop()
    return segment ? decodeURIComponent(segment) : undefined
  } catch {
    return undefined
  }
}

/** Suggested name: Content-Disposition first, then the URL's last segment; the extension comes from Content-Type when missing. */
export function deriveFilename(opts: { contentDisposition?: string; url?: string; contentType?: string }): string {
  const named = sanitizeFilename(filenameFromDisposition(opts.contentDisposition) ?? '') || sanitizeFilename(filenameFromUrl(opts.url) ?? '')
  const ext = extensionForContentType(opts.contentType)
  const base = named || 'response'
  if (!ext || /\.[A-Za-z0-9]{1,8}$/.test(base)) return base
  return `${base}.${ext}`
}
