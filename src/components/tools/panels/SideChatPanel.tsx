import { useCallback, useEffect, useRef, useState } from 'react'
import { useModelStore } from '@/stores/model-store'
import { useUiStore } from '@/stores/ui-store'

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

const SIDE_CONV_KEY = 'lamprey.sidechat.conversationId'

export function SideChatPanel() {
  const [convId, setConvId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [draft, setDraft] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamBuf, setStreamBuf] = useState('')
  const [error, setError] = useState<string | null>(null)
  const activeModel = useModelStore((s) => s.activeModel)
  const sideChatSeed = useUiStore((s) => s.sideChatSeed)
  const consumeSideChatSeed = useUiStore((s) => s.consumeSideChatSeed)
  const scrollRef = useRef<HTMLDivElement>(null)
  const streamBufRef = useRef('')

  // Initialize: load or create the side conversation. We persist its ID in
  // localStorage so reopening the panel keeps history.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!window.api) return
      const seed = consumeSideChatSeed()
      if (seed) {
        const forked = await window.api.conversation.fork({
          sourceConversationId: seed.sourceConversationId,
          sourceMessageId: seed.sourceMessageId,
          seedKind: seed.seedKind,
          seedContent: seed.seedContent,
          includeRagAttachments: true,
          workspaceMode: 'current',
          titleOverride: 'Side chat seed'
        })
        if (cancelled) return
        if (!forked.success) {
          setError(forked.error ?? 'Failed to seed side conversation')
          return
        }
        const id = (forked.data as { conversationId: string }).conversationId
        window.localStorage?.setItem(SIDE_CONV_KEY, id)
        setConvId(id)
        const msgs = await window.api.conversation.getMessages(id)
        if (!cancelled && msgs.success) {
          const list = (msgs.data as any[])
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
          setMessages(list)
        }
        return
      }
      const stored = window.localStorage?.getItem(SIDE_CONV_KEY)
      if (stored) {
        const exists = await window.api.conversation.get(stored)
        if (!cancelled && exists.success && exists.data) {
          setConvId(stored)
          const msgs = await window.api.conversation.getMessages(stored)
          if (!cancelled && msgs.success) {
            const list = (msgs.data as any[])
              .filter((m) => m.role === 'user' || m.role === 'assistant')
              .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
            setMessages(list)
          }
          return
        }
      }
      // Create new one tied to current active model
      const created = await window.api.conversation.create(activeModel || 'deepseek-chat')
      if (cancelled) return
      if (!created.success) {
        setError(created.error ?? 'Failed to create side conversation')
        return
      }
      const id = (created.data as any).id as string
      window.localStorage?.setItem(SIDE_CONV_KEY, id)
      setConvId(id)
    })()
    return () => {
      cancelled = true
    }
  }, [activeModel, consumeSideChatSeed, sideChatSeed])

  useEffect(() => {
    streamBufRef.current = streamBuf
  }, [streamBuf])

  // Wire per-conversation event subscription.
  useEffect(() => {
    if (!convId || !window.api?.chat?.subscribe) return
    const unsub = window.api.chat.subscribe(convId, {
      onChunk: (e) => {
        setStreamBuf((b) => b + e.content)
      },
      onDone: (e) => {
        const msg = e.message as any
        const content = typeof msg?.content === 'string' ? msg.content : streamBufRef.current
        setMessages((cur) => [...cur, { role: 'assistant', content }])
        setStreamBuf('')
        setStreaming(false)
      },
      onError: (e) => {
        setError(e.error)
        setStreamBuf('')
        setStreaming(false)
      }
    })
    return unsub
  }, [convId])

  // Auto-scroll on new content.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, streamBuf])

  const send = useCallback(async () => {
    if (!convId || !draft.trim() || streaming) return
    const content = draft
    setDraft('')
    setError(null)
    setMessages((cur) => [...cur, { role: 'user', content }])
    setStreaming(true)
    const res = await window.api?.chat?.send({
      conversationId: convId,
      model: activeModel,
      content,
      activeSkillIds: []
    })
    if (!res?.success) {
      setError(res?.error ?? 'send failed')
      setStreaming(false)
    }
  }, [convId, draft, streaming, activeModel])

  const resetSession = async () => {
    if (!window.api) return
    const created = await window.api.conversation.create(activeModel || 'deepseek-chat')
    if (created.success) {
      const id = (created.data as any).id as string
      window.localStorage?.setItem(SIDE_CONV_KEY, id)
      setConvId(id)
      setMessages([])
      setStreamBuf('')
      setError(null)
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--panel-border)] px-3 py-1.5 text-[11px] text-[var(--text-muted)]">
        <span>Side thread · {activeModel || '(no model)'}</span>
        <button
          type="button"
          onClick={resetSession}
          className="rounded px-1.5 py-0.5 transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          title="New side thread"
        >
          new
        </button>
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3 text-[13px]">
        {messages.length === 0 && !streaming && (
          <p className="text-[var(--text-muted)]">
            Ephemeral thread for quick asides. Doesn't appear in the main sidebar.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className="mb-3">
            <div className="mb-0.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              {m.role === 'user' ? 'You' : 'Assistant'}
            </div>
            <pre className="m-0 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--text-primary)]">
              {m.content}
            </pre>
          </div>
        ))}
        {streaming && (
          <div className="mb-3">
            <div className="mb-0.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
              Assistant
            </div>
            <pre className="m-0 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--text-primary)]">
              {streamBuf}
              {!streamBuf && <span className="text-[var(--text-muted)]">…</span>}
            </pre>
          </div>
        )}
        {error && <p className="text-[12px] text-[var(--error)]">{error}</p>}
      </div>
      <div className="border-t border-[var(--panel-border)] p-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder={convId ? 'Side message (Enter to send, Shift+Enter for newline)' : 'Connecting…'}
          rows={2}
          disabled={!convId || streaming}
          className="w-full resize-none rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-1.5 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] disabled:opacity-60"
        />
      </div>
    </div>
  )
}
