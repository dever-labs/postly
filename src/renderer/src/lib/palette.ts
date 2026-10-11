import type { Environment, Folder, Integration, Request } from '@/types'

export type PaletteKind = 'request' | 'environment' | 'action'

export interface PaletteItem {
  key: string
  kind: PaletteKind
  /** request id, environment id or action id */
  id: string
  title: string
  method?: string
  /** Source > Collection > Group, shown as the breadcrumb */
  path: string[]
  url?: string
  active?: boolean
}

export const ACTIONS: PaletteItem[] = [
  { key: 'action:new-request', kind: 'action', id: 'new-request', title: 'New request', path: [] },
  { key: 'action:open-settings', kind: 'action', id: 'open-settings', title: 'Open settings', path: [] },
  { key: 'action:show-shortcuts', kind: 'action', id: 'show-shortcuts', title: 'Keyboard shortcuts', path: [] },
  { key: 'action:check-updates', kind: 'action', id: 'check-updates', title: 'Check for updates', path: [] },
]

export function buildItems(
  folders: Folder[],
  requests: Request[],
  integrations: Pick<Integration, 'id' | 'name'>[],
  environments: Environment[]
): PaletteItem[] {
  const folderById = new Map(folders.map((f) => [f.id, f]))
  const integrationName = new Map(integrations.map((i) => [i.id, i.name]))
  const pathCache = new Map<string, string[]>()

  const pathOf = (folderId: string): string[] => {
    const cached = pathCache.get(folderId)
    if (cached) return cached
    const names: string[] = []
    let current = folderById.get(folderId)
    let root: Folder | undefined
    let guard = 0
    while (current && guard++ < 50) {
      names.unshift(current.name)
      root = current
      current = current.parentId ? folderById.get(current.parentId) : undefined
    }
    const source = (root?.integrationId && integrationName.get(root.integrationId)) || 'Local'
    const path = [source, ...names]
    pathCache.set(folderId, path)
    return path
  }

  const items: PaletteItem[] = requests.map((r) => ({
    key: `request:${r.id}`, kind: 'request', id: r.id, title: r.name || 'Untitled', method: r.method, url: r.url, path: pathOf(r.folderId),
  }))
  for (const e of environments) {
    items.push({ key: `env:${e.id}`, kind: 'environment', id: e.id, title: `Switch environment: ${e.name}`, path: [], active: e.isActive })
  }
  return [...ACTIONS, ...items]
}

function isSubsequence(needle: string, hay: string): boolean {
  let i = 0
  for (let j = 0; j < hay.length && i < needle.length; j++) if (hay[j] === needle[i]) i++
  return i === needle.length
}

function startsWord(hay: string, token: string): boolean {
  let idx = hay.indexOf(token)
  while (idx >= 0) {
    if (idx === 0 || /[^a-z0-9]/.test(hay[idx - 1])) return true
    idx = hay.indexOf(token, idx + 1)
  }
  return false
}

function tokenScore(item: { title: string; path: string; url: string; method: string }, token: string): number {
  const { title, path, url, method } = item
  if (title.startsWith(token)) return 100
  if (startsWord(title, token)) return 80
  if (title.includes(token)) return 60
  if (method === token) return 50
  if (url.includes(token)) return 35
  if (path.includes(token)) return 30
  if (token.length >= 2 && isSubsequence(token, title)) return 20
  return 0
}

/** Every whitespace-separated token must match something; scores add up. Empty queries return nothing. */
export function searchItems(items: PaletteItem[], query: string, limit = 50): PaletteItem[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return []
  const scored: { item: PaletteItem; score: number }[] = []
  for (const item of items) {
    const fields = {
      title: item.title.toLowerCase(),
      path: item.path.join(' ').toLowerCase(),
      url: (item.url ?? '').toLowerCase(),
      method: (item.method ?? '').toLowerCase(),
    }
    let total = 0
    for (const t of tokens) {
      const s = tokenScore(fields, t)
      if (s === 0) { total = 0; break }
      total += s
    }
    if (total > 0) scored.push({ item, score: total })
  }
  scored.sort((a, b) => b.score - a.score || a.item.title.length - b.item.title.length || a.item.title.localeCompare(b.item.title))
  return scored.slice(0, limit).map((s) => s.item)
}
