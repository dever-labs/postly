/** Double-quoted string literal. JSON escaping is valid for JavaScript, Python and Go. */
export const dq = (s: string): string => JSON.stringify(s)

export function tryParseJson(text: string): unknown {
  try { return JSON.parse(text) } catch { return undefined }
}

export const isJsonType = (contentType?: string): boolean => /json/i.test(contentType ?? '')

export function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces)
  return text.split('\n').map((l, i) => (i === 0 ? l : l === '' ? l : pad + l)).join('\n')
}

export function hasHeader(headers: { key: string }[], name: string): boolean {
  return headers.some((h) => h.key.toLowerCase() === name)
}
