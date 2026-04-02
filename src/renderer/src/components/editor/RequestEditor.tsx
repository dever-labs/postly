import { Save, ChevronRight, HardDrive, GitFork, GitBranch, Box, FolderOpen, Folder } from 'lucide-react'
import React, { useEffect, useMemo } from 'react'
import type { HttpMethod, BodyType, AuthType, SslVerification, ProtocolType, KeyValuePair } from '@/types'
import { MethodSelector } from '@/components/editor/MethodSelector'
import { UrlBar } from '@/components/editor/UrlBar'
import { SendButton } from '@/components/editor/SendButton'
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
      className="no-drag flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-th-text-faint hover:bg-th-surface-hover hover:text-th-text-secondary focus:outline-hidden"
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
  const { editingRequest, isLoading, updateField, sendRequest, saveRequest, discardDraft } = useRequestsStore()
  const collections = useCollectionsStore((s) => s.collections)
  const groups = useCollectionsStore((s) => s.groups)
  const integrations = useIntegrationsStore((s) => s.integrations)
  const { selectItem } = useUIStore()
  const openGitAction = useUIStore((s) => s.openGitAction)

  // no per-request title state needed — input is always rendered

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

  const triggerGitSave = () => {
    if (!editingRequest || !breadcrumb?.collection) return
    const isGit = ['git', 'github', 'gitlab'].includes(breadcrumb.sourceType)
    if (isGit) {
      openGitAction({
        type: 'push',
        collectionId: breadcrumb.collection.id,
        title: `Updated '${editingRequest.name}'`,
        subtitle: breadcrumb.collection.name,
      })
    }
  }

  // Ctrl+S: save the request, then show commit overlay for git-sourced requests
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && !e.shiftKey) {
        e.preventDefault()
        if (!editingRequest) return
        saveRequest().then(triggerGitSave)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editingRequest, saveRequest, breadcrumb, openGitAction])

  if (!editingRequest) {
    return (
      <div className="flex h-full flex-col bg-th-bg">
        <div className="drag-region shrink-0 px-4 pt-8 pb-4" />
        <div className="flex flex-1 items-center justify-center text-sm text-th-text-faint">
          Select or create a request
        </div>
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
      <div className="drag-region flex flex-col gap-2 border-b border-th-border px-4 pt-8 pb-3">
        {breadcrumb && (
          <div className="inline-flex items-center gap-1.5 text-xs flex-wrap">
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
        <input
          className="no-drag -mx-1.5 cursor-text rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-medium text-th-text-primary placeholder:text-th-text-faint outline-hidden transition-colors hover:border-th-border hover:bg-th-surface-hover focus:border-th-border-strong focus:bg-th-surface"
          placeholder="Request name"
          value={editingRequest.name}
          onChange={(e) => updateField('name', e.target.value)}
        />
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
          onClick={async () => {
            await saveRequest()
            triggerGitSave()
          }}
          className={`rounded-sm p-1.5 hover:bg-th-surface-raised focus:outline-hidden ${editingRequest.isDirty ? 'text-amber-400 hover:text-amber-300' : 'text-th-text-subtle hover:text-th-text-secondary'}`}
          title={editingRequest.isDirty ? 'Unsaved changes — click to save' : 'Save'}
        >
          <Save className="h-4 w-4" />
        </button>
        {editingRequest.isDirty && (
          <button
            onClick={discardDraft}
            className="rounded-sm px-2 py-1 text-xs text-th-text-subtle hover:bg-th-surface-raised hover:text-th-text-primary focus:outline-hidden"
            title="Discard unsaved changes"
          >
            Discard
          </button>
        )}
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
    </div>
  )
}
