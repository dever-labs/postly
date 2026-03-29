import { Copy, SendHorizonal } from 'lucide-react'
import React, { useState } from 'react'
import { ResponseStatus } from '@/components/response/ResponseStatus'
import { PrettyTab } from '@/components/response/tabs/PrettyTab'
import { RawTab } from '@/components/response/tabs/RawTab'
import { PreviewTab } from '@/components/response/tabs/PreviewTab'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { useRequestsStore } from '@/store/requests'
import { cn } from '@/lib/utils'

export function ResponseViewer() {
  const { response, isLoading } = useRequestsStore()
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!response) return
    await navigator.clipboard.writeText(response.body)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-th-text-subtle">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-th-border-strong border-t-th-text-secondary" />
        Sending request...
      </div>
    )
  }

  if (!response) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-th-text-faint">
        <SendHorizonal className="h-8 w-8 opacity-40" />
        <span className="text-sm">Send a request to see the response</span>
      </div>
    )
  }

  const contentType = response.headers['content-type'] ?? response.headers['Content-Type'] ?? ''

  return (
    <div className="flex h-full flex-col bg-th-bg">
      {/* Status bar */}
      <div className="flex items-center justify-between border-b border-th-border px-4 py-2">
        <ResponseStatus response={response} />
        <button
          onClick={handleCopy}
          className={cn(
            'flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors focus:outline-none',
            copied
              ? 'text-emerald-400'
              : 'text-th-text-subtle hover:bg-th-surface-raised hover:text-th-text-secondary'
          )}
        >
          <Copy className="h-3.5 w-3.5" />
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Tabs defaultValue="pretty" className="flex h-full flex-col">
          <TabsList className="px-3">
            <TabsTrigger value="pretty">Pretty</TabsTrigger>
            <TabsTrigger value="raw">Raw</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
            <TabsTrigger value="headers">Headers</TabsTrigger>
          </TabsList>

          <TabsContent value="pretty" className="flex-1 overflow-hidden">
            <PrettyTab body={response.body} contentType={contentType} />
          </TabsContent>

          <TabsContent value="raw" className="flex-1 overflow-hidden">
            <RawTab body={response.body} />
          </TabsContent>

          <TabsContent value="preview" className="flex-1 overflow-hidden">
            <PreviewTab body={response.body} />
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
                    <td className="px-4 py-1.5 text-th-text-secondary break-all">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
