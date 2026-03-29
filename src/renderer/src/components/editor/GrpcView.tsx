import React, { useState } from 'react'
import { Play, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { KeyValuePair } from '@/types'

interface GrpcServiceMethod {
  name: string
  requestStream: boolean
  responseStream: boolean
}

interface GrpcServiceInfo {
  [serviceName: string]: GrpcServiceMethod[]
}

interface GrpcViewProps {
  serverUrl: string
  protoContent: string
  serviceName: string
  methodName: string
  requestBody: string
  metadata: KeyValuePair[]
  useTls: boolean
  onProtoChange: (v: string) => void
  onServiceChange: (v: string) => void
  onMethodChange: (v: string) => void
  onRequestBodyChange: (v: string) => void
  onMetadataChange: (v: KeyValuePair[]) => void
  onUseTlsChange: (v: boolean) => void
}

export function GrpcView({
  serverUrl,
  protoContent,
  serviceName,
  methodName,
  requestBody,
  metadata,
  useTls,
  onProtoChange,
  onServiceChange,
  onMethodChange,
  onRequestBodyChange,
  onMetadataChange,
  onUseTlsChange,
}: GrpcViewProps) {
  const [services, setServices] = useState<GrpcServiceInfo>({})
  const [loadingProto, setLoadingProto] = useState(false)
  const [protoError, setProtoError] = useState<string | null>(null)
  const [invoking, setInvoking] = useState(false)
  const [response, setResponse] = useState<{ data?: unknown; error?: string; duration?: number } | null>(null)

  const loadProto = async () => {
    if (!protoContent.trim()) return
    setLoadingProto(true)
    setProtoError(null)
    const { data, error } = await (window as any).api.grpc.loadProto({ protoContent })
    setLoadingProto(false)
    if (error) { setProtoError(error); return }
    setServices(data as GrpcServiceInfo)
    const serviceNames = Object.keys(data as GrpcServiceInfo)
    if (serviceNames.length === 1) {
      onServiceChange(serviceNames[0])
      const methods = (data as GrpcServiceInfo)[serviceNames[0]]
      if (methods.length === 1) onMethodChange(methods[0].name)
    }
  }

  const invoke = async () => {
    if (!serverUrl.trim() || !serviceName || !methodName) return
    setInvoking(true)
    setResponse(null)
    const meta: Record<string, string> = {}
    metadata.filter((m) => m.enabled && m.key).forEach((m) => { meta[m.key] = m.value })
    const result = await (window as any).api.grpc.invoke({
      serverUrl, protoContent, serviceName, methodName,
      metadata: meta, requestBody: requestBody || '{}', useTls,
    })
    setInvoking(false)
    setResponse(result)
  }

  const serviceNames = Object.keys(services)
  const methods = (serviceName && services[serviceName]) ? services[serviceName] : []

  const addMetaRow = () => {
    onMetadataChange([...metadata, { id: crypto.randomUUID(), key: '', value: '', enabled: true }])
  }

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="grid grid-cols-2 gap-0 divide-x divide-th-border" style={{ minHeight: '100%' }}>

        {/* Left: config */}
        <div className="flex flex-col gap-4 overflow-y-auto p-3">
          {/* TLS toggle */}
          <div className="flex items-center gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-th-text-subtle">
              <input type="checkbox" checked={useTls} onChange={(e) => onUseTlsChange(e.target.checked)}
                className="rounded" />
              Use TLS
            </label>
          </div>

          {/* Proto definition */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-th-text-subtle">Proto Definition</span>
              <button
                onClick={loadProto}
                disabled={loadingProto || !protoContent.trim()}
                className="flex items-center gap-1 rounded bg-th-surface-raised px-2 py-0.5 text-xs text-th-text-subtle hover:text-th-text-primary disabled:opacity-50 focus:outline-none"
              >
                <RefreshCw className={cn('h-3 w-3', loadingProto && 'animate-spin')} />
                {loadingProto ? 'Loading…' : 'Load Proto'}
              </button>
            </div>
            <textarea
              className="h-36 w-full resize-y rounded border border-th-border bg-th-surface px-3 py-2 font-mono text-xs text-th-text-primary placeholder-th-text-faint focus:border-th-border-strong focus:outline-none"
              placeholder={'syntax = "proto3";\nservice Greeter {\n  rpc SayHello (HelloRequest) returns (HelloReply);\n}'}
              value={protoContent}
              onChange={(e) => onProtoChange(e.target.value)}
              spellCheck={false}
            />
            {protoError && <p className="mt-1 text-xs text-rose-400">{protoError}</p>}
          </div>

          {/* Service / Method selectors */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-th-text-subtle">Service</div>
              <select
                className="w-full rounded border border-th-border bg-th-surface px-2 py-1.5 text-sm text-th-text-primary focus:border-th-border-strong focus:outline-none"
                value={serviceName}
                onChange={(e) => { onServiceChange(e.target.value); onMethodChange('') }}
              >
                <option value="">— select service —</option>
                {serviceNames.map((s) => <option key={s} value={s}>{s.split('.').pop()}</option>)}
              </select>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-th-text-subtle">Method</div>
              <select
                className="w-full rounded border border-th-border bg-th-surface px-2 py-1.5 text-sm text-th-text-primary focus:border-th-border-strong focus:outline-none"
                value={methodName}
                onChange={(e) => onMethodChange(e.target.value)}
                disabled={!serviceName}
              >
                <option value="">— select method —</option>
                {methods.map((m) => (
                  <option key={m.name} value={m.name}>
                    {m.name}{m.responseStream ? ' (stream)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Request message */}
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-th-text-subtle">
              Request Message <span className="font-normal normal-case text-th-text-faint">(JSON)</span>
            </div>
            <textarea
              className="h-32 w-full resize-y rounded border border-th-border bg-th-surface px-3 py-2 font-mono text-sm text-th-text-primary placeholder-th-text-faint focus:border-th-border-strong focus:outline-none"
              placeholder={'{\n  "name": "world"\n}'}
              value={requestBody}
              onChange={(e) => onRequestBodyChange(e.target.value)}
              spellCheck={false}
            />
          </div>

          {/* Metadata (like headers) */}
          <div>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-th-text-subtle">Metadata</div>
            <div className="flex flex-col gap-1">
              {metadata.map((m, i) => (
                <div key={m.id} className="flex gap-1">
                  <input
                    className="flex-1 rounded border border-th-border bg-th-surface px-2 py-1 text-xs text-th-text-primary placeholder-th-text-faint focus:outline-none"
                    placeholder="key"
                    value={m.key}
                    onChange={(e) => { const next = [...metadata]; next[i] = { ...m, key: e.target.value }; onMetadataChange(next) }}
                  />
                  <input
                    className="flex-1 rounded border border-th-border bg-th-surface px-2 py-1 text-xs text-th-text-primary placeholder-th-text-faint focus:outline-none"
                    placeholder="value"
                    value={m.value}
                    onChange={(e) => { const next = [...metadata]; next[i] = { ...m, value: e.target.value }; onMetadataChange(next) }}
                  />
                  <button
                    onClick={() => onMetadataChange(metadata.filter((_, j) => j !== i))}
                    className="rounded px-1 text-th-text-faint hover:text-rose-400 focus:outline-none"
                  >×</button>
                </div>
              ))}
              <button onClick={addMetaRow} className="mt-0.5 text-left text-xs text-th-text-faint hover:text-th-text-subtle focus:outline-none">
                + Add metadata
              </button>
            </div>
          </div>

          <button
            onClick={invoke}
            disabled={invoking || !serverUrl.trim() || !serviceName || !methodName}
            className="flex items-center justify-center gap-2 rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50 focus:outline-none"
          >
            <Play className="h-3.5 w-3.5" />
            {invoking ? 'Invoking…' : 'Invoke'}
          </button>
        </div>

        {/* Right: response */}
        <div className="flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-th-border px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-th-text-subtle">Response</span>
            {response?.duration !== undefined && (
              <span className="text-xs text-th-text-faint">{response.duration}ms</span>
            )}
          </div>
          <div className="flex-1 overflow-auto p-3">
            {!response ? (
              <div className="flex h-full items-center justify-center text-sm text-th-text-faint">
                Invoke a method to see the response
              </div>
            ) : response.error ? (
              <pre className="font-mono text-xs text-rose-400 whitespace-pre-wrap">{response.error}</pre>
            ) : (
              <pre className="font-mono text-xs text-th-text-primary whitespace-pre-wrap">
                {JSON.stringify(response.data, null, 2)}
              </pre>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
