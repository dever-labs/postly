import type { Folder, Request } from '@/types'

export function getRootCollection(folderId: string, folders: Folder[]): Folder | undefined {
  let current = folders.find((folder) => folder.id === folderId)
  while (current?.parentId) {
    current = folders.find((folder) => folder.id === current?.parentId)
  }
  return current
}

export function subtreeMatches(folder: Folder, folders: Folder[], requests: Request[], query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (folder.name.toLowerCase().includes(q) || (folder.description ?? '').toLowerCase().includes(q)) return true
  if (requests.some((request) => request.folderId === folder.id && (`${request.name} ${request.url}`.toLowerCase().includes(q)))) return true
  return folders
    .filter((child) => child.parentId === folder.id)
    .some((child) => subtreeMatches(child, folders, requests, query))
}
