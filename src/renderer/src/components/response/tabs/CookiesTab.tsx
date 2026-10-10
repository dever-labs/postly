import { Eye, EyeOff } from 'lucide-react'
import React, { useState } from 'react'
import { cookieFlags, formatExpiry, maskValue } from '@/lib/cookieFormat'
import { useUIStore } from '@/store/ui'
import type { ResponseCookie } from '@/types'

export function CookiesTab({ cookies }: { cookies: ResponseCookie[] }) {
  const [reveal, setReveal] = useState(false)
  const openSettings = useUIStore((s) => s.openSettings)

  if (cookies.length === 0) {
    return (
      <div data-testid="cookies-empty" className="flex h-full flex-col items-center justify-center gap-2 text-sm text-th-text-faint">
        This response did not set any cookies
        <button onClick={() => openSettings('cookies')} className="text-xs text-blue-400 hover:underline">Manage cookies</button>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-th-border px-4 py-1.5 text-xs text-th-text-subtle">
        <button onClick={() => setReveal((r) => !r)} data-testid="cookies-reveal" className="flex items-center gap-1.5 hover:text-th-text-secondary">
          {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {reveal ? 'Hide values' : 'Show values'}
        </button>
        <button onClick={() => openSettings('cookies')} className="text-blue-400 hover:underline">Manage cookies</button>
      </div>
      <table data-testid="cookies-table" className="w-full text-xs">
        <thead>
          <tr className="border-b border-th-border text-left text-th-text-subtle">
            <th className="px-4 py-2 font-medium">Name</th>
            <th className="px-4 py-2 font-medium">Value</th>
            <th className="px-4 py-2 font-medium">Domain</th>
            <th className="px-4 py-2 font-medium">Path</th>
            <th className="px-4 py-2 font-medium">Expires</th>
            <th className="px-4 py-2 font-medium">Attributes</th>
          </tr>
        </thead>
        <tbody>
          {cookies.map((c, i) => (
            <tr key={`${c.name}-${c.domain}-${c.path}-${i}`} className="border-b border-th-surface hover:bg-th-surface/50">
              <td className="px-4 py-1.5 font-mono text-th-text-muted">
                {c.name}
                {c.deleted && <span className="ml-2 rounded-sm bg-amber-900/40 px-1 text-[9px] uppercase text-amber-400">removed</span>}
                {c.rejected && <span className="ml-2 rounded-sm bg-rose-900/40 px-1 text-[9px] uppercase text-rose-400">not stored</span>}
              </td>
              <td className="max-w-64 break-all px-4 py-1.5 font-mono text-th-text-secondary">{reveal ? c.value : maskValue(c.value)}</td>
              <td className="px-4 py-1.5 text-th-text-secondary">{c.domain}</td>
              <td className="px-4 py-1.5 text-th-text-secondary">{c.path}</td>
              <td className="px-4 py-1.5 text-th-text-secondary">{formatExpiry(c.expires)}</td>
              <td className="px-4 py-1.5 text-th-text-subtle">{cookieFlags(c).join(', ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
