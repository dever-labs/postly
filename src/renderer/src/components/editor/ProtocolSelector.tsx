import React from 'react'
import type { ProtocolType } from '@/types'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/Select'
import { cn } from '@/lib/utils'

const PROTOCOLS: {
  value: ProtocolType
  label: string
  short: string
  dot: string
  description: string
}[] = [
  { value: 'http',      label: 'HTTP',      short: 'HTTP',  dot: 'bg-green-400',  description: 'REST / HTTP requests' },
  { value: 'graphql',   label: 'GraphQL',   short: 'GQL',   dot: 'bg-pink-400',   description: 'GraphQL over HTTP' },
  { value: 'websocket', label: 'WebSocket', short: 'WS',    dot: 'bg-blue-400',   description: 'Bidirectional WS connection' },
  { value: 'grpc',      label: 'gRPC',      short: 'gRPC',  dot: 'bg-purple-400', description: 'Protocol Buffers / gRPC' },
  { value: 'mqtt',      label: 'MQTT',      short: 'MQTT',  dot: 'bg-amber-400',  description: 'MQTT pub/sub messaging' },
]

const DOT_COLOR: Record<ProtocolType, string> = {
  http:      'bg-green-400',
  graphql:   'bg-pink-400',
  websocket: 'bg-blue-400',
  grpc:      'bg-purple-400',
  mqtt:      'bg-amber-400',
}

interface ProtocolSelectorProps {
  value: ProtocolType
  onChange: (p: ProtocolType) => void
}

export function ProtocolSelector({ value, onChange }: ProtocolSelectorProps) {
  const current = PROTOCOLS.find((p) => p.value === value) ?? PROTOCOLS[0]

  return (
    <Select value={value} onValueChange={(v) => onChange(v as ProtocolType)}>
      <SelectTrigger className="w-[90px] shrink-0 gap-1.5 px-2">
        <span className="flex items-center gap-1.5">
          <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT_COLOR[value])} />
          <span className="font-mono text-[11px] font-semibold">{current.short}</span>
        </span>
      </SelectTrigger>
      <SelectContent className="w-72">
        {PROTOCOLS.map((p) => (
          <SelectItem key={p.value} value={p.value} className="pl-8 pr-3">
            <span className="flex items-center gap-2">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', p.dot)} />
              <span className="font-semibold">{p.label}</span>
              <span className="text-xs text-th-text-faint">{p.description}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
