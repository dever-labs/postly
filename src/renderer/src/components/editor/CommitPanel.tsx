import { DiffEditor } from '@monaco-editor/react'
import { GitCommit } from 'lucide-react'
import React, { useEffect, useState } from 'react'
import type { DiffResult } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/Select'
import { useUIStore } from '@/store/ui'

interface CommitPanelProps {
  requestId: string
  source: 'github' | 'gitlab'
}

export function CommitPanel({ requestId, source }: CommitPanelProps) {
  const addToast = useUIStore((s) => s.addToast)
  const [commitMessage, setCommitMessage] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [selectedBranch, setSelectedBranch] = useState('')
  const [newBranch, setNewBranch] = useState('')
  const [fromBranch, setFromBranch] = useState('')
  const [isNewBranch, setIsNewBranch] = useState(false)
  const [showDiff, setShowDiff] = useState(false)
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [committing, setCommitting] = useState(false)
  const [loadingDiff, setLoadingDiff] = useState(false)

  useEffect(() => {
    const api = (window as any).api
    const loader = source === 'github' ? api.github.branches : api.gitlab.branches
    loader({ requestId }).then(({ data }: { data: string[] }) => {
      if (data) {
        setBranches(data)
        setSelectedBranch(data[0] ?? '')
        setFromBranch(data[0] ?? '')
      }
    })
  }, [requestId, source])

  const handleShowDiff = async () => {
    if (showDiff) { setShowDiff(false); return }
    setLoadingDiff(true)
    const api = (window as any).api
    const loader = source === 'github' ? api.github.diff : api.gitlab.diff
    const { data } = await loader({ requestId })
    if (data) setDiff(data)
    setLoadingDiff(false)
    setShowDiff(true)
  }

  const handleCommit = async () => {
    if (!commitMessage.trim()) return
    setCommitting(true)
    const api = (window as any).api
    const branch = isNewBranch ? newBranch : selectedBranch
    const committer = source === 'github' ? api.github.commit : api.gitlab.commit
    const { error } = await committer({ requestId, commitMessage, branch, fromBranch: isNewBranch ? fromBranch : undefined })
    setCommitting(false)
    if (error) {
      addToast(`Commit failed: ${error}`, 'error')
    } else {
      addToast('Committed successfully', 'success')
      setCommitMessage('')
    }
  }

  return (
    <div className="border-t border-neutral-800 bg-neutral-900 p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-neutral-400">
        <GitCommit className="h-3.5 w-3.5" />
        Commit changes
      </div>

      <div className="flex flex-col gap-2">
        <Input
          placeholder="Commit message..."
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
        />

        <div className="flex items-center gap-2">
          {!isNewBranch ? (
            <Select value={selectedBranch} onValueChange={setSelectedBranch}>
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="Select branch..." />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b} value={b}>{b}</SelectItem>
                ))}
                <SelectItem value="__new__">New branch...</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <div className="flex flex-1 gap-2">
              <Input
                placeholder="New branch name"
                value={newBranch}
                onChange={(e) => setNewBranch(e.target.value)}
              />
              <Select value={fromBranch} onValueChange={setFromBranch}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="From..." />
                </SelectTrigger>
                <SelectContent>
                  {branches.map((b) => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="ghost" size="sm" onClick={() => setIsNewBranch(false)}>Cancel</Button>
            </div>
          )}

          {!isNewBranch && selectedBranch === '__new__' && (
            <Button variant="ghost" size="sm" onClick={() => { setIsNewBranch(true); setSelectedBranch('') }}>
              New
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={handleShowDiff} disabled={loadingDiff}>
            {loadingDiff ? 'Loading...' : showDiff ? 'Hide Diff' : 'Show Diff'}
          </Button>
          <Button size="sm" onClick={handleCommit} disabled={committing || !commitMessage.trim()}>
            {committing ? 'Committing...' : 'Commit'}
          </Button>
        </div>

        {showDiff && diff && (
          <div className="rounded border border-neutral-800 overflow-hidden">
            <DiffEditor
              height="200px"
              language="json"
              theme="vs-dark"
              original={diff.remoteContent}
              modified={diff.localContent}
              options={{ readOnly: true, minimap: { enabled: false }, fontSize: 11 }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
