import { useCallback, useEffect, useRef, useState } from 'react'
import { GitBranch, GitCommit } from 'lucide-react'
import { useCollectionsStore } from '@/store/collections'
import { useIntegrationsStore } from '@/store/integrations'
import { useRequestsStore } from '@/store/requests'
import { useUIStore } from '@/store/ui'

export function DeleteRequestOverlay() {
  const requestId = useUIStore((s) => s.deletingRequestId)
  const closeDeleteRequest = useUIStore((s) => s.closeDeleteRequest)
  const addToast = useUIStore((s) => s.addToast)

  const allRequests = useCollectionsStore((s) => s.requests)
  const groups = useCollectionsStore((s) => s.groups)
  const collections = useCollectionsStore((s) => s.collections)
  const deleteRequest = useCollectionsStore((s) => s.deleteRequest)
  const integrations = useIntegrationsStore((s) => s.integrations)
  const clearActiveRequest = useRequestsStore((s) => s.clearActiveRequest)
  const activeRequestId = useRequestsStore((s) => s.activeRequestId)

  const [commitMessage, setCommitMessage] = useState('')
  const [currentBranch, setCurrentBranch] = useState('')
  const [deleting, setDeleting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const request = requestId ? allRequests.find((r) => r.id === requestId) ?? null : null
  const group = request ? groups.find((g) => g.id === request.groupId) ?? null : null
  const collection = group ? collections.find((c) => c.id === group.collectionId) ?? null : null
  const isGit = collection?.source === 'git'
  const integration = collection?.integrationId
    ? integrations.find((i) => i.id === collection.integrationId) ?? null
    : null

  useEffect(() => {
    if (!requestId) return
    setCommitMessage('')
    setCurrentBranch(integration?.branch ?? 'main')
    setTimeout(() => textareaRef.current?.focus(), 50)
    if (!integration) return
    window.api.git.currentBranch({ integrationId: integration.id })
      .then(({ data }: { data?: string }) => { if (data) setCurrentBranch(data) })
      .catch(() => {})
  }, [requestId, integration?.id])

  const handleClose = useCallback(() => { closeDeleteRequest() }, [closeDeleteRequest])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') handleClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleClose])

  if (!request || !collection) return null

  const canConfirm = !deleting && (!isGit || (commitMessage.trim().length > 0 && !!currentBranch))

  const handleConfirm = async () => {
    if (!canConfirm) return
    setDeleting(true)
    await deleteRequest(
      request.id,
      isGit ? commitMessage.trim() : undefined,
      isGit ? currentBranch : undefined
    )
    if (activeRequestId === request.id) clearActiveRequest()
    setDeleting(false)
    handleClose()
    if (isGit) addToast(`Deleted and committed to ${currentBranch}`, 'success')
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
            <div className="text-sm font-semibold text-th-text-primary truncate">
              Delete "{request.name}"
            </div>
            {collection && (
              <div className="text-xs text-th-text-muted truncate">{collection.name}</div>
            )}
          </div>
        </div>

        {/* Branch badge (git only) */}
        {isGit && (
          <div className="flex items-center gap-1.5 px-4 pt-3 pb-0">
            <GitBranch className="h-3 w-3 text-th-text-muted" />
            <span className="text-xs text-th-text-secondary">Committing to</span>
            <span className="rounded-full bg-th-surface-raised px-2 py-0.5 text-xs font-mono font-medium text-th-text-primary border border-th-border">
              {currentBranch || '…'}
            </span>
          </div>
        )}

        <div className="p-4">
          {isGit ? (
            <>
              <textarea
                ref={textareaRef}
                className="w-full resize-none rounded-sm border border-th-border bg-th-bg px-3 py-2 text-sm text-th-text-primary placeholder:text-th-text-subtle focus:border-th-accent focus:outline-hidden"
                rows={4}
                placeholder="Commit message…"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleConfirm() } }}
                disabled={deleting}
              />
              <p className="mt-1.5 text-xs text-th-text-muted">Ctrl+Enter to confirm</p>
            </>
          ) : (
            <p className="text-sm text-th-text-secondary">
              Are you sure you want to delete{' '}
              <span className="font-medium text-th-text-primary">{request.name}</span>?
              This cannot be undone.
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 border-t border-th-border px-4 py-3">
          <button
            className="rounded-sm px-3 py-1.5 text-sm text-th-text-secondary hover:bg-th-surface-hover focus:outline-hidden"
            onClick={handleClose}
            disabled={deleting}
          >
            Cancel
          </button>
          <button
            className="rounded-sm bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-500 focus:outline-hidden disabled:opacity-50"
            onClick={handleConfirm}
            disabled={!canConfirm}
          >
            {deleting ? 'Deleting…' : isGit ? 'Delete & Push' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
