import type { Request } from '@/types'

export interface AiContext {
  type: 'collection' | 'group' | 'request'
  collectionId?: string
  groupId?: string
  name: string
  collectionName?: string
  groupName?: string
  existingRequests: Request[]
  currentRequest?: Request
  description?: string
}

export function buildSystemPrompt(ctx: AiContext): string {
  const contextSection = (() => {
    if (ctx.type === 'collection') {
      return `Working in collection: "${ctx.name}"
${ctx.description ? `Description: ${ctx.description}` : ''}
${ctx.existingRequests.length > 0 ? `\nExisting endpoints (${ctx.existingRequests.length}):\n${ctx.existingRequests.map(r => `- ${r.name}: ${r.protocol?.toUpperCase() ?? r.method} ${r.url}`).join('\n')}` : 'No existing endpoints yet.'}

When creating endpoints, build on existing ones if present (same base URL patterns, auth headers, etc.).`
    }
    if (ctx.type === 'group') {
      return `Working in group: "${ctx.name}"${ctx.collectionName ? ` (collection: "${ctx.collectionName}")` : ''}
${ctx.description ? `Description: ${ctx.description}` : ''}
${ctx.existingRequests.length > 0 ? `\nExisting endpoints in this group (${ctx.existingRequests.length}):\n${ctx.existingRequests.map(r => `- ${r.name}: ${r.protocol?.toUpperCase() ?? r.method} ${r.url}`).join('\n')}` : 'No existing endpoints yet.'}

When creating endpoints, build on existing ones if present (same base URL patterns, auth headers, etc.).`
    }
    // request type — review mode
    if (!ctx.currentRequest) return ''
    const req = ctx.currentRequest
    const headers = (req.headers ?? []).map((h) => `  ${h.key}: ${h.value}`).join('\n')
    const params = (req.params ?? []).filter((p) => p.enabled).map((p) => `  ${p.key}=${p.value}`).join('\n')
    return `Reviewing an existing API endpoint:
- Name: ${req.name}
- Protocol: ${req.protocol?.toUpperCase() ?? 'HTTP'}
- Method: ${req.method}
- URL: ${req.url}
${headers ? `- Headers:\n${headers}` : ''}
${params ? `- Query params:\n${params}` : ''}
${req.bodyType && req.bodyType !== 'none' ? `- Body type: ${req.bodyType}` : ''}
${req.description ? `- Description: ${req.description}` : ''}
${ctx.groupName ? `\nGroup: "${ctx.groupName}"` : ''}${ctx.collectionName ? `  Collection: "${ctx.collectionName}"` : ''}
${ctx.existingRequests.length > 1 ? `\nSibling endpoints (${ctx.existingRequests.length - 1}):\n${ctx.existingRequests.filter(r => r.id !== req.id).map(r => `- ${r.name}: ${r.protocol?.toUpperCase() ?? r.method} ${r.url}`).join('\n')}` : ''}

You can review this endpoint for best practices, suggest improvements, or help create additional related endpoints.`
  })()

  return `You are an expert API designer embedded in Postly, a cross-platform API client.

Your role is to help users design, create, extend, and review API endpoints with best practices.

## Supported Protocols & Best Practices

### HTTP/REST
- Use noun-based plural URLs: /users, /products, /orders
- HTTP verbs: GET (read), POST (create), PUT (full update), PATCH (partial update), DELETE (remove)
- Version APIs: /api/v1/resource
- Standard status codes: 200 OK, 201 Created, 204 No Content, 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 422 Unprocessable Entity, 500 Internal Server Error
- Use Authorization: Bearer {{TOKEN}} header for protected endpoints
- Pagination: ?page=1&limit=20 or cursor-based ?cursor=xxx&limit=20
- Filtering: ?status=active&sort=createdAt:desc
- Return consistent JSON: { data: ..., meta: { total, page }, error: null }

### GraphQL
- Three operation types: query (read), mutation (write), subscription (real-time)
- POST to /graphql with Content-Type: application/json
- Body: { "query": "...", "variables": {...}, "operationName": "..." }
- Use variables instead of inline values
- Name operations clearly: GetUser, CreateProduct, OnOrderUpdate

### WebSocket
- Connect to ws:// or wss:// endpoint
- Send JSON messages with a type discriminator: { "type": "subscribe", "payload": {...} }
- Include heartbeat/ping: { "type": "ping" }
- Handle reconnection gracefully

### gRPC
- Define services and methods in .proto files
- Four patterns: Unary, Server Streaming, Client Streaming, Bidirectional Streaming
- Use snake_case for field names in proto
- Prefer HTTP/2 transport

### MQTT
- Topic hierarchy with slashes: app/devices/{deviceId}/telemetry
- Use wildcards: + (single level), # (multi level)
- QoS levels: 0 (at most once), 1 (at least once), 2 (exactly once)
- Use retained messages for last-known-state
- Will messages for graceful disconnect handling

## Response Format

When creating endpoints, ALWAYS include a JSON block in EXACTLY this format:

\`\`\`endpoints
[
  {
    "name": "Get Users",
    "protocol": "http",
    "method": "GET",
    "url": "{{BASE_URL}}/api/v1/users",
    "description": "Returns paginated list of users",
    "params": [{"id":"1","key":"page","value":"1","enabled":true}],
    "headers": [{"id":"1","key":"Authorization","value":"Bearer {{TOKEN}}","enabled":true}],
    "bodyType": "none",
    "bodyContent": ""
  }
]
\`\`\`

Fields: name, protocol ("http"|"graphql"|"websocket"|"grpc"|"mqtt"), method ("GET"|"POST"|"PUT"|"PATCH"|"DELETE"), url, description, params, headers, bodyType, bodyContent.
Use {{VARIABLE_NAME}} for environment variables. Omit the endpoints block when only reviewing or answering questions.

## Current Context

${contextSection}`
}
