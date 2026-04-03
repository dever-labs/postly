import React from 'react'
import type { AuthType } from '@/types'
import { AuthEditor } from '@/components/editor/AuthEditor'

interface AuthTabProps {
  authType: AuthType
  authConfig: Record<string, string>
  onTypeChange: (t: AuthType) => void
  onConfigChange: (c: Record<string, string>) => void
}

export const AuthTab = React.memo(function AuthTab({ authType, authConfig, onTypeChange, onConfigChange }: AuthTabProps) {
  return (
    <div className="p-3">
      <AuthEditor
        authType={authType}
        authConfig={authConfig}
        onChange={(t, c) => { onTypeChange(t); onConfigChange(c) }}
        canInherit={true}
      />
    </div>
  )
})