/**
 * Pure (no React state) versions of the env-autocomplete helpers.
 * Imported by the hook and tested independently.
 */

/**
 * Returns the partial key typed after `{{` at the cursor, or null if not inside a template.
 */
export function detectEnvPattern(value: string, cursorPos: number): string | null {
  const beforeCursor = value.slice(0, cursorPos)
  const match = beforeCursor.match(/\{\{([^}]*)$/)
  return match ? match[1] : null
}

/**
 * Replaces the `{{partial` at the cursor with `{{key}}`, preserving any text
 * that follows the cursor (unless it is already the closing `}}`).
 */
export function completeEnvVar(
  value: string,
  cursorPos: number,
  key: string
): { newValue: string; newCursorPos: number } {
  const beforeCursor = value.slice(0, cursorPos)
  const openBrace = beforeCursor.lastIndexOf('{{')
  if (openBrace === -1) return { newValue: value, newCursorPos: cursorPos }

  const afterCursorRaw = value.slice(cursorPos)
  // Only consume trailing word chars if they're immediately closed by }}.
  const trailingClose = afterCursorRaw.match(/^(\w*)(\}\})/)
  const afterCursor = trailingClose
    ? afterCursorRaw.slice(trailingClose[0].length)
    : afterCursorRaw

  const newValue = value.slice(0, openBrace) + `{{${key}}}` + afterCursor
  const newCursorPos = openBrace + key.length + 4
  return { newValue, newCursorPos }
}
