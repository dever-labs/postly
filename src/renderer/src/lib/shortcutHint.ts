import { shortcutLabels, type ShortcutId } from '@/lib/shortcuts'

/** "Label (Ctrl+S)" for button tooltips, using the platform's key names. */
export function withShortcut(label: string, id: ShortcutId): string {
  const keys = shortcutLabels(id, (window as { api?: { platform?: string } }).api?.platform === 'darwin')[0]
  return keys ? `${label} (${keys})` : label
}
