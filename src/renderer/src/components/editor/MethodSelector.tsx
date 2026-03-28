import React from 'react'
import type { HttpMethod } from '@/types'
import { Badge } from '@/components/ui/Badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']

const METHOD_BADGE_VARIANTS: Record<HttpMethod, 'green' | 'yellow' | 'blue' | 'red' | 'orange' | 'purple' | 'grey'> = {
  GET: 'green',
  POST: 'yellow',
  PUT: 'blue',
  DELETE: 'red',
  PATCH: 'orange',
  HEAD: 'purple',
  OPTIONS: 'grey',
}

interface MethodSelectorProps {
  value: HttpMethod
  onChange: (m: HttpMethod) => void
}

export function MethodSelector({ value, onChange }: MethodSelectorProps) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as HttpMethod)}>
      <SelectTrigger className="w-[110px] shrink-0">
        <Badge variant={METHOD_BADGE_VARIANTS[value]} className="font-mono text-[11px]">
          {value}
        </Badge>
      </SelectTrigger>
      <SelectContent>
        {METHODS.map((m) => (
          <SelectItem key={m} value={m}>
            <Badge variant={METHOD_BADGE_VARIANTS[m]} className="font-mono text-[11px]">
              {m}
            </Badge>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
