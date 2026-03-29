import { Save, ChevronRight, HardDrive, GitFork, GitBranch, Box, FolderOpen, Folder } from 'lucide-react'
import React, { useMemo } from 'react'
import type { HttpMethod, BodyType, AuthType, SslVerification } from '@/types'
import { MethodSelector } from '@/components/editor/MethodSelector'
import { UrlBar } from '@/components/editor/UrlBar'
import { SendButton } from '@/components/editor/SendButton'
import { CommitPanel } from '@/components/editor/CommitPanel'
import { ParamsTab } from '@/components/editor/tabs/ParamsTab'
import { HeadersTab } from '@/components/editor/tabs/HeadersTab'
import { BodyTab } from '@/components/editor/tabs/BodyTab'
import { AuthTab } from '@/components/editor/tabs/AuthTab'
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
      className="flex items-center gap-1 text-th-text-faint hover:text-th-text-secondary hover:underline focus:outline-none"
    >
      {icon}
      <span>{label}</span>
    </button>
  ) : (
    <span className="flex items-center gap-1 text-th-text-subtle">
      {icon}
      <span>{label}</span>
    </span>
  )
}

export function RequestEditor() {
  const { editingRequest, isLoading, updateField, sendRequest, saveRequest } = useRequestsStore()
  const collections = useCollectionsStore((s) => s.collections)
  const groups = useCollectionsStore((s) => s.groups)
  const integrations = useIntegrationsStore((s) => s.integrations)
  const selectItem = useUIStore((s) => s.selectItem)

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
      <div className="flex h-full items-center justify-center text-sm text-th-text-faint">
        Select or create a request
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-th-bg">
      {/* Breadcrumb + request name */}
      <div className="border-b border-th-border px-4 py-2">
        {breadcrumb && (
          <div className="mb-1 flex items-center gap-1.5 text-xs flex-wrap">
            <BreadcrumbItem
              icon={sourceIcon(breadcrumb.sourceType)}
              label={breadcrumb.sourceLabel}
            />
            {breadcrumb.collection && (
              <>
                <ChevronRight className="h-3 w-3 shrink-0 text-th-text-faint" />
                <BreadcrumbItem
                  icon={<FolderOpen className="h-3 w-3" />}
                  label={breadcrumb.collection.name}
                  onClick={() => selectItem('collection', breadcrumb.collection!.id)}
                />
              </>
            )}
            {breadcrumb.group && (
              <>
                <ChevronRight className="h-3 w-3 shrink-0 text-th-text-faint" />
                <BreadcrumbItem
                  icon={<Folder className="h-3 w-3" />}
                  label={breadcrumb.group.name}
                  onClick={() => selectItem('group', breadcrumb.group!.id)}
                />
              </>
            )}
          </div>
        )}
        <input
          className="w-full bg-transparent text-sm font-medium text-th-text-primary focus:outline-none placeholder:text-th-text-faint"
          placeholder="Request name"
          value={editingRequest.name}
          onChange={(e) => updateField('name', e.target.value)}
        />
      </div>

      {/* URL bar */}
      <div className="flex items-center gap-2 border-b border-th-border px-3 py-2">
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
          className="rounded p-1.5 text-th-text-subtle hover:bg-th-surface-raised hover:text-th-text-secondary focus:outline-none"
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
            <TabsTrigger value="settings">Settings</TabsTrigger>
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
      </div>

      {/* Commit panel for SCM-backed requests */}
      {editingRequest.isDirty && (source === 'github' || source === 'gitlab') && (
        <CommitPanel requestId={editingRequest.id} source={source} />
      )}
    </div>
  )
}
