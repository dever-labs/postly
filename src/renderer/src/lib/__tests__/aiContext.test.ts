import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from '../aiContext'
import type { AiContext } from '../aiContext'

const makeRequest = (overrides = {}) => ({
  id: 'r1', groupId: 'g1', name: 'Get Users', method: 'GET' as const,
  url: '/api/users', params: [], headers: [], bodyType: 'none' as const,
  bodyContent: '', authType: 'none' as const, authConfig: {},
  sslVerification: 'inherit' as const, protocol: 'http' as const,
  protocolConfig: {}, isDirty: false, sortOrder: 0,
  ...overrides,
})

describe('buildSystemPrompt – collection context', () => {
  const ctx: AiContext = {
    type: 'collection',
    collectionId: 'col-1',
    name: 'My API',
    existingRequests: [],
  }

  it('mentions the collection name', () => {
    expect(buildSystemPrompt(ctx)).toContain('My API')
  })

  it('includes REST best practices', () => {
    const prompt = buildSystemPrompt(ctx)
    expect(prompt).toMatch(/REST|HTTP/i)
  })

  it('reports no existing endpoints when list is empty', () => {
    expect(buildSystemPrompt(ctx)).toContain('No existing endpoints')
  })

  it('lists existing endpoints when present', () => {
    const ctxWithRequests: AiContext = {
      ...ctx,
      existingRequests: [makeRequest({ name: 'List Posts', url: '/api/posts' })],
    }
    const prompt = buildSystemPrompt(ctxWithRequests)
    expect(prompt).toContain('List Posts')
    expect(prompt).toContain('/api/posts')
  })

  it('includes description when provided', () => {
    const ctxWithDesc: AiContext = { ...ctx, description: 'Blog management API' }
    expect(buildSystemPrompt(ctxWithDesc)).toContain('Blog management API')
  })
})

describe('buildSystemPrompt – group context', () => {
  const ctx: AiContext = {
    type: 'group',
    name: 'Auth Endpoints',
    collectionName: 'My API',
    existingRequests: [],
  }

  it('mentions the group name', () => {
    expect(buildSystemPrompt(ctx)).toContain('Auth Endpoints')
  })

  it('mentions the parent collection name', () => {
    expect(buildSystemPrompt(ctx)).toContain('My API')
  })

  it('reports no existing endpoints when empty', () => {
    expect(buildSystemPrompt(ctx)).toContain('No existing endpoints')
  })
})

describe('buildSystemPrompt – request context', () => {
  const ctx: AiContext = {
    type: 'request',
    name: 'Get User by ID',
    existingRequests: [],
    currentRequest: makeRequest({
      name: 'Get User by ID',
      method: 'GET',
      url: '/api/users/:id',
    }),
  }

  it('mentions the request name', () => {
    expect(buildSystemPrompt(ctx)).toContain('Get User by ID')
  })

  it('includes the HTTP method', () => {
    expect(buildSystemPrompt(ctx)).toContain('GET')
  })

  it('includes the URL', () => {
    expect(buildSystemPrompt(ctx)).toContain('/api/users/:id')
  })

  it('produces a review-oriented prompt', () => {
    const prompt = buildSystemPrompt(ctx)
    expect(prompt).toMatch(/review|best practice|improvement/i)
  })
})

describe('buildSystemPrompt – protocol best practices', () => {
  it('includes GraphQL guidance', () => {
    const ctx: AiContext = { type: 'collection', name: 'GQL', existingRequests: [] }
    expect(buildSystemPrompt(ctx)).toMatch(/graphql/i)
  })

  it('includes WebSocket guidance', () => {
    const ctx: AiContext = { type: 'collection', name: 'WS', existingRequests: [] }
    expect(buildSystemPrompt(ctx)).toMatch(/websocket/i)
  })

  it('includes endpoint block format spec', () => {
    const ctx: AiContext = { type: 'collection', name: 'API', existingRequests: [] }
    expect(buildSystemPrompt(ctx)).toContain('```endpoints')
  })
})
