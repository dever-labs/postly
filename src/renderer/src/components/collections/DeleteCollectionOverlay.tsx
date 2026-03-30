import { useEffect, useState } from 'react'
import { useCollectionsStore } from '@/store/collections'
import { useUIStore } from '@/store/ui'

export function DeleteCollectionOverlay() {
  const collectionId = useUIStore((s) => s.deletingCollectionId)
  const closeDeleteCollection = useUIStore((s) => s.closeDeleteCollection)
  const collections = useCollectionsStore((s) => s.collections)
  const deleteCollection = useCollectionsStore((s) => s.deleteCollection)

  const [commitMessage, setCommitMessage] = useState('')
  const [deleting, setDeleting] = useState(false)

  const collection = collectionId ? collections.find((c) => c.id === collectionId) ?? null : null
  const isGit = collection?.source === 'git'

  useEffect(() => {
    if (collectionId) setCommitMessage('')
  }, [collectionId])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDeleteCollection() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [closeDeleteCollection])

  if (!collection) return null

  const handleConfirm = async () => {
    setDeleting(true)
    await deleteCollection(collection.id, commitMessage.trim() || undefined)
    setDeleting(false)
    closeDeleteCollection()
  }

  const canConfirm = !deleting && (!isGit || commitMessage.trim().length > 0)

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-xs"
      onClick={(e) => { if (e.target === e.currentTarget) closeDeleteCollection() }}
    >
      <div className="w-full max-w-sm rounded-lg border border-th-border-strong bg-th-surface shadow-2xl">
        <div className="border-b border-th-border px-4 py-3">
          <div className="text-sm font-semibold text-th-text-primary">Delete collection</div>
          <div className="mt-0.5 truncate text-xs text-th-text-muted">{collection.name}</div>
        </div>

        <div className="p-4">
          {isGit ? (
            <>
              <p className="mb-3 text-sm text-th-text-secondary">
                This will delete the collection file from the repository and push the change.
              </p>
              <textarea
                autoFocus
                className="w-full resize-none rounded-sm border border-th-border bg-th-bg px-3 py-2 text-sm text-th-text-primary placeholder:text-th-text-subtle focus:border-th-accent focus:outline-hidden"
                rows={3}
                placeholder="Commit message…"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); if (canConfirm) handleConfirm() } }}
              />
              <p className="mt-1.5 text-xs text-th-text-muted">Ctrl+Enter to confirm</p>
            </>
          ) : (
            <p className="text-sm text-th-text-secondary">
              Are you sure you want to delete{' '}
              <span className="font-medium text-th-text-primary">{collection.name}</span>?
              This cannot be undone.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-th-border px-4 py-3">
          <button
            className="rounded-sm px-3 py-1.5 text-sm text-th-text-secondary hover:bg-th-surface-hover focus:outline-hidden"
            onClick={closeDeleteCollection}
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
