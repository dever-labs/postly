// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AiChatPanel } from '../AiChatPanel'
import { useCollectionsStore } from '@/store/collections'
import { useSettingsStore } from '@/store/settings'
import { useUIStore } from '@/store/ui'
import type { Folder, Request } from '@/types'

vi.mock('@/lib/aiContext', async () => {
  const actual = await vi.importActual('@/lib/aiContext')
  return {
    ...actual,
    buildSystemPrompt: () => 'system prompt',
  }
})

describe('AiChatPanel', () => {
  beforeEach(() => {
    let emitChunk: ((payload: { requestId: string; text: string; done: boolean }) => void) | null = null
    const chat = vi.fn(async ({ requestId }: { requestId: string }) => {
      emitChunk?.({
        requestId,
        text: 'Generated endpoints\n```endpoints\n[{"name":"New MQTT endpoint","protocol":"http","method":"GET","url":"https://example.test","description":"","params":[],"headers":[],"bodyType":"none","bodyContent":""}]\n```',
        done: false,
      })
      emitChunk?.({ requestId, text: '', done: true })
      return { data: true }
    })
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ai: {
          chat,
          cancel: vi.fn(),
          onChunk: (cb: typeof emitChunk) => {
            emitChunk = cb
            return () => {
              emitChunk = null
            }
          },
        },
        requests: {
          update: vi.fn(async () => ({ data: true })),
        },
      },
    })

    const folder = {
      id: 'col-1',
      name: 'Git Collection',
      parentId: undefined,
      sortOrder: 0,
      source: 'github',
      integrationId: undefined,
      collapsed: false,
      hidden: false,
      authType: 'none',
      authConfig: {},
      sslVerification: 'inherit',
    } as Folder
    const createdRequest = {
      id: 'req-1',
      folderId: 'col-1',
      name: 'New Request',
      method: 'GET',
      url: '',
      headers: [],
      params: [],
      bodyType: 'none',
      bodyContent: '',
      protocol: 'http',
      protocolConfig: {},
      authType: 'none',
      authConfig: {},
      sslVerification: 'inherit',
      isDirty: false,
      sortOrder: 0,
    } as Request

    useCollectionsStore.setState({
      folders: [folder],
      collections: [folder],
      groups: [],
      requests: [],
      createLocalRequest: vi.fn(async () => {
        useCollectionsStore.setState({ requests: [createdRequest] })
        return createdRequest.id
      }),
      deleteRequest: vi.fn(async () => undefined),
      load: vi.fn(async () => undefined),
    })
    useSettingsStore.setState({ ai: { provider: 'openai', apiKey: '', model: '' } })
    useUIStore.setState({ pendingGitAction: null })
  })

  afterEach(cleanup)

  it('routes added git-backed AI endpoints through the git overlay', async () => {
    render(
      <AiChatPanel
        context={{ type: 'collection', name: 'Git Collection', collectionId: 'col-1', collectionName: 'Git Collection', existingRequests: [] }}
      />,
    )

    await userEvent.type(screen.getByPlaceholderText('Describe the endpoints you need…'), 'Create one endpoint{enter}')

    await screen.findByText('Generated endpoints')
    await userEvent.click(screen.getByText('Add'))

    await waitFor(() => expect(useUIStore.getState().pendingGitAction).toMatchObject({
      type: 'push',
      collectionId: 'col-1',
      title: "Created endpoint 'New MQTT endpoint'",
      subtitle: 'Git Collection',
    }))
  })
})
