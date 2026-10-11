import { describe, it, expect } from 'vitest'
import { buildItems, searchItems } from '../palette'
import type { Environment, Folder, Request } from '@/types'

const folder = (id: string, name: string, parentId?: string, integrationId?: string) =>
  ({ id, name, parentId, integrationId, source: 'local' }) as unknown as Folder
const request = (id: string, name: string, folderId: string, url = '', method = 'GET') =>
  ({ id, name, folderId, url, method }) as unknown as Request

const folders = [folder('c1', 'Payments', undefined, 'i1'), folder('g1', 'Orders', 'c1'), folder('c2', 'Inventory')]
const requests = [
  request('r1', 'List orders', 'g1', 'https://api.test/orders'),
  request('r2', 'Create order', 'g1', 'https://api.test/orders', 'POST'),
  request('r3', 'Get stock', 'c2', 'https://api.test/stock'),
]
const envs = [{ id: 'e1', name: 'Staging', isActive: false }, { id: 'e2', name: 'Prod', isActive: true }] as Environment[]
const items = buildItems(folders, requests, [{ id: 'i1', name: 'Backstage' }], envs)
const titles = (q: string) => searchItems(items, q).map((i) => i.title)

describe('buildItems', () => {
  it('builds Source > Collection > Group paths', () => {
    expect(items.find((i) => i.id === 'r1')?.path).toEqual(['Backstage', 'Payments', 'Orders'])
    expect(items.find((i) => i.id === 'r3')?.path).toEqual(['Local', 'Inventory'])
  })

  it('includes actions and environments', () => {
    expect(items.filter((i) => i.kind === 'action')).toHaveLength(5)
    expect(items.filter((i) => i.kind === 'environment').map((i) => i.id)).toEqual(['e1', 'e2'])
  })
})

describe('searchItems', () => {
  it('ranks prefix matches above later word and substring matches', () => {
    expect(titles('create')[0]).toBe('Create order')
    expect(titles('order').slice(0, 2)).toEqual(expect.arrayContaining(['List orders', 'Create order']))
  })

  it('matches on url, source and collection path', () => {
    expect(titles('stock')).toContain('Get stock')
    expect(titles('backstage')).toEqual(expect.arrayContaining(['List orders', 'Create order']))
    expect(titles('inventory')).toContain('Get stock')
  })

  it('requires every token to match', () => {
    expect(titles('payments create')).toEqual(['Create order'])
    expect(titles('payments nonsense')).toEqual([])
  })

  it('matches the method and finds environments and actions', () => {
    expect(titles('post')).toContain('Create order')
    expect(titles('staging')).toContain('Switch environment: Staging')
    expect(titles('settings')).toContain('Open settings')
  })

  it('falls back to fuzzy subsequence matches', () => {
    expect(titles('lstord')).toContain('List orders')
  })

  it('returns nothing for an empty query and respects the limit', () => {
    expect(searchItems(items, '  ')).toEqual([])
    expect(searchItems(items, 'o', 2)).toHaveLength(2)
  })

  it('stays fast with thousands of requests', () => {
    const many = Array.from({ length: 5000 }, (_, i) => request(`x${i}`, `Request number ${i}`, 'g1', `https://api.test/items/${i}`))
    const big = buildItems(folders, many, [], [])
    const t0 = performance.now()
    searchItems(big, 'req 42')
    expect(performance.now() - t0).toBeLessThan(200)
  })
})
