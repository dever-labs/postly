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

export interface Collection {
  id: string
  name: string
  description?: string
  source: CollectionSource
  sourceMeta?: Record<string, string>
  integrationId?: string
  authType: AuthType
  authConfig: Record<string, string>
  sslVerification: SslVerification
  collapsed: boolean
  createdAt: number
  updatedAt: number
}

export interface Integration {
  id: string
  type: 'github' | 'gitlab' | 'backstage' | 'git'
  name: string
  baseUrl: string
  clientId: string
  clientSecret: string
  token: string
  connectedUser?: { login?: string; username?: string; name: string; avatarUrl: string } | null
  repo: string
  branch: string
  status: 'connected' | 'disconnected' | 'error'
  errorMessage?: string
  createdAt: number
  updatedAt: number
}

export interface Group {
  id: string
  collectionId: string
  name: string
  description?: string
  collapsed: boolean
  hidden: boolean
  sortOrder: number
  authType: AuthType
  authConfig: Record<string, string>
  sslVerification: SslVerification
}

export interface Request {
  id: string
  groupId: string
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
  groupId?: string
}

export interface HttpResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  duration: number
  size: number
  logs?: LogEntry[]
}

export interface BackstageSettings {
  baseUrl: string
  token: string
  autoSync: boolean
  authProvider?: 'token' | 'guest' | 'gitlab' | 'github' | 'google'
  connectedUser?: { name: string; email?: string; picture?: string }
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

export interface GeneralSettings {
  theme: 'dark' | 'light' | 'system'
  defaultTimeout: number
  followRedirects: boolean
  sslVerification: boolean
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
