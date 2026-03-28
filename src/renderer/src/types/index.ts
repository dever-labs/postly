export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS'
export type BodyType = 'none' | 'json' | 'form-data' | 'raw' | 'binary'
export type AuthType = 'none' | 'bearer' | 'oauth2'
export type CollectionSource = 'local' | 'backstage' | 'github' | 'gitlab'
export type GrantType = 'authorization_code' | 'client_credentials'

export interface KeyValuePair {
  id: string
  key: string
  value: string
  enabled: boolean
}

export interface Collection {
  id: string
  name: string
  source: CollectionSource
  sourceMeta?: Record<string, string>
  integrationId?: string
  createdAt: number
  updatedAt: number
}

export interface Integration {
  id: string
  type: 'github' | 'gitlab' | 'backstage'
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
}

export interface Request {
  id: string
  groupId: string
  name: string
  method: HttpMethod
  url: string
  params: KeyValuePair[]
  headers: KeyValuePair[]
  bodyType: BodyType
  bodyContent: string
  authType: AuthType
  authConfig: Record<string, string>
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
  body?: string
  bodyType: BodyType
  authType: AuthType
  authConfig: Record<string, string>
}

export interface HttpResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string
  duration: number
  size: number
}

export interface BackstageSettings {
  baseUrl: string
  token: string
  autoSync: boolean
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
