import type { Group, KeyValuePair, Request } from '@/types'

// ---------------------------------------------------------------------------
// JSON field parsing
// ---------------------------------------------------------------------------

export function parseJsonField<T>(value: unknown, fallback: T): T {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
  if (value != null) return value as T
  return fallback
}

// ---------------------------------------------------------------------------
// Request / Group normalization (raw DB row → typed object)
// ---------------------------------------------------------------------------

export function normalizeRequest(raw: Record<string, unknown>): Request {
  return {
    id: raw.id as string,
    groupId: (raw.groupId ?? raw.group_id) as string,
    name: raw.name as string,
    method: (raw.method ?? 'GET') as Request['method'],
    url: (raw.url ?? '') as string,
    params: parseJsonField<Request['params']>(raw.params, []),
    headers: parseJsonField<Request['headers']>(raw.headers, []),
    bodyType: (raw.bodyType ?? raw.body_type ?? 'none') as Request['bodyType'],
    bodyContent: (raw.bodyContent ?? raw.body_content ?? '') as string,
    authType: (raw.authType ?? raw.auth_type ?? 'none') as Request['authType'],
    authConfig: parseJsonField<Record<string, string>>(raw.authConfig ?? raw.auth_config, {}),
    sslVerification: (raw.sslVerification ?? raw.ssl_verification ?? 'inherit') as Request['sslVerification'],
    protocol: (raw.protocol ?? 'http') as Request['protocol'],
    protocolConfig: parseJsonField<Record<string, string>>(raw.protocolConfig ?? raw.protocol_config, {}),
    description: raw.description as string | undefined,
    scmPath: (raw.scmPath ?? raw.scm_path) as string | undefined,
    scmSha: (raw.scmSha ?? raw.scm_sha) as string | undefined,
    isDirty: Boolean(raw.isDirty ?? raw.is_dirty ?? false),
    sortOrder: (raw.sortOrder ?? raw.sort_order ?? 0) as number,
  }
}

export function normalizeGroup(raw: Record<string, unknown>): Group {
  return {
    id: raw.id as string,
    collectionId: (raw.collectionId ?? raw.collection_id) as string,
    name: raw.name as string,
    description: raw.description as string | undefined,
    collapsed: Boolean(raw.collapsed ?? false),
    hidden: Boolean(raw.hidden ?? false),
    sortOrder: (raw.sortOrder ?? raw.sort_order ?? 0) as number,
    authType: (raw.authType ?? raw.auth_type ?? 'none') as Group['authType'],
    authConfig: parseJsonField<Record<string, string>>(raw.authConfig ?? raw.auth_config, {}),
    sslVerification: (raw.sslVerification ?? raw.ssl_verification ?? 'inherit') as Group['sslVerification'],
  }
}

// ---------------------------------------------------------------------------
// Key-value pair helpers
// ---------------------------------------------------------------------------

export function kvpToRecord(pairs: KeyValuePair[]): Record<string, string> {
  return pairs
    .filter((p) => p.enabled && p.key.trim() !== '')
    .reduce<Record<string, string>>((acc, p) => {
      acc[p.key] = p.value
      return acc
    }, {})
}

export function serializeRequest(req: Request): Record<string, unknown> {
  return {
    ...req,
    params: JSON.stringify(req.params),
    headers: JSON.stringify(req.headers),
    authConfig: JSON.stringify(req.authConfig),
    protocolConfig: JSON.stringify(req.protocolConfig),
  }
}
