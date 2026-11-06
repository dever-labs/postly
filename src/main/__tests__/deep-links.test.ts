import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers = vi.hoisted(() => ({} as Record<string, () => unknown>))
vi.mock('electron', () => ({
  app: { setAsDefaultProtocolClient: vi.fn() },
  dialog: { showMessageBox: vi.fn() },
  ipcMain: { handle: vi.fn((ch: string, fn: () => unknown) => { handlers[ch] = fn }) },
}))
vi.mock('../database', () => ({ queryAll: vi.fn(), queryOne: vi.fn() }))
vi.mock('../ipc/integrations', () => ({ createIntegration: vi.fn(), connectIntegration: vi.fn() }))
vi.mock('../services/backstage-entity', () => ({ findEntityCollection: vi.fn() }))
vi.mock('../services/backstage-session', () => ({ withBackstageAccessToken: vi.fn() }))

import { dialog } from 'electron'
import { queryAll } from '../database'
import { createIntegration, connectIntegration } from '../ipc/integrations'
import { findEntityCollection } from '../services/backstage-entity'
import { handleDeepLink, registerDeepLinkHandlers } from '../deep-links'

const send = vi.fn()
const win = { isDestroyed: () => false, isMinimized: () => false, restore: vi.fn(), show: vi.fn(), focus: vi.fn(), webContents: { send } }
const LINK = 'postly://open?backstage=https%3A%2F%2Fhub.dever.dk&entity=api%3Amockly%2Fmockly-management-api'
const SOURCE = { id: 's1', base_url: 'https://hub.dever.dk/', client_id: 'oauth', token: 't', status: 'connected', ssl_verification: 'enabled' }

beforeEach(() => {
  vi.clearAllMocks()
  registerDeepLinkHandlers(() => win as never)
  vi.mocked(dialog.showMessageBox).mockResolvedValue({ response: 0, checkboxChecked: false })
})

describe('handleDeepLink', () => {
  it('refuses invalid links without touching sources', async () => {
    await handleDeepLink('postly://open?backstage=file:///etc/passwd&entity=api:default/x')
    expect(dialog.showMessageBox).toHaveBeenCalledWith(win, expect.objectContaining({ message: 'This Postly link is not valid' }))
    expect(queryAll).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('opens the collection of an existing source', async () => {
    vi.mocked(queryAll).mockReturnValue([SOURCE])
    vi.mocked(findEntityCollection).mockResolvedValueOnce('col-1')
    await handleDeepLink(LINK)
    expect(win.focus).toHaveBeenCalled()
    expect(findEntityCollection).toHaveBeenCalledWith('s1', { kind: 'api', namespace: 'mockly', name: 'mockly-management-api' }, expect.any(Function))
    expect(send).toHaveBeenCalledWith('postly:deep-link:open', { collectionId: 'col-1' })
    expect(createIntegration).not.toHaveBeenCalled()
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
  })

  it('re-syncs once when the entity is not in the last sync', async () => {
    vi.mocked(queryAll).mockReturnValue([SOURCE])
    vi.mocked(findEntityCollection).mockResolvedValueOnce(null).mockResolvedValueOnce('col-2')
    vi.mocked(connectIntegration).mockResolvedValueOnce({ data: {} })
    await handleDeepLink(LINK)
    expect(connectIntegration).toHaveBeenCalledWith({ id: 's1' })
    expect(send).toHaveBeenLastCalledWith('postly:deep-link:open', { collectionId: 'col-2' })
  })

  it('asks before adding an unknown Backstage, and does nothing when cancelled', async () => {
    vi.mocked(queryAll).mockReturnValue([])
    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    await handleDeepLink(LINK)
    expect(dialog.showMessageBox).toHaveBeenCalledWith(win, expect.objectContaining({ title: 'Add Backstage source?' }))
    expect(createIntegration).not.toHaveBeenCalled()
    expect(connectIntegration).not.toHaveBeenCalled()
  })

  it('adds an OAuth source, signs in and opens the collection when confirmed', async () => {
    vi.mocked(queryAll).mockReturnValueOnce([]).mockReturnValue([{ ...SOURCE, id: 'new' }])
    vi.mocked(createIntegration).mockResolvedValueOnce({ data: { id: 'new' } })
    vi.mocked(connectIntegration).mockResolvedValueOnce({ data: {} })
    vi.mocked(findEntityCollection).mockResolvedValueOnce('col-3')
    await handleDeepLink(LINK)
    expect(createIntegration).toHaveBeenCalledWith({ type: 'backstage', name: 'hub.dever.dk', baseUrl: 'https://hub.dever.dk', clientId: 'oauth' })
    expect(connectIntegration).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenLastCalledWith('postly:deep-link:open', { collectionId: 'col-3' })
  })

  it('reports when the entity cannot be found', async () => {
    vi.mocked(queryAll).mockReturnValue([SOURCE])
    vi.mocked(findEntityCollection).mockResolvedValue(null)
    vi.mocked(connectIntegration).mockResolvedValueOnce({ data: {} })
    await handleDeepLink(LINK)
    expect(dialog.showMessageBox).toHaveBeenCalledWith(win, expect.objectContaining({ message: 'api:mockly/mockly-management-api was not found' }))
  })
})

describe('postly:deep-link:ready', () => {
  it('is registered for the renderer', () => {
    expect(handlers['postly:deep-link:ready']()).toEqual({ data: true })
  })
})
