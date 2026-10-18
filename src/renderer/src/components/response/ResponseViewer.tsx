import { SendHorizonal } from 'lucide-react'
import React, { Suspense, lazy, useEffect, useState } from 'react'
import { ResponseStatus } from '@/components/response/ResponseStatus'
import { ResponseActions } from '@/components/response/ResponseActions'
import { ResponseNotice } from '@/components/response/ResponseNotice'
import { RawTab } from '@/components/response/tabs/RawTab'
import { PreviewTab } from '@/components/response/tabs/PreviewTab'
import { CookiesTab } from '@/components/response/tabs/CookiesTab'
import { StreamTab } from '@/components/response/tabs/StreamTab'
import { ConsoleTab } from '@/components/response/tabs/ConsoleTab'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { useRequestsStore } from '@/store/requests'
import { prettyBody } from '@/lib/responseBody'
import { cn } from '@/lib/utils'

// Monaco-backed tab is loaded on demand so the editor bundle stays out of startup.
const PrettyTab = lazy(() => import('@/components/response/tabs/PrettyTab').then((m) => ({ default: m.PrettyTab })))

export function ResponseViewer() {
  const response = useRequestsStore((state) => state.response)
  const isLoading = useRequestsStore((state) => state.isLoading)
  const stream = useRequestsStore((state) => state.stream)
  const resumeStream = useRequestsStore((state) => state.resumeStream)
  const streaming = !!stream
  const [tab, setTab] = useState(streaming ? 'stream' : 'pretty')
  useEffect(() => { setTab(streaming ? 'stream' : 'pretty') }, [streaming])

  if (isLoading && !stream) {
    return (
      <div data-testid="response-loading" className="flex h-full items-center justify-center gap-2 text-sm text-th-text-subtle">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-th-border-strong border-t-th-text-secondary" />
        Sending request...
      </div>
    )
  }

  if (!response) {
    return (
      <div data-testid="response-empty" className="flex h-full flex-col items-center justify-center gap-2 text-th-text-faint">
        <SendHorizonal className="h-8 w-8 opacity-40" />
        <span className="text-sm">Send a request to see the response</span>
      </div>
    )
  }

  const contentType = response.headers['content-type'] ?? response.headers['Content-Type'] ?? ''
  const logs = response.logs ?? []
  const cookies = response.cookies ?? []
  const alertCount = logs.filter((e) => e.level === 'warn' || e.level === 'error').length

  return (
    <div data-testid="response-panel" className="flex h-full flex-col bg-th-bg">
      {/* Status bar */}
      <div data-testid="response-status" className="flex items-center justify-between border-b border-th-border px-4 py-2">
        <ResponseStatus response={response} />
        <ResponseActions
          copyText={response.binary ? null : tab === 'raw' ? response.body : prettyBody(response.body, contentType)}
          bodyId={response.bodyId}
          canSave={!!response.bodyId || !!response.bodyTooLarge}
        />
      </div>

      <ResponseNotice response={response} contentType={contentType} />

      {/* Tabs */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Tabs key={stream ? 'stream' : 'plain'} value={tab} onValueChange={setTab} className="flex h-full flex-col">
          <TabsList className="px-3">
            {stream && <TabsTrigger value="stream" data-testid="stream-tab-trigger">Stream</TabsTrigger>}
            <TabsTrigger value="pretty">Pretty</TabsTrigger>
            <TabsTrigger value="raw">Raw</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
            <TabsTrigger value="headers">Headers</TabsTrigger>
            <TabsTrigger value="cookies" data-testid="cookies-tab" className="flex items-center gap-1.5">
              Cookies
              {cookies.length > 0 && (
                <span className="rounded-sm bg-th-surface-raised px-1 py-0.5 text-[9px] font-bold text-th-text-muted">{cookies.length}</span>
              )}
            </TabsTrigger>
            <TabsTrigger value="console" className="flex items-center gap-1.5">
              Console
              {alertCount > 0 && (
                <span className={cn(
                  'rounded-sm px-1 py-0.5 text-[9px] font-bold',
                  logs.some((e) => e.level === 'error')
                    ? 'bg-rose-900/50 text-rose-400 light:text-rose-800'
                    : 'bg-amber-900/50 text-amber-400 light:text-amber-800'
                )}>
                  {alertCount}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {stream && (
            <TabsContent value="stream" className="flex-1 overflow-hidden">
              <StreamTab stream={stream} onResume={resumeStream} />
            </TabsContent>
          )}

          <TabsContent value="pretty" className="flex-1 overflow-hidden">
            <Suspense fallback={null}>
              <PrettyTab body={response.body} contentType={contentType} />
            </Suspense>
          </TabsContent>

          <TabsContent value="raw" className="flex-1 overflow-hidden">
            <RawTab body={response.body} />
          </TabsContent>

          <TabsContent value="preview" className="flex-1 overflow-hidden">
            <PreviewTab body={response.body} contentType={contentType} bodyId={response.bodyId} binary={response.binary} />
          </TabsContent>

          <TabsContent value="headers" className="flex-1 overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-th-border">
                  <th className="px-4 py-2 text-left font-medium text-th-text-subtle">Name</th>
                  <th className="px-4 py-2 text-left font-medium text-th-text-subtle">Value</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(response.headers).map(([k, v]) => (
                  <tr key={k} className="border-b border-th-surface hover:bg-th-surface/50">
                    <td className="px-4 py-1.5 font-mono text-th-text-muted">{k}</td>
                    <td className="px-4 py-1.5 text-th-text-secondary break-all whitespace-pre-wrap">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabsContent>

          <TabsContent value="cookies" className="flex-1 overflow-auto">
            <CookiesTab cookies={cookies} />
          </TabsContent>

          <TabsContent value="console" className="flex-1 overflow-hidden">
            <ConsoleTab logs={logs} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
