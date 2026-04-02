import { contextBridge, ipcRenderer } from 'electron'

const api = {
  collections: {
    list: () => ipcRenderer.invoke('postly:collections:list'),
    create: (data: { name: string; source?: string; integrationId?: string }) => ipcRenderer.invoke('postly:collections:create', data),
    delete: (data: { id: string; commitMessage?: string }) => ipcRenderer.invoke('postly:collections:delete', data),
    rename: (data: { id: string; name: string }) => ipcRenderer.invoke('postly:collections:rename', data),
    update: (data: { id: string; name?: string; description?: string; authType?: string; authConfig?: Record<string, string>; sslVerification?: string; collapsed?: boolean }) =>
      ipcRenderer.invoke('postly:collections:update', data),
    moveSource: (data: { id: string; source: string }) => ipcRenderer.invoke('postly:collections:move-source', data),
  },
  groups: {
    create: (data: { collectionId: string; name: string; description?: string }) => ipcRenderer.invoke('postly:groups:create', data),
    delete: (data: { id: string }) => ipcRenderer.invoke('postly:groups:delete', data),
    update: (data: { id: string; collapsed?: boolean; hidden?: boolean; name?: string; description?: string; authType?: string; authConfig?: Record<string, string>; sortOrder?: number; collectionId?: string }) => ipcRenderer.invoke('postly:groups:update', data),
  },
  requests: {
    list: (data: { groupId: string }) => ipcRenderer.invoke('postly:requests:list', data),
    get: (data: { id: string }) => ipcRenderer.invoke('postly:requests:get', data),
    create: (data: { groupId: string; name?: string; method?: string }) => ipcRenderer.invoke('postly:requests:create', data),
    update: (data: { id: string; [key: string]: unknown }) => ipcRenderer.invoke('postly:requests:update', data),
    delete: (data: { id: string }) => ipcRenderer.invoke('postly:requests:delete', data),
    markDirty: (data: { id: string; isDirty: boolean }) => ipcRenderer.invoke('postly:requests:mark-dirty', data),
  },
  http: {
    execute: (request: unknown) => ipcRenderer.invoke('postly:http:execute', request),
  },
  oauth: {
    configs: {
      list: () => ipcRenderer.invoke('postly:oauth:configs:list'),
      create: (data: unknown) => ipcRenderer.invoke('postly:oauth:configs:create', data),
      delete: (data: { id: string }) => ipcRenderer.invoke('postly:oauth:configs:delete', data),
    },
    authorize: (data: { configId: string }) => ipcRenderer.invoke('postly:oauth:authorize', data),
    getToken: (data: { configId: string }) => ipcRenderer.invoke('postly:oauth:token:get', data),
    clearToken: (data: { configId: string }) => ipcRenderer.invoke('postly:oauth:token:clear', data),
    inline: {
      authorize: (config: unknown) => ipcRenderer.invoke('postly:oauth:inline:authorize', config),
      getToken: (config: unknown) => ipcRenderer.invoke('postly:oauth:inline:token:get', config),
      clearToken: (config: unknown) => ipcRenderer.invoke('postly:oauth:inline:token:clear', config),
    },
  },
  environments: {
    list: () => ipcRenderer.invoke('postly:environments:list'),
    create: (data: { name: string }) => ipcRenderer.invoke('postly:environments:create', data),
    rename: (data: { id: string; name: string }) => ipcRenderer.invoke('postly:environments:rename', data),
    delete: (data: { id: string }) => ipcRenderer.invoke('postly:environments:delete', data),
    setActive: (data: { id: string }) => ipcRenderer.invoke('postly:environments:set-active', data),
    vars: {
      list: (data: { envId: string }) => ipcRenderer.invoke('postly:env-vars:list', data),
      upsert: (data: { envId: string; key: string; value: string; isSecret?: boolean; id?: string }) => ipcRenderer.invoke('postly:env-vars:upsert', data),
      delete: (data: { id: string }) => ipcRenderer.invoke('postly:env-vars:delete', data),
    },
  },
  backstage: {
    sync: () => ipcRenderer.invoke('postly:backstage:sync'),
  },
  github: {
    sync: () => ipcRenderer.invoke('postly:github:sync'),
    listBranches: (data: { owner: string; repo: string }) => ipcRenderer.invoke('postly:github:branches:list', data),
    createBranch: (data: { owner: string; repo: string; newBranch: string; fromBranch: string }) => ipcRenderer.invoke('postly:github:branch:create', data),
    commit: (data: unknown) => ipcRenderer.invoke('postly:github:commit', data),
    diff: (data: { requestId: string }) => ipcRenderer.invoke('postly:github:diff', data),
    oauth: (data: { baseUrl: string; clientId: string; clientSecret: string }) => ipcRenderer.invoke('postly:github:oauth', data),
    disconnect: () => ipcRenderer.invoke('postly:github:disconnect'),
  },
  gitlab: {
    sync: () => ipcRenderer.invoke('postly:gitlab:sync'),
    listBranches: (data: { projectId: string }) => ipcRenderer.invoke('postly:gitlab:branches:list', data),
    createBranch: (data: { projectId: string; newBranch: string; fromBranch: string }) => ipcRenderer.invoke('postly:gitlab:branch:create', data),
    commit: (data: unknown) => ipcRenderer.invoke('postly:gitlab:commit', data),
    diff: (data: { requestId: string }) => ipcRenderer.invoke('postly:gitlab:diff', data),
    oauth: (data: { baseUrl: string; clientId: string }) => ipcRenderer.invoke('postly:gitlab:oauth', data),
    disconnect: () => ipcRenderer.invoke('postly:gitlab:disconnect'),
  },
  settings: {
    get: (data: { key: string }) => ipcRenderer.invoke('postly:settings:get', data),
    set: (data: { key: string; value: unknown }) => ipcRenderer.invoke('postly:settings:set', data),
    getAll: () => ipcRenderer.invoke('postly:settings:get-all'),
  },
  ws: {
    connect: (data: { connectionId: string; url: string; headers?: Record<string, string> }) =>
      ipcRenderer.invoke('postly:ws:connect', data),
    send: (data: { connectionId: string; message: string }) =>
      ipcRenderer.invoke('postly:ws:send', data),
    disconnect: (data: { connectionId: string }) =>
      ipcRenderer.invoke('postly:ws:disconnect', data),
    status: (data: { connectionId: string }) =>
      ipcRenderer.invoke('postly:ws:status', data),
    onEvent: (cb: (data: unknown) => void) => {
      const handler = (_: unknown, data: unknown) => cb(data)
      ipcRenderer.on('postly:ws:event', handler)
      return () => ipcRenderer.removeListener('postly:ws:event', handler)
    },
  },
  grpc: {
    loadProto: (data: { protoContent: string }) =>
      ipcRenderer.invoke('postly:grpc:load-proto', data),
    invoke: (data: {
      serverUrl: string
      protoContent: string
      serviceName: string
      methodName: string
      metadata?: Record<string, string>
      requestBody: string
      useTls?: boolean
    }) => ipcRenderer.invoke('postly:grpc:invoke', data),
  },
  mqtt: {
    connect: (data: {
      connectionId: string
      brokerUrl: string
      clientId?: string
      username?: string
      password?: string
      keepAlive?: number
      cleanSession?: boolean
    }) => ipcRenderer.invoke('postly:mqtt:connect', data),
    subscribe: (data: { connectionId: string; topic: string; qos?: 0 | 1 | 2 }) =>
      ipcRenderer.invoke('postly:mqtt:subscribe', data),
    unsubscribe: (data: { connectionId: string; topic: string }) =>
      ipcRenderer.invoke('postly:mqtt:unsubscribe', data),
    publish: (data: { connectionId: string; topic: string; payload: string; qos?: 0 | 1 | 2; retain?: boolean }) =>
      ipcRenderer.invoke('postly:mqtt:publish', data),
    disconnect: (data: { connectionId: string }) =>
      ipcRenderer.invoke('postly:mqtt:disconnect', data),
    status: (data: { connectionId: string }) =>
      ipcRenderer.invoke('postly:mqtt:status', data),
    onEvent: (cb: (data: unknown) => void) => {
      const handler = (_: unknown, data: unknown) => cb(data)
      ipcRenderer.on('postly:mqtt:event', handler)
      return () => ipcRenderer.removeListener('postly:mqtt:event', handler)
    },
  },
  integrations: {
    list: () => ipcRenderer.invoke('postly:integrations:list'),
    create: (data: { type: string; name: string; baseUrl: string; clientId?: string; clientSecret?: string; repo?: string; branch?: string }) => ipcRenderer.invoke('postly:integrations:create', data),
    update: (data: { id: string; [key: string]: unknown }) => ipcRenderer.invoke('postly:integrations:update', data),
    delete: (data: { id: string }) => ipcRenderer.invoke('postly:integrations:delete', data),
    connect: (data: { id: string }) => ipcRenderer.invoke('postly:integrations:connect', data),
    disconnect: (data: { id: string }) => ipcRenderer.invoke('postly:integrations:disconnect', data),
    deviceInit: (data: { id: string }) => ipcRenderer.invoke('postly:integrations:device-init', data),
    devicePoll: (data: { id: string }) => ipcRenderer.invoke('postly:integrations:device-poll', data),
  },
  git: {
    currentBranch: (data: { integrationId: string }) => ipcRenderer.invoke('postly:git:current-branch', data),
    listBranches: (data: { integrationId: string }) => ipcRenderer.invoke('postly:git:branches:list', data),
    createBranch: (data: { integrationId: string; newBranch: string; fromBranch: string }) => ipcRenderer.invoke('postly:git:branch:create', data),
    switchBranch: (data: { integrationId: string; branch: string }) => ipcRenderer.invoke('postly:git:branch:switch', data),
    sync: (data: { integrationId: string; collectionId?: string; collectionName?: string }) => ipcRenderer.invoke('postly:git:sync', data),
    diff: (data: { requestId: string }) => ipcRenderer.invoke('postly:git:diff', data),
    commit: (data: { requestId: string; commitMessage: string; branch: string; fromBranch?: string }) => ipcRenderer.invoke('postly:git:commit', data),
    pushCollection: (data: { collectionId: string; commitMessage: string; branch: string }) => ipcRenderer.invoke('postly:git:push-collection', data),
    dirtyRequests: (data: { collectionId: string }) => ipcRenderer.invoke('postly:git:dirty-requests', data),
    import: (data: { integrationId: string; collectionId?: string; collectionName: string }) => ipcRenderer.invoke('postly:git:import', data),
  },
  ai: {
    chat: (data: { requestId: string; provider: string; apiKey: string; model: string; messages: unknown[] }) =>
      ipcRenderer.invoke('postly:ai:chat', data),
    cancel: (data: { requestId: string }) => ipcRenderer.invoke('postly:ai:cancel', data),
    onChunk: (cb: (payload: { requestId: string; text: string; done: boolean; error?: string }) => void) => {
      const handler = (_: unknown, payload: unknown) => cb(payload as { requestId: string; text: string; done: boolean; error?: string })
      ipcRenderer.on('postly:ai:chunk', handler)
      return () => ipcRenderer.removeListener('postly:ai:chunk', handler)
    },
  },
  exportImport: {
    export: (data?: { collectionIds?: string[] }) => ipcRenderer.invoke('postly:export', data ?? {}),
    import: () => ipcRenderer.invoke('postly:import'),
    importCollections: (data: { collections: unknown[] }) => ipcRenderer.invoke('postly:import:collections', data),
  },
  reorder: (data: { type: 'request' | 'group'; updates: Array<{ id: string; sortOrder: number; newParentId?: string }> }) =>
    ipcRenderer.invoke('postly:reorder', data),
}

contextBridge.exposeInMainWorld('api', api)

export type ApiType = typeof api
