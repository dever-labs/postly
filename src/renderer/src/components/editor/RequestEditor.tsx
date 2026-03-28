import { Save } from 'lucide-react'
import React, { useMemo } from 'react'
import type { HttpMethod, BodyType, AuthType } from '@/types'
import { MethodSelector } from '@/components/editor/MethodSelector'
import { UrlBar } from '@/components/editor/UrlBar'
import { SendButton } from '@/components/editor/SendButton'
import { CommitPanel } from '@/components/editor/CommitPanel'
import { ParamsTab } from '@/components/editor/tabs/ParamsTab'
import { HeadersTab } from '@/components/editor/tabs/HeadersTab'
import { BodyTab } from '@/components/editor/tabs/BodyTab'
import { AuthTab } from '@/components/editor/tabs/AuthTab'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { useRequestsStore } from '@/store/requests'
import { useCollectionsStore } from '@/store/collections'

export function RequestEditor() {
  const { editingRequest, isLoading, updateField, sendRequest, saveRequest } = useRequestsStore()
  const collections = useCollectionsStore((s) => s.collections)
  const groups = useCollectionsStore((s) => s.groups)

  const source = useMemo(() => {
    if (!editingRequest) return undefined
    const group = groups.find((g) => g.id === editingRequest.groupId)
    const col = group ? collections.find((c) => c.id === group.collectionId) : undefined
    return col?.source
  }, [editingRequest, groups, collections])

  if (!editingRequest) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-600">
        Select or create a request
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-neutral-950">
      {/* Request name */}
      <div className="border-b border-neutral-800 px-4 py-2">
        <input
          className="w-full bg-transparent text-sm font-medium text-neutral-200 focus:outline-none placeholder:text-neutral-600"
          placeholder="Request name"
          value={editingRequest.name}
          onChange={(e) => updateField('name', e.target.value)}
        />
      </div>

      {/* URL bar */}
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
        <MethodSelector
          value={editingRequest.method as HttpMethod}
          onChange={(m) => updateField('method', m)}
        />
        <UrlBar
          value={editingRequest.url}
          onChange={(url) => updateField('url', url)}
          onSend={sendRequest}
        />
        <SendButton onClick={sendRequest} isLoading={isLoading} />
        <button
          onClick={saveRequest}
          className="rounded p-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-300 focus:outline-none"
          title="Save"
        >
          <Save className="h-4 w-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex-1 overflow-auto">
        <Tabs defaultValue="params">
          <TabsList className="px-3">
            <TabsTrigger value="params">Params</TabsTrigger>
            <TabsTrigger value="headers">Headers</TabsTrigger>
            <TabsTrigger value="body">Body</TabsTrigger>
            <TabsTrigger value="auth">Auth</TabsTrigger>
          </TabsList>
          <TabsContent value="params">
            <ParamsTab
              params={editingRequest.params}
              onChange={(p) => updateField('params', p)}
            />
          </TabsContent>
          <TabsContent value="headers">
            <HeadersTab
              params={editingRequest.headers}
              onChange={(h) => updateField('headers', h)}
            />
          </TabsContent>
          <TabsContent value="body">
            <BodyTab
              bodyType={editingRequest.bodyType as BodyType}
              bodyContent={editingRequest.bodyContent}
              onTypeChange={(t) => updateField('bodyType', t)}
              onContentChange={(c) => updateField('bodyContent', c)}
            />
          </TabsContent>
          <TabsContent value="auth">
            <AuthTab
              authType={editingRequest.authType as AuthType}
              authConfig={editingRequest.authConfig}
              onTypeChange={(t) => updateField('authType', t)}
              onConfigChange={(c) => updateField('authConfig', c)}
            />
          </TabsContent>
        </Tabs>
      </div>

      {/* Commit panel for SCM-backed requests */}
      {editingRequest.isDirty && (source === 'github' || source === 'gitlab') && (
        <CommitPanel requestId={editingRequest.id} source={source} />
      )}
    </div>
  )
}
