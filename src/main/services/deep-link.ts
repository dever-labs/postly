/**
 * `postly://` deep links. Only one link is understood:
 *
 *   postly://open?backstage=<url-encoded Backstage base URL>&entity=<url-encoded entity ref>
 *
 * e.g. postly://open?backstage=https%3A%2F%2Fhub.dever.dk&entity=api%3Amockly%2Fmockly-management-api
 *
 * Links come from anywhere (web pages, chat, other apps), so everything is
 * validated strictly and nothing in them is ever used as a file path, a
 * command or code: the base URL must be http(s) and the entity ref must be a
 * `kind:namespace/name` Backstage ref for an API or Component.
 */

export const DEEP_LINK_PROTOCOL = 'postly'
const MAX_LINK_LENGTH = 2048
const MAX_BASE_URL_LENGTH = 1024
const ALLOWED_PARAMS = new Set(['backstage', 'entity'])
/** Entity kinds that map to Postly collections (Components that provide APIs, or standalone APIs). */
export const DEEP_LINK_ENTITY_KINDS = ['api', 'component'] as const
export type DeepLinkEntityKind = typeof DEEP_LINK_ENTITY_KINDS[number]

// Backstage's own rules: names/namespaces are [a-zA-Z0-9] separated by [-_.], at most 63 chars.
const ENTITY_PART = /^[A-Za-z0-9]+(?:[-_.][A-Za-z0-9]+)*$/
const MAX_ENTITY_PART = 63

export interface EntityRef {
  kind: DeepLinkEntityKind
  namespace: string
  name: string
}

export interface OpenBackstageEntityLink {
  action: 'open-backstage-entity'
  /** Normalised: origin + path, no trailing slash, no query/fragment. */
  backstageBaseUrl: string
  entity: EntityRef
}

export type DeepLink = OpenBackstageEntityLink

export class DeepLinkError extends Error {}

export function parseEntityRef(raw: string): EntityRef {
  const match = /^([A-Za-z]+):([^/:]+)\/([^/:]+)$/.exec(raw)
  if (!match) throw new DeepLinkError('Entity must be a Backstage ref like api:namespace/name')
  const kind = match[1].toLowerCase()
  if (!(DEEP_LINK_ENTITY_KINDS as readonly string[]).includes(kind)) {
    throw new DeepLinkError(`Unsupported entity kind "${match[1]}" (expected API or Component)`)
  }
  for (const part of [match[2], match[3]]) {
    if (part.length > MAX_ENTITY_PART || !ENTITY_PART.test(part)) throw new DeepLinkError(`Invalid entity ref "${raw}"`)
  }
  return { kind: kind as DeepLinkEntityKind, namespace: match[2], name: match[3] }
}

export function formatEntityRef(ref: EntityRef): string {
  return `${ref.kind}:${ref.namespace}/${ref.name}`
}

/** Validates a Backstage base URL from a link and normalises it (origin + path, no trailing slash). */
export function parseBackstageBaseUrl(raw: string): string {
  if (raw.length > MAX_BASE_URL_LENGTH) throw new DeepLinkError('Backstage URL is too long')
  let url: URL
  try { url = new URL(raw) } catch { throw new DeepLinkError('Backstage URL is not a valid URL') }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new DeepLinkError('Backstage URL must use http:// or https://')
  if (url.username || url.password) throw new DeepLinkError('Backstage URL must not contain credentials')
  if (url.search || url.hash) throw new DeepLinkError('Backstage URL must not contain a query or fragment')
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

/** Parses a `postly://` link; throws {@link DeepLinkError} for anything that isn't a valid, supported link. */
export function parseDeepLink(raw: string): DeepLink {
  if (typeof raw !== 'string' || raw.length > MAX_LINK_LENGTH) throw new DeepLinkError('Link is too long')
  let url: URL
  try { url = new URL(raw) } catch { throw new DeepLinkError('Not a valid link') }
  if (url.protocol !== `${DEEP_LINK_PROTOCOL}:`) throw new DeepLinkError('Not a postly:// link')
  if (url.username || url.password || url.port || url.hash) throw new DeepLinkError('Unsupported link')
  // `postly://open?…` parses as host "open"; also accept `postly:open?…` and `postly:///open?…`.
  const target = (url.hostname || url.pathname.replace(/^\/+/, '')).toLowerCase()
  if (target !== 'open' || (url.hostname && url.pathname !== '' && url.pathname !== '/')) {
    throw new DeepLinkError('Unsupported link action')
  }

  const seen = new Set<string>()
  for (const key of url.searchParams.keys()) {
    if (!ALLOWED_PARAMS.has(key)) throw new DeepLinkError(`Unsupported link parameter "${key}"`)
    if (seen.has(key)) throw new DeepLinkError(`Duplicate link parameter "${key}"`)
    seen.add(key)
  }
  const backstage = url.searchParams.get('backstage')
  const entity = url.searchParams.get('entity')
  if (!backstage || !entity) throw new DeepLinkError('Link needs both "backstage" and "entity" parameters')

  return {
    action: 'open-backstage-entity',
    backstageBaseUrl: parseBackstageBaseUrl(backstage),
    entity: parseEntityRef(entity),
  }
}

/** The first `postly://` URL in a process argv (Windows/Linux pass the link as an argument). */
export function findDeepLinkInArgv(argv: readonly string[]): string | undefined {
  return argv.find((arg) => typeof arg === 'string' && arg.toLowerCase().startsWith(`${DEEP_LINK_PROTOCOL}:`))
}

/** Compares two Backstage base URLs (case-insensitive host, trailing slashes ignored). */
export function sameBackstageBaseUrl(a: string, b: string): boolean {
  try {
    const ua = new URL(a.trim())
    const ub = new URL(b.trim())
    return ua.origin === ub.origin && ua.pathname.replace(/\/+$/, '') === ub.pathname.replace(/\/+$/, '')
  } catch {
    return false
  }
}
