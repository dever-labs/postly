import { describe, it, expect } from 'vitest'
import { getRootCollection, subtreeMatches } from '../folder-tree'
import type { Folder, Request } from '@/types'

const folder = (id: string, parentId: string | null, name: string, description?: string) =>
  ({ id, parentId, name, description }) as unknown as Folder
const request = (id: string, folderId: string, name: string, url = '') =>
  ({ id, folderId, name, url }) as unknown as Request

const folders = [
  folder('root', null, 'Payments API', 'Billing services'),
  folder('mid', 'root', 'Invoices'),
  folder('leaf', 'mid', 'Drafts'),
  folder('other', null, 'Users'),
]
const requests = [
  request('r1', 'leaf', 'Create draft', 'https://api.example.com/v1/drafts'),
  request('r2', 'other', 'List users', 'https://api.example.com/users'),
]

describe('getRootCollection', () => {
  it('walks up to the top-level folder', () => {
    expect(getRootCollection('leaf', folders)?.id).toBe('root')
    expect(getRootCollection('mid', folders)?.id).toBe('root')
  })
  it('returns a root folder as itself', () => {
    expect(getRootCollection('other', folders)?.id).toBe('other')
  })
  it('returns undefined for unknown ids', () => {
    expect(getRootCollection('nope', folders)).toBeUndefined()
  })
})

describe('subtreeMatches', () => {
  const root = folders[0]

  it('matches everything for an empty or whitespace query', () => {
    expect(subtreeMatches(root, folders, requests, '')).toBe(true)
    expect(subtreeMatches(root, folders, requests, '   ')).toBe(true)
  })
  it('matches folder name and description case-insensitively', () => {
    expect(subtreeMatches(root, folders, requests, 'PAYMENTS')).toBe(true)
    expect(subtreeMatches(root, folders, requests, 'billing')).toBe(true)
  })
  it('matches requests by name or url anywhere in the subtree', () => {
    expect(subtreeMatches(root, folders, requests, 'create draft')).toBe(true)
    expect(subtreeMatches(root, folders, requests, '/v1/drafts')).toBe(true)
  })
  it('matches nested folder names', () => {
    expect(subtreeMatches(root, folders, requests, 'invoices')).toBe(true)
  })
  it('does not match content belonging to a sibling subtree', () => {
    expect(subtreeMatches(root, folders, requests, 'list users')).toBe(false)
    expect(subtreeMatches(folders[3], folders, requests, 'list users')).toBe(true)
  })
  it('returns false when nothing matches', () => {
    expect(subtreeMatches(root, folders, requests, 'zzz')).toBe(false)
  })
})
