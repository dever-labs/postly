import React, { useCallback, useEffect, useRef, useState } from 'react'
import { GitCommit, Sparkles, X, GitBranch } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useUIStore } from '@/store/ui'
import { useRequestsStore } from '@/store/requests'
import { useCollectionsStore } from '@/store/collections'
import { useSettingsStore } from '@/store/settings'
import { useIntegrationsStore } from '@/store/integrations'

const AI_SESSION_ID = 'commit-overlay-ai'

export function CommitOverlay() {
  const { activeCommitRequestId, closeCommitPanel, addToast } = useUIStore()
  const { requests: allRequests } = useCollectionsStore()
  const groups = useCollectionsStore((s) => s.groups)
  const collections = useCollectionsStore((s) => s.collections)
  const integrations = useIntegrationsStore((s) => s.integrations)
  const ai = useSettingsStore((s) => s.ai)
  const clearDirty = useRequestsStore((s) => s.clearDirty)
  const editingRequest = useRequestsStore((s) => s.editingRequest)

  const [commitMessage, setCommitMessage] = useState('')
  const [currentBranch, setCurrentBranch] = useState('')
  const [committing, setCommitting] = useState(false)
  const [generating, setGenerating] = useState(false)
  const streamingRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const requestId = activeCommitRequestId
  const request = requestId
    ? (editingRequest?.id === requestId ? editingRequest : allRequests.find((r) => r.id === requestId)) ?? null
    : null

  const group = request ? groups.find((g) => g.id === request.groupId) : null
  const collection = group ? collections.find((c) => c.id === group.collectionId) : null
  const integration = collection?.integrationId
    ? integrations.find((i) => i.id === collection.integrationId) ?? null
    : null

  const hasAi = !!(ai?.apiKey?.trim())

  // Load current branch when overlay opens
  useEffect(() => {
    if (!integration || !requestId) return
    setCommitMessage('')
    setCurrentBranch('')
    window.api.git.currentBranch({ integrationId: integration.id }).then(({ data }: { data: string }) => {
      if (data) setCurrentBranch(data)
    })
    // Focus textarea after open
    setTimeout(() => textareaRef.current?.focus(), 50)
  }, [requestId, integration])

  // Subscribe to AI chunks
  useEffect(() => {
    const unsub = window.api.ai.onChunk((payload: { requestId: string; text: string; done: boolean; error?: string }) => {
      if (payload.requestId !== AI_SESSION_ID) return
      if (payload.done) {
        streamingRef.current = false
        setGenerating(false)
        return
      }
      setCommitMessage((prev) => prev + payload.text)
    })
    return () => { unsub() }
  }, [])

  const handleClose = useCallback(() => {
    if (streamingRef.current) {
      window.api.ai.cancel({ requestId: AI_SESSION_ID })
    }
    closeCommitPanel()
  }, [closeCommitPanel])

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleClose])

  const handleGenerateWithAi = async () => {
    if (!request || !hasAi || generating) return
    setCommitMessage('')
    setGenerating(true)
    streamingRef.current = true

    const requestContext = [
      `Request name: ${request.name}`,
      `Method: ${request.method ?? 'GET'}`,
      `URL: ${request.url ?? ''}`,
      request.description ? `Description: ${request.description}` : null,
    ].filter(Boolean).join('\n')

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
          content: `Generate a git commit message for this API request change:\n\n${requestContext}`,
        },
      ],
    })
  }

  const handleCommit = async () => {
    if (!commitMessage.trim() || !requestId || !currentBranch) return
    setCommitting(true)

    const content = request
      ? JSON.stringify({
          name: request.name,
          method: request.method,
          url: request.url,
          params: request.params,
          headers: request.headers,
          bodyType: request.bodyType,
          bodyContent: request.bodyContent,
          authType: request.authType,
          authConfig: request.authConfig,
          description: request.description,
        }, null, 2)
      : ''

    const { error } = await window.api.git.commit({
      requestId,
      commitMessage: commitMessage.trim(),
      branch: currentBranch,
      content,
    })

    setCommitting(false)
    if (error) {
      addToast(`Commit failed: ${error}`, 'error')
    } else {
      addToast(`Committed to ${currentBranch}`, 'success')
      // Clear the dirty flag in both DB (done by IPC) and in-memory stores
      if (requestId) clearDirty(requestId)
      closeCommitPanel()
    }
  }

  // Ctrl+Enter to commit
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      handleCommit()
    }
  }

  if (!activeCommitRequestId || !request) return null

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-xs"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div className="relative w-full max-w-lg rounded-lg border border-th-border-strong bg-th-surface-raised shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-th-border px-4 py-3">
          <GitCommit className="h-4 w-4 shrink-0 text-th-text-muted" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-th-text-primary truncate">
              Commit "{request.name}"
            </div>
            {collection && (
              <div className="text-xs text-th-text-faint truncate">{collection.name}</div>
            )}
          </div>
          <button
            onClick={handleClose}
            className="rounded-sm p-1 text-th-text-subtle hover:bg-th-surface-hover hover:text-th-text-secondary focus:outline-hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Branch badge */}
        {currentBranch && (
          <div className="flex items-center gap-1.5 px-4 pt-3 pb-0">
            <GitBranch className="h-3 w-3 text-th-text-faint" />
            <span className="text-xs text-th-text-faint">Committing to</span>
            <span className="rounded-full bg-th-surface-hover px-2 py-0.5 text-xs font-mono text-th-text-muted">
              {currentBranch}
            </span>
          </div>
        )}

        {/* Commit message */}
        <div className="p-4">
          <div className="relative">
            <textarea
              ref={textareaRef}
              className="w-full resize-none rounded-sm border border-th-border bg-th-bg px-3 py-2 text-sm text-th-text-primary placeholder:text-th-text-faint focus:border-th-accent focus:outline-hidden"
              rows={4}
              placeholder="Commit message…"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={generating}
            />
            {generating && (
              <div className="absolute bottom-2 right-2 text-xs text-th-text-faint animate-pulse">
                Generating…
              </div>
            )}
          </div>
          <p className="mt-1.5 text-xs text-th-text-faint">Ctrl+Enter to commit</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 border-t border-th-border px-4 py-3">
          {hasAi && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleGenerateWithAi}
              disabled={generating || committing}
              className="gap-1.5"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {generating ? 'Generating…' : 'Generate with AI'}
            </Button>
          )}
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={handleClose} disabled={committing}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleCommit}
            disabled={committing || !commitMessage.trim() || !currentBranch}
          >
            {committing ? 'Committing…' : 'Commit & Push'}
          </Button>
        </div>
      </div>
    </div>
  )
}
