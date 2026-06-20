import type { Folder, KeyValuePair, Request } from '@/types'

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

export function normalizeRequest(raw: Record<string, unknown>): Request {
  return {
    id: raw.id as string,
    folderId: (raw.folderId ?? raw.folder_id ?? raw.groupId ?? raw.group_id) as string,
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

export function normalizeFolder(raw: Record<string, unknown>): Folder {
  return {
    id: raw.id as string,
    parentId: ((raw.parentId ?? raw.parent_id ?? undefined) as string | undefined) || undefined,
    name: raw.name as string,
    description: (raw.description as string | undefined) ?? '',
    source: (raw.source ?? 'local') as Folder['source'],
    sourceMeta: parseJsonField<Record<string, string> | undefined>(raw.sourceMeta ?? raw.source_meta, undefined),
    integrationId: (raw.integrationId ?? raw.integration_id ?? undefined) as string | undefined,
    authType: (raw.authType ?? raw.auth_type ?? 'none') as Folder['authType'],
    authConfig: parseJsonField<Record<string, string>>(raw.authConfig ?? raw.auth_config, {}),
    sslVerification: (raw.sslVerification ?? raw.ssl_verification ?? 'inherit') as Folder['sslVerification'],
    hidden: Boolean(raw.hidden ?? false),
    collapsed: Boolean(raw.collapsed ?? false),
    sortOrder: (raw.sortOrder ?? raw.sort_order ?? 0) as number,
    createdAt: (raw.createdAt ?? raw.created_at ?? 0) as number,
    updatedAt: (raw.updatedAt ?? raw.updated_at ?? 0) as number,
  }
}

export const normalizeGroup = normalizeFolder
export const normalizeCollection = normalizeFolder

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
