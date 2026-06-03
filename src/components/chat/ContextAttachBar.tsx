import { useEffect, useState } from 'react'
import type { RagAttachment, RagCollection } from '@/lib/types'

interface ContextAttachBarProps {
  conversationId: string
}

// Compact horizontal strip above ChatInput. Shows attached collection /
// document chips; clicking the × button detaches. The popover for picking
// a NEW attachment lives in ChatInput's existing slash/@ menu surface (or
// the Settings → Library tab); this bar is read+remove only.

export function ContextAttachBar({ conversationId }: ContextAttachBarProps) {
  const [attachments, setAttachments] = useState<RagAttachment[]>([])
  const [collections, setCollections] = useState<RagCollection[]>([])

  const refresh = async (): Promise<void> => {
    if (!window.api?.rag) return
    const [att, cols] = await Promise.all([
      window.api.rag.attachments.list(conversationId),
      window.api.rag.collection.list()
    ])
    if (att?.success) setAttachments(att.data as RagAttachment[])
    if (cols?.success) setCollections(cols.data as RagCollection[])
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  const detach = async (a: RagAttachment): Promise<void> => {
    if (!window.api?.rag) return
    await window.api.rag.attachments.remove({
      conversationId: a.conversationId,
      collectionId: a.collectionId,
      documentId: a.documentId
    })
    await refresh()
  }

  if (attachments.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1 px-2 py-1">
      {attachments.map((a) => {
        const collection = a.collectionId
          ? collections.find((c) => c.id === a.collectionId)
          : undefined
        const label = collection?.name ?? a.documentId ?? a.collectionId ?? '?'
        return (
          <span
            key={`${a.collectionId ?? ''}|${a.documentId ?? ''}`}
            className="flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-0.5 font-mono text-[11px] text-[var(--text-primary)]"
            title={
              a.collectionId
                ? `collection: ${label}`
                : `document: ${a.documentId}`
            }
          >
            <span aria-hidden>📎</span>
            <span className="max-w-[140px] truncate">{label}</span>
            <button
              onClick={() => void detach(a)}
              className="text-[var(--text-muted)] hover:text-red-400"
              aria-label="Detach"
            >
              ×
            </button>
          </span>
        )
      })}
    </div>
  )
}
