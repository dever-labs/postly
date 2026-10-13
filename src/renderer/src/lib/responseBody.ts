export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** The text the Pretty tab shows: JSON is re-indented, anything else is unchanged. */
export function prettyBody(body: string, contentType: string): string {
  if (contentType.includes('application/json')) {
    try { return JSON.stringify(JSON.parse(body), null, 2) } catch { /* not JSON */ }
  }
  return body
}

export function isPreviewableImage(contentType: string): boolean {
  return /^image\/(png|jpeg|gif|webp|bmp|avif|svg\+xml|x-icon|vnd\.microsoft\.icon)\b/i.test(contentType.trim())
}
