import type { ExtractRule } from '../../../shared/extract'
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS'
export type ProtocolType = 'http' | 'graphql' | 'websocket' | 'grpc' | 'mqtt'
export type GrantType = 'authorization_code' | 'client_credentials' | 'implicit' | 'password'
export type BodyType =
  | 'none'
  | 'form-data'
  | 'x-www-form-urlencoded'
  | 'raw-text'
  | 'raw-javascript'
  | 'raw-json'
  | 'raw-html'
  | 'raw-xml'
  | 'binary'
  | 'graphql'
  | 'json'  // legacy alias
  | 'raw'   // legacy alias
export type AuthType = 'none' | 'inherit' | 'bearer' | 'basic' | 'jwt' | 'oauth2' | 'ntlm'
export type CollectionSource = 'local' | 'backstage' | 'github' | 'gitlab' | 'git'
export type SslVerification = 'inherit' | 'enabled' | 'disabled'

export interface KeyValuePair {
  id: string
  key: string
  value: string
  enabled: boolean
  fieldType?: 'text' | 'file'
}

export interface Folder {
  id: string
  parentId?: string
  name: string
  description?: string
  source: CollectionSource
  sourceMeta?: Record<string, string>
  integrationId?: string
  authType: AuthType
  authConfig: Record<string, string>
  sslVerification: SslVerification
  hidden: boolean
  collapsed: boolean
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export type Collection = Folder

export interface Integration {
  id: string
  type: 'github' | 'gitlab' | 'backstage' | 'git'
  name: string
  baseUrl: string
  clientId: string
  /** Secrets never reach the renderer; these only say whether one is stored. */
  hasClientSecret: boolean
  hasToken: boolean
  connectedUser?: { login?: string; username?: string; name: string; avatarUrl: string } | null
  repo: string
  branch: string
  status: 'connected' | 'disconnected' | 'error'
  errorMessage?: string
  sslVerification?: boolean
  createdAt: number
  updatedAt: number
}

export type Group = Folder

export interface Request {
  id: string
  folderId: string
  name: string
  protocol: ProtocolType
  method: HttpMethod
  url: string
  params: KeyValuePair[]
  headers: KeyValuePair[]
  bodyType: BodyType
  bodyContent: string
  authType: AuthType
  authConfig: Record<string, string>
  protocolConfig: Record<string, string>
  sslVerification: SslVerification
  description?: string
  scmPath?: string
  scmSha?: string
  isDirty: boolean
  sortOrder: number
}

export interface Environment {
  id: string
  name: string
  isActive: boolean
}

export interface EnvVar {
  id: string
  envId: string
  key: string
  value: string
  isSecret: boolean
}

export interface OAuthConfig {
  id: string
  name: string
  grantType: GrantType
  clientId: string
  clientSecret?: string
  authUrl?: string
  tokenUrl: string
  scopes: string
  redirectUri: string
  /** Extra parameters appended to every token request body — for providers that require non-standard fields (e.g. `audience`, `resource`). */
  extraParams?: Record<string, string>
}

export interface LogEntry {
  level: 'info' | 'warn' | 'error'
  message: string
  detail?: string
}

export interface Token {
  id: string
  oauthConfigId: string
  accessToken: string
  refreshToken?: string
  tokenType: string
  expiresAt?: number
  scope?: string
}

export interface HttpRequest {
  method: HttpMethod
  url: string
  headers: Record<string, string>
  params?: Record<string, string>
  body?: string
  bodyType: BodyType
  authType: AuthType
  authConfig: Record<string, string>
  sslVerification?: SslVerification
  folderId?: string
  extractRules?: ExtractRule[]
}

export interface CookieRecord {
  name: string
  value: string
  domain: string
  path: string
  /** Epoch ms, or null for a session cookie. */
  expires: number | null
  secure: boolean
  httpOnly: boolean
  sameSite: 'strict' | 'lax' | 'none' | ''
  hostOnly: boolean
}

export interface ResponseCookie extends CookieRecord {
  rejected?: boolean
  deleted?: boolean
}

export interface HttpResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  duration: number
  size: number
  logs?: LogEntry[]
  cookies?: ResponseCookie[]
  /** Variables written by Extract rules, so stores can refresh. */
  extracted?: { variable: string; scope: 'environment' | 'collection' }[]
}

export interface BackstageSettings {
  baseUrl: string
  token: string
  autoSync: boolean
  authProvider?: 'token' | 'guest' | 'gitlab' | 'github' | 'google'
  connectedUser?: { name: string; email?: string; picture?: string }
  sslVerification?: boolean
}

export interface GitHubSettings {
  baseUrl: string
  clientId: string
  clientSecret: string
  token: string
  connectedUser?: { login: string; name: string; avatarUrl: string }
  repo: string
  orgs: string[]
}

export interface GitLabSettings {
  baseUrl: string
  clientId: string
  token: string
  connectedUser?: { username: string; name: string; avatarUrl: string }
  repo: string
  groups: string[]
}

export interface HistoryEntrySummary {
  id: string
  createdAt: number
  protocol: string
  method: string
  url: string
  status: number
  statusText: string
  duration: number
  size: number
}

export interface HistoryEntryDetail extends HistoryEntrySummary {
  request: {
    method: string
    url: string
    headers?: Record<string, string>
    params?: Record<string, string>
    body?: string
    bodyType?: BodyType
    authType?: AuthType
    authConfig?: Record<string, string>
    sslVerification?: SslVerification
    protocol?: string
  }
  responseHeaders: Record<string, string>
  responseBody: string
  bodyTruncated: boolean
}

export interface GeneralSettings {
  theme: 'dark' | 'light' | 'system'
  defaultTimeout: number
  followRedirects: boolean
  sslVerification: boolean
  autoUpdate: boolean
  updateFeedUrl?: string
  historyEnabled?: boolean
  historyLimit?: number
  cookiesEnabled?: boolean
}

export interface AiSettings {
  provider: 'openai' | 'anthropic'
  apiKey: string
  model: string
}

export interface ScmCommitPayload {
  requestId: string
  source: 'github' | 'gitlab'
  commitMessage: string
  branch: string
  content: string
}

export interface DiffResult {
  localContent: string
  remoteContent: string
  hasChanges: boolean
}
