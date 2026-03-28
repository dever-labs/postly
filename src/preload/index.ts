import { contextBridge, ipcRenderer } from 'electron'

const api = {
  collections: {
    list: () => ipcRenderer.invoke('postly:collections:list'),
    create: (data: { name: string; source?: string }) => ipcRenderer.invoke('postly:collections:create', data),
    delete: (data: { id: string }) => ipcRenderer.invoke('postly:collections:delete', data),
    rename: (data: { id: string; name: string }) => ipcRenderer.invoke('postly:collections:rename', data),
  },
  groups: {
    create: (data: { collectionId: string; name: string; description?: string }) => ipcRenderer.invoke('postly:groups:create', data),
    delete: (data: { id: string }) => ipcRenderer.invoke('postly:groups:delete', data),
    update: (data: { id: string; collapsed?: boolean; hidden?: boolean; name?: string }) => ipcRenderer.invoke('postly:groups:update', data),
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
  },
  environments: {
    list: () => ipcRenderer.invoke('postly:environments:list'),
    create: (data: { name: string }) => ipcRenderer.invoke('postly:environments:create', data),
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
  },
  gitlab: {
    sync: () => ipcRenderer.invoke('postly:gitlab:sync'),
    listBranches: (data: { projectId: string }) => ipcRenderer.invoke('postly:gitlab:branches:list', data),
    createBranch: (data: { projectId: string; newBranch: string; fromBranch: string }) => ipcRenderer.invoke('postly:gitlab:branch:create', data),
    commit: (data: unknown) => ipcRenderer.invoke('postly:gitlab:commit', data),
    diff: (data: { requestId: string }) => ipcRenderer.invoke('postly:gitlab:diff', data),
  },
  settings: {
    get: (data: { key: string }) => ipcRenderer.invoke('postly:settings:get', data),
    set: (data: { key: string; value: unknown }) => ipcRenderer.invoke('postly:settings:set', data),
    getAll: () => ipcRenderer.invoke('postly:settings:get-all'),
  },
}

contextBridge.exposeInMainWorld('api', api)

export type ApiType = typeof api
