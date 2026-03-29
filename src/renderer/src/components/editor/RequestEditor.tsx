import { Save, ChevronRight, HardDrive, GitFork, GitBranch, Box, FolderOpen, Folder, Pencil } from 'lucide-react'
import React, { useMemo, useRef, useState } from 'react'
import type { HttpMethod, BodyType, AuthType, SslVerification, ProtocolType, KeyValuePair } from '@/types'
import { MethodSelector } from '@/components/editor/MethodSelector'
import { UrlBar } from '@/components/editor/UrlBar'
import { SendButton } from '@/components/editor/SendButton'
import { CommitPanel } from '@/components/editor/CommitPanel'
import { ProtocolSelector } from '@/components/editor/ProtocolSelector'
import { WebSocketView } from '@/components/editor/WebSocketView'
import { GrpcView } from '@/components/editor/GrpcView'
import { MqttView } from '@/components/editor/MqttView'
import { ParamsTab } from '@/components/editor/tabs/ParamsTab'
import { HeadersTab } from '@/components/editor/tabs/HeadersTab'
import { BodyTab } from '@/components/editor/tabs/BodyTab'
import { AuthTab } from '@/components/editor/tabs/AuthTab'
import { GraphQLTab } from '@/components/editor/tabs/GraphQLTab'
import { SslEditor } from '@/components/editor/SslEditor'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { useRequestsStore } from '@/store/requests'
import { useCollectionsStore } from '@/store/collections'
import { useIntegrationsStore } from '@/store/integrations'
import { useUIStore } from '@/store/ui'

function BreadcrumbItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick?: () => void
}) {
  return onClick ? (
    <button
      onClick={onClick}
      className="no-drag flex items-center gap-1 rounded px-1.5 py-0.5 text-th-text-faint hover:bg-th-surface-hover hover:text-th-text-secondary focus:outline-none"
    >
      {icon}
      <span>{label}</span>
    </button>
  ) : (
    <span className="flex items-center gap-1 px-1.5 py-0.5 text-th-text-subtle">
      {icon}
      <span>{label}</span>
    </span>
  )
}

/** Read a protocolConfig key, returning '' if missing */
function pcGet(config: Record<string, string>, key: string): string {
  return config[key] ?? ''
}

export function RequestEditor() {
  const { editingRequest, isLoading, updateField, sendRequest, saveRequest } = useRequestsStore()
  const collections = useCollectionsStore((s) => s.collections)
  const groups = useCollectionsStore((s) => s.groups)
  const integrations = useIntegrationsStore((s) => s.integrations)
  const selectItem = useUIStore((s) => s.selectItem)

  const [editingTitle, setEditingTitle] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)

  const breadcrumb = useMemo(() => {
    if (!editingRequest) return null
    const group = groups.find((g) => g.id === editingRequest.groupId)
    const collection = group ? collections.find((c) => c.id === group.collectionId) : undefined
    const integration = collection?.integrationId
      ? integrations.find((i) => i.id === collection.integrationId)
      : null
    const sourceLabel = integration ? integration.name : 'Local'
    const sourceType = collection?.source ?? 'local'
    return { group, collection, integration, sourceLabel, sourceType }
  }, [editingRequest, groups, collections, integrations])

  const sourceIcon = (type: string) => {
    if (type === 'github') return <GitFork className="h-3 w-3" />
    if (type === 'gitlab') return <GitBranch className="h-3 w-3" />
    if (type === 'backstage') return <Box className="h-3 w-3" />
    return <HardDrive className="h-3 w-3" />
  }

  const source = breadcrumb?.sourceType

  if (!editingRequest) {
    return (
      <div className="drag-region flex h-full items-center justify-center text-sm text-th-text-faint">
        Select or create a request
      </div>
    )
  }

  const protocol = (editingRequest.protocol ?? 'http') as ProtocolType
  const pc = editingRequest.protocolConfig ?? {}

  const updatePc = (key: string, value: string) => {
    updateField('protocolConfig', { ...pc, [key]: value })
  }

  const metadataFromPc = (): KeyValuePair[] => {
    try { return JSON.parse(pc.metadata ?? '[]') } catch { return [] }
  }

  return (
    <div className="flex h-full flex-col bg-th-bg">
      {/* Breadcrumb + request name — drag-region; pt-8 gives 32px drag
          target above content. Only interactive buttons are no-drag. */}
      <div className="drag-region border-b border-th-border px-4 pt-8 pb-4">
        {breadcrumb && (
          <div className="mb-3 inline-flex items-center gap-1.5 text-xs flex-wrap">
            <BreadcrumbItem icon={sourceIcon(breadcrumb.sourceType)} label={breadcrumb.sourceLabel} />
            {breadcrumb.collection && (
              <>
                <ChevronRight className="h-3 w-3 shrink-0 text-th-text-faint" />
                <BreadcrumbItem
                  icon={<FolderOpen className="h-3 w-3" />}
                  label={breadcrumb.collection.name}
                  onClick={() => selectItem('collection', breadcrumb.collection?.id ?? '')}
                />
              </>
            )}
            {breadcrumb.group && (
              <>
                <ChevronRight className="h-3 w-3 shrink-0 text-th-text-faint" />
                <BreadcrumbItem
                  icon={<Folder className="h-3 w-3" />}
                  label={breadcrumb.group.name}
                  onClick={() => selectItem('group', breadcrumb.group?.id ?? '')}
                />
              </>
            )}
          </div>
        )}
        {editingTitle ? (
          <input
            ref={titleInputRef}
            className="no-drag w-full border-b border-th-border-strong bg-transparent text-sm font-medium text-th-text-primary focus:outline-none placeholder:text-th-text-faint"
            placeholder="Request name"
            value={editingRequest.name}
            onChange={(e) => updateField('name', e.target.value)}
            onBlur={() => setEditingTitle(false)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.currentTarget.blur() } }}
            autoFocus
          />
        ) : (
          <div className="group flex items-center gap-1.5">
            <span className="text-sm font-medium text-th-text-primary">
              {editingRequest.name || <span className="text-th-text-faint">Request name</span>}
            </span>
            <button
              onClick={() => { setEditingTitle(true); setTimeout(() => titleInputRef.current?.focus(), 0) }}
              className="no-drag opacity-0 group-hover:opacity-100 rounded p-0.5 text-th-text-faint hover:text-th-text-primary hover:bg-th-surface-hover transition-opacity focus:opacity-100 focus:outline-none"
              title="Rename request"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Protocol selector + URL bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-th-border px-3 py-2">
        <ProtocolSelector
          value={protocol}
          onChange={(p) => {
            updateField('protocol', p)
            // set sensible default URL scheme prefix hint
          }}
        />
        {protocol === 'http' && (
          <MethodSelector
            value={editingRequest.method as HttpMethod}
            onChange={(m) => updateField('method', m)}
          />
        )}
        <UrlBar
          value={editingRequest.url}
          onChange={(url) => updateField('url', url)}
          onSend={protocol === 'http' || protocol === 'graphql' ? sendRequest : undefined}
        />
        {(protocol === 'http' || protocol === 'graphql') && (
          <SendButton onClick={sendRequest} isLoading={isLoading} />
        )}
        <button
          onClick={saveRequest}
          className="rounded p-1.5 text-th-text-subtle hover:bg-th-surface-raised hover:text-th-text-secondary focus:outline-none"
          title="Save"
        >
          <Save className="h-4 w-4" />
        </button>
      </div>

      {/* Protocol-specific content area */}
      <div className="flex-1 overflow-hidden">
        {protocol === 'websocket' && (
          <WebSocketView
            url={editingRequest.url}
            headers={editingRequest.headers}
            onHeadersChange={(h) => updateField('headers', h)}
          />
        )}

        {protocol === 'grpc' && (
          <GrpcView
            serverUrl={editingRequest.url}
            protoContent={pcGet(pc, 'protoContent')}
            serviceName={pcGet(pc, 'service')}
            methodName={pcGet(pc, 'method')}
            requestBody={editingRequest.bodyContent}
            metadata={metadataFromPc()}
            useTls={pcGet(pc, 'useTls') === 'true'}
            onProtoChange={(v) => updatePc('protoContent', v)}
            onServiceChange={(v) => updatePc('service', v)}
            onMethodChange={(v) => updatePc('method', v)}
            onRequestBodyChange={(v) => updateField('bodyContent', v)}
            onMetadataChange={(v) => updatePc('metadata', JSON.stringify(v))}
            onUseTlsChange={(v) => updatePc('useTls', v ? 'true' : 'false')}
          />
        )}

        {protocol === 'mqtt' && (
          <MqttView
            clientId={pcGet(pc, 'clientId')}
            username={pcGet(pc, 'username')}
            password={pcGet(pc, 'password')}
            keepAlive={pcGet(pc, 'keepAlive')}
            cleanSession={pcGet(pc, 'cleanSession')}
            subscriptions={pcGet(pc, 'subscriptions')}
            onConfigChange={(key, value) => updatePc(key, value)}
          />
        )}

        {(protocol === 'http' || protocol === 'graphql') && (
          <Tabs defaultValue={protocol === 'graphql' ? 'query' : 'params'}>
            <TabsList className="px-3">
              {protocol === 'graphql' ? (
                <TabsTrigger value="query">Query</TabsTrigger>
              ) : (
                <TabsTrigger value="params">Params</TabsTrigger>
              )}
              <TabsTrigger value="headers">Headers</TabsTrigger>
              {protocol === 'http' && <TabsTrigger value="body">Body</TabsTrigger>}
              <TabsTrigger value="auth">Auth</TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>

            {protocol === 'graphql' && (
              <TabsContent value="query">
                <GraphQLTab
                  query={editingRequest.bodyContent}
                  variables={pcGet(pc, 'variables')}
                  operationName={pcGet(pc, 'operationName')}
                  onQueryChange={(v) => updateField('bodyContent', v)}
                  onVariablesChange={(v) => updatePc('variables', v)}
                  onOperationNameChange={(v) => updatePc('operationName', v)}
                />
              </TabsContent>
            )}

            {protocol === 'http' && (
              <>
                <TabsContent value="params">
                  <ParamsTab params={editingRequest.params} onChange={(p) => updateField('params', p)} />
                </TabsContent>
                <TabsContent value="body">
                  <BodyTab
                    bodyType={editingRequest.bodyType as BodyType}
                    bodyContent={editingRequest.bodyContent}
                    onTypeChange={(t) => updateField('bodyType', t)}
                    onContentChange={(c) => updateField('bodyContent', c)}
                  />
                </TabsContent>
              </>
            )}

            <TabsContent value="headers">
              <HeadersTab params={editingRequest.headers} onChange={(h) => updateField('headers', h)} />
            </TabsContent>
            <TabsContent value="auth">
              <AuthTab
                authType={editingRequest.authType as AuthType}
                authConfig={editingRequest.authConfig}
                onTypeChange={(t) => updateField('authType', t)}
                onConfigChange={(c) => updateField('authConfig', c)}
              />
            </TabsContent>
            <TabsContent value="settings">
              <div className="flex flex-col gap-4 p-3">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-th-text-subtle">SSL Verification</p>
                  <SslEditor
                    value={(editingRequest.sslVerification as SslVerification) ?? 'inherit'}
                    onChange={(v) => updateField('sslVerification', v)}
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </div>

      {/* Commit panel for SCM-backed requests */}
      {editingRequest.isDirty && (source === 'github' || source === 'gitlab') && (
        <CommitPanel requestId={editingRequest.id} source={source} />
      )}
    </div>
  )
}


