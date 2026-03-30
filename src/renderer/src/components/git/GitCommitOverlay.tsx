import { useCallback, useEffect, useRef, useState } from 'react'
import { GitBranch, GitCommit, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useCollectionsStore } from '@/store/collections'
import { useIntegrationsStore } from '@/store/integrations'
import { useSettingsStore } from '@/store/settings'
import { useUIStore } from '@/store/ui'

const AI_SESSION_ID = 'git-commit-overlay-ai'

export function GitCommitOverlay() {
  const action = useUIStore((s) => s.pendingGitAction)
  const closeGitAction = useUIStore((s) => s.closeGitAction)
  const addToast = useUIStore((s) => s.addToast)

  const collections = useCollectionsStore((s) => s.collections)
  const deleteCollection = useCollectionsStore((s) => s.deleteCollection)
  const integrations = useIntegrationsStore((s) => s.integrations)
  const ai = useSettingsStore((s) => s.ai)

  const [commitMessage, setCommitMessage] = useState('')
  const [currentBranch, setCurrentBranch] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [generating, setGenerating] = useState(false)
  const streamingRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const collection = action ? collections.find((c) => c.id === action.collectionId) ?? null : null
  const integration = collection?.integrationId
    ? integrations.find((i) => i.id === collection.integrationId) ?? null
    : null

  const isDelete = action?.type === 'delete-collection'
  const hasAi = !!(ai?.apiKey?.trim())

  useEffect(() => {
    if (!action) return
    setCommitMessage('')
    setCurrentBranch(integration?.branch ?? 'main')
    setTimeout(() => textareaRef.current?.focus(), 50)
    if (!integration) return
    window.api.git.currentBranch({ integrationId: integration.id })
      .then(({ data }: { data?: string }) => { if (data) setCurrentBranch(data) })
      .catch(() => {})
  }, [action?.collectionId, integration?.id])

  // Subscribe to AI chunks
  useEffect(() => {
    const unsub = window.api.ai.onChunk((payload: { requestId: string; text: string; done: boolean }) => {
      if (payload.requestId !== AI_SESSION_ID) return
      if (payload.done) { streamingRef.current = false; setGenerating(false); return }
      setCommitMessage((prev) => prev + payload.text)
    })
    return () => { unsub() }
  }, [])

  const handleClose = useCallback(() => {
    if (streamingRef.current) window.api.ai.cancel({ requestId: AI_SESSION_ID })
    closeGitAction()
  }, [closeGitAction])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleClose])

  if (!action) return null

  const handleGenerateWithAi = async () => {
    if (!hasAi || generating) return
    setCommitMessage('')
    setGenerating(true)
    streamingRef.current = true
    await window.api.ai.chat({
      requestId: AI_SESSION_ID,
      provider: ai.provider,
      apiKey: ai.apiKey,
      model: ai.model,
      messages: [
        {
          role: 'system',
          content: 'You generate concise, conventional git commit messages. Output ONLY the commit message line (50 chars or less), no explanation, no quotes.',
        },
        {
          role: 'user',
          content: `Generate a git commit message for this change:\n\n${action.title}`,
        },
      ],
    })
  }

  const handleSubmit = async () => {
    if (!commitMessage.trim()) { addToast('Please enter a commit message', 'error'); return }
    if (!currentBranch) { addToast('Could not determine current branch', 'error'); return }
    setSubmitting(true)

    if (isDelete) {
      await deleteCollection(action.collectionId, commitMessage.trim())
      addToast(`Deleted and pushed to ${currentBranch}`, 'success')
    } else {
      const { error } = await window.api.git.pushCollection({
        collectionId: action.collectionId,
        commitMessage: commitMessage.trim(),
        branch: currentBranch,
      })
      if (error) { addToast(`Push failed: ${error}`, 'error'); setSubmitting(false); return }
      addToast(`Committed to ${currentBranch}`, 'success')
    }

    setSubmitting(false)
    closeGitAction()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleSubmit() }
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-xs"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div className="relative w-full max-w-lg rounded-lg border border-th-border-strong bg-th-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-th-border px-4 py-3">
          <GitCommit className="h-4 w-4 shrink-0 text-th-text-secondary" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-th-text-primary truncate">{action.title}</div>
            {action.subtitle && (
              <div className="text-xs text-th-text-muted truncate">{action.subtitle}</div>
            )}
          </div>
        </div>

        {/* Branch badge */}
        <div className="flex items-center gap-1.5 px-4 pt-3 pb-0">
          <GitBranch className="h-3 w-3 text-th-text-muted" />
          <span className="text-xs text-th-text-secondary">Committing to</span>
          <span className="rounded-full bg-th-surface-raised px-2 py-0.5 text-xs font-mono font-medium text-th-text-primary border border-th-border">
            {currentBranch || '…'}
          </span>
        </div>

        {/* Commit message */}
        <div className="p-4">
          <div className="relative">
            <textarea
              ref={textareaRef}
              className="w-full resize-none rounded-sm border border-th-border bg-th-bg px-3 py-2 text-sm text-th-text-primary placeholder:text-th-text-subtle focus:border-th-accent focus:outline-hidden"
              rows={4}
              placeholder="Commit message…"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={generating || submitting}
            />
            {generating && (
              <div className="absolute bottom-2 right-2 text-xs text-th-text-muted animate-pulse">Generating…</div>
            )}
          </div>
          <p className="mt-1.5 text-xs text-th-text-muted">Ctrl+Enter to confirm</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 border-t border-th-border px-4 py-3">
          {hasAi && (
            <Button variant="ghost" size="sm" onClick={handleGenerateWithAi} disabled={generating || submitting} className="gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              {generating ? 'Generating…' : 'Generate with AI'}
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={handleClose} disabled={submitting}>Cancel</Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={submitting || !commitMessage.trim()}
            className={isDelete ? 'bg-rose-600 hover:bg-rose-500 border-transparent text-white' : ''}
          >
            {submitting ? (isDelete ? 'Deleting…' : 'Pushing…') : isDelete ? 'Delete & Push' : 'Commit & Push'}
          </Button>
        </div>
      </div>
    </div>
  )
}
