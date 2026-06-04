import { create } from 'zustand'
import type {
  AgentRunPhase,
  Conversation,
  Message,
  ProcessedFile,
  ToolCallEvent,
  ToolCallResultEvent,
  ToolProviderKind,
  ToolRisk
} from '@/lib/types'
import { useSettingsStore } from '@/stores/settings-store'
import { useModelStore } from '@/stores/model-store'
import { useAgentStore } from '@/stores/agent-store'
import { usePlanStore } from '@/stores/plan-store'
import { toast } from '@/stores/toast-store'
import { useNavHistoryStore } from '@/stores/nav-history-store'
import { getRecentUserPromptsFrom } from '@/lib/recent-prompts'

export interface ToolCallState {
  callId: string
  serverId: string
  toolName: string
  args: Record<string, unknown>
  status: 'pending' | 'running' | 'success' | 'error' | 'denied'
  result?: string
  duration?: number
  // Descriptor metadata mirrored from the chat:tool-call event so the
  // card renders plain-English label, risk badges, and a live elapsed
  // timer without an extra registry round-trip.
  title?: string
  risks?: ToolRisk[]
  providerKind?: ToolProviderKind
  startedAt?: number
}

interface ChatState {
  conversations: Conversation[]
  activeConversationId: string | null
  messages: Message[]
  isStreaming: boolean
  streamingContent: string
  streamStartedAt: number | null
  activeModel: string
  toolCalls: ToolCallState[]
  pendingAttachments: ProcessedFile[]
  attachmentsProcessing: boolean
  // Codex-style run-phase pill source. Null when no run is active; set by the
  // chat:phase IPC stream from electron/ipc/chat.ts. Cleared on terminal
  // phases (done/error) so the pill disappears when the model finishes.
  runPhase: AgentRunPhase | null

  loadConversations: () => Promise<void>
  selectConversation: (id: string) => Promise<void>
  createConversation: () => Promise<string>
  deleteConversation: (id: string) => Promise<void>
  sendMessage: (content: string, activeSkillIds: string[]) => Promise<void>
  cancelStream: () => void
  setModel: (model: string) => Promise<void>
  appendStreamChunk: (content: string) => void
  finishStream: (message: Message) => void
  streamError: (error: string) => void
  addToolCall: (event: ToolCallEvent) => void
  updateToolCall: (event: ToolCallResultEvent) => void
  clearToolCalls: () => void
  setRunPhase: (phase: AgentRunPhase | null) => void
  addAttachments: (files: ProcessedFile[]) => void
  removeAttachment: (index: number) => void
  clearAttachments: () => void
  setAttachmentsProcessing: (v: boolean) => void
  /**
   * Fluidity J1: most-recent-first list of the user's prior prompts in the
   * active conversation. Used by ChatInput's ↑/↓ history walker. Strips the
   * attachment-block suffix that buildAttachmentBlock appends at send time
   * so the recalled text is what the user originally typed.
   */
  getRecentUserPrompts: (limit?: number) => string[]
  /** Dispatcher for RAG ingest progress events. Wired in App.tsx from
   *  window.api.rag.document.onProgress so the store doesn't own the IPC
   *  subscription lifecycle. */
  _updateRagAttachmentProgress: (event: {
    jobId: string
    documentId: string
    phase: string
    progress: number
    chunkCount?: number
    error?: string
  }) => void
}

function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

function buildAttachmentBlock(file: ProcessedFile): string {
  if (file.error) return `\n\n[Attachment ${file.name}: ${file.error}]`
  if (file.kind === 'text') {
    const lang = extOf(file.name)
    const open = lang ? '```' + lang : '```'
    const close = '```'
    return '\n\n[Attachment ' + file.name + ']\n' + open + '\n' + file.content + '\n' + close
  }
  if (file.kind === 'pdf') {
    return `\n\n[PDF ${file.name}]\n${file.content || '(no extractable text)'}`
  }
  if (file.kind === 'binary') {
    return `\n\n[Attachment ${file.name}: ${file.previewText || 'binary file, content not included.'}]`
  }
  if (file.kind === 'rag-pending') {
    // The file's content reaches the model via augmentForChat's
    // <retrieved_context> block at chat-send time, not inline here. We
    // leave a one-line marker so the model knows a corpus is attached
    // and can reason about citation expectations even before the first
    // <retrieved_context> arrives.
    const phase = file.ragPhase ?? 'queued'
    if (phase === 'ready') {
      return `\n\n[Indexed corpus: ${file.name} — ${file.ragChunkCount ?? '?'} chunks available via retrieval]`
    }
    if (phase === 'error') {
      return `\n\n[Attachment ${file.name}: indexing failed${file.error ? ` — ${file.error}` : ''}]`
    }
    return `\n\n[Indexing ${file.name} — chunks not yet available for this turn]`
  }
  return ''
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messages: [],
  isStreaming: false,
  streamingContent: '',
  streamStartedAt: null,
  activeModel: 'deepseek-v4-pro',
  toolCalls: [],
  pendingAttachments: [],
  attachmentsProcessing: false,
  runPhase: null,

  loadConversations: async () => {
    const result = await window.api.conversation.list()
    if (result.success) {
      set({ conversations: result.data })
    }
  },

  selectConversation: async (id: string) => {
    if (get().activeConversationId === id) return
    useNavHistoryStore.getState().push(id)
    set({ activeConversationId: id, toolCalls: [], runPhase: null })
    const result = await window.api.conversation.getMessages(id)
    if (result.success) {
      set({ messages: result.data })
    }
    const conv = get().conversations.find((c) => c.id === id)
    if (conv) {
      set({ activeModel: conv.model })
    }
    // Load the plan for the new active conversation. Fire-and-forget — the
    // plan checklist renders empty until the snapshot arrives, which is fine.
    void usePlanStore.getState().loadForConversation(id)
  },

  createConversation: async () => {
    const model = get().activeModel
    const result = await window.api.conversation.create(model)
    if (result.success) {
      const conv = result.data
      useNavHistoryStore.getState().push(conv.id)
      set((state) => ({
        conversations: [conv, ...state.conversations],
        activeConversationId: conv.id,
        messages: [],
        toolCalls: [],
        runPhase: null
      }))
      // Fresh conversation starts with an empty plan; load to seed the store
      // (also drops any stale snapshot from the previous active conversation).
      void usePlanStore.getState().loadForConversation(conv.id)
      return conv.id
    }
    return ''
  },

  deleteConversation: async (id: string) => {
    await window.api.conversation.delete(id)
    const wasActive = get().activeConversationId === id
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== id),
      activeConversationId: wasActive ? null : state.activeConversationId,
      messages: wasActive ? [] : state.messages,
      // Drop in-flight chat-side state for the deleted conversation so the
      // welcome screen (and any subsequent fresh conversation) starts clean
      // — without this the previous tool cards / run-phase pill / plan
      // checklist linger because ChatView mounts them unconditionally.
      toolCalls: wasActive ? [] : state.toolCalls,
      runPhase: wasActive ? null : state.runPhase
    }))
    if (wasActive) {
      // Plan store is its own zustand store; the state set above can't
      // reach it. Same lifecycle — clear when the owning conversation
      // disappears.
      usePlanStore.getState().clear()
    }
  },

  sendMessage: async (content: string, activeSkillIds: string[]) => {
    const state = get()
    let conversationId = state.activeConversationId

    if (!conversationId) {
      conversationId = await get().createConversation()
      if (!conversationId) return
    }

    // Resolve attachments + vision check
    const pending = state.pendingAttachments
    const modelInfo = useModelStore.getState().models.find((m) => m.id === state.activeModel)
    const supportsVision = modelInfo?.supportsVision ?? false
    const images = pending.filter((f) => f.kind === 'image')
    const nonImages = pending.filter((f) => f.kind !== 'image')

    if (images.length > 0 && !supportsVision) {
      const label = modelInfo?.name ?? state.activeModel
      toast.warning(
        `${label} does not support images — ${images.length} image attachment${images.length === 1 ? '' : 's'} dropped.`
      )
    }

    const attachmentBlocks = nonImages.map(buildAttachmentBlock).join('')
    const augmentedContent = attachmentBlocks ? `${content}${attachmentBlocks}` : content

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: augmentedContent,
      timestamp: Date.now(),
      conversationId,
      model: state.activeModel
    }

    set((s) => ({
      messages: [...s.messages, userMessage],
      isStreaming: true,
      streamingContent: '',
      streamStartedAt: Date.now(),
      toolCalls: [],
      runPhase: 'understanding',
      pendingAttachments: []
    }))

    const agentMode = useAgentStore.getState().mode
    const result = await window.api.chat.send({
      conversationId,
      model: state.activeModel,
      content: augmentedContent,
      activeSkillIds,
      agentMode
    })

    if (result.success && result.data.conversationId !== conversationId) {
      set({ activeConversationId: result.data.conversationId })
    }

    // Auto-title: first message sets conversation title
    const msgs = get().messages
    const userMsgs = msgs.filter((m) => m.role === 'user')
    if (userMsgs.length === 1) {
      const fallback = content.slice(0, 40)
      const titleConversationId = get().activeConversationId!
      await window.api.conversation.updateTitle(titleConversationId, fallback)
      await get().loadConversations()

      // Optional AI-generated title (fire-and-forget; falls back silently on error)
      if (useSettingsStore.getState().settings.aiGeneratedTitles) {
        void window.api.chat.generateTitle(content).then(async (titleResult) => {
          if (
            titleResult.success &&
            typeof titleResult.data === 'string' &&
            titleResult.data.trim()
          ) {
            await window.api.conversation.updateTitle(titleConversationId, titleResult.data.trim())
            await get().loadConversations()
          }
        })
      }
    }
  },

  cancelStream: () => {
    const id = get().activeConversationId
    if (id) {
      window.api.chat.cancel(id)
    }
  },

  setModel: async (model: string) => {
    const state = get()
    const previousModel = state.activeModel
    if (previousModel === model) return
    set({ activeModel: model })
    void window.api.model.setActive(model)

    const activeId = state.activeConversationId
    const realMessageCount = state.messages.filter(
      (m) => m.role === 'user' || m.role === 'assistant'
    ).length

    if (activeId && realMessageCount > 0) {
      const info = useModelStore.getState().models.find((m) => m.id === model)
      const modelName = info?.name ?? model
      const marker = `— Switched to ${modelName} —`
      const result = await window.api.conversation.appendSystem(activeId, marker)
      if (result.success && result.data) {
        const msg = result.data as Message
        set((s) => ({ messages: [...s.messages, msg] }))
      }
      await window.api.conversation.setModel(activeId, model)
      await get().loadConversations()
    }
  },

  appendStreamChunk: (content: string) => {
    set((state) => ({
      streamingContent: state.streamingContent + content
    }))
  },

  finishStream: (message: Message) => {
    set((state) => ({
      messages: [...state.messages, message],
      isStreaming: false,
      streamingContent: '',
      streamStartedAt: null,
      runPhase: null
    }))
    get().loadConversations()
  },

  streamError: (_error: string) => {
    set({ isStreaming: false, streamingContent: '', streamStartedAt: null, runPhase: null })
  },

  addToolCall: (event: ToolCallEvent) => {
    set((state) => ({
      toolCalls: [
        ...state.toolCalls,
        {
          callId: event.callId,
          serverId: event.serverId,
          toolName: event.toolName,
          args: event.args,
          status: 'running',
          title: event.title,
          risks: event.risks,
          providerKind: event.providerKind,
          startedAt: event.startedAt
        }
      ]
    }))
  },

  updateToolCall: (event: ToolCallResultEvent) => {
    // Respect the backend's terminal status — earlier versions hard-coded
    // 'success' even for denied/error results, which made every red X look
    // like a green check until the user expanded the card.
    const finalStatus: ToolCallState['status'] = event.status ?? 'success'
    set((state) => ({
      toolCalls: state.toolCalls.map((tc) =>
        tc.callId === event.callId
          ? { ...tc, status: finalStatus, result: event.result, duration: event.duration }
          : tc
      )
    }))
  },

  clearToolCalls: () => {
    set({ toolCalls: [] })
  },

  setRunPhase: (phase: AgentRunPhase | null) => {
    set({ runPhase: phase })
  },

  addAttachments: (files: ProcessedFile[]) => {
    if (!files.length) return
    // Seed rag-pending files with a queued phase so the chip can render an
    // "Indexing…" state immediately, before the auto-attach IPC returns.
    const seeded = files.map((f) =>
      f.kind === 'rag-pending' && !f.ragPhase
        ? { ...f, ragPhase: 'queued' as const, ragProgress: 0 }
        : f
    )
    set((state) => ({ pendingAttachments: [...state.pendingAttachments, ...seeded] }))
    for (const f of files) {
      if (f.error) toast.warning(`${f.name}: ${f.error}`)
    }

    // Route oversized files through the RAG ingest pipeline. Fired async —
    // each call ensures a per-conversation auto-collection, submits the
    // ingest job, and stamps the returned jobId onto the matching chip so
    // progress events can update it. The auto-attach IPC requires a
    // conversationId; if none exists yet we create one first.
    for (const f of seeded) {
      if (f.kind !== 'rag-pending') continue
      if (!f.sourcePath) {
        console.warn('[chat-store] rag-pending file missing sourcePath:', f.name)
        continue
      }
      void (async () => {
        let convId = get().activeConversationId
        if (!convId) {
          convId = await get().createConversation()
          if (!convId) return
        }
        try {
          const res = await window.api.rag.autoAttach({
            conversationId: convId,
            filePath: f.sourcePath!,
            displayName: f.name
          })
          if (!res?.success) {
            const errMsg = res?.error ?? 'auto-attach failed'
            toast.error(`${f.name}: ${errMsg}`)
            set((state) => ({
              pendingAttachments: state.pendingAttachments.map((a) =>
                a.name === f.name && a.size === f.size && a.kind === 'rag-pending'
                  ? { ...a, ragPhase: 'error' as const, error: errMsg }
                  : a
              )
            }))
            return
          }
          const { jobId, collectionId } = res.data as {
            jobId: string
            collectionId: string
          }
          set((state) => ({
            pendingAttachments: state.pendingAttachments.map((a) =>
              a.name === f.name && a.size === f.size && a.kind === 'rag-pending'
                ? { ...a, ingestJobId: jobId, collectionId }
                : a
            )
          }))
        } catch (err) {
          const msg = (err as Error)?.message ?? 'auto-attach threw'
          toast.error(`${f.name}: ${msg}`)
        }
      })()
    }
  },

  removeAttachment: (index: number) => {
    const removed = get().pendingAttachments[index]
    set((state) => ({
      pendingAttachments: state.pendingAttachments.filter((_, i) => i !== index)
    }))
    // If a rag-pending chip is removed mid-ingest, drop the conversation→
    // collection link so augmentForChat stops querying it. We deliberately
    // do NOT delete the ingested document — it stays in the auto-collection
    // (cheap to keep, expensive to redo); the user can re-add the file later
    // by drag-drop and the dedupe-by-hash path in ingest will reuse it.
    if (
      removed?.kind === 'rag-pending' &&
      removed.collectionId &&
      window.api?.rag?.attachments
    ) {
      const convId = get().activeConversationId
      if (convId) {
        void window.api.rag.attachments.remove({
          conversationId: convId,
          collectionId: removed.collectionId
        })
      }
    }
  },

  /** Internal: progress dispatcher for RAG ingest events. Wired from App.tsx
   *  to `window.api.rag.document.onProgress`. Matches by jobId; no-ops if
   *  the chip was already removed from pendingAttachments. */
  _updateRagAttachmentProgress: (event: {
    jobId: string
    documentId: string
    phase: string
    progress: number
    chunkCount?: number
    error?: string
  }) => {
    set((state) => ({
      pendingAttachments: state.pendingAttachments.map((a) => {
        if (a.kind !== 'rag-pending' || a.ingestJobId !== event.jobId) return a
        return {
          ...a,
          documentId: event.documentId || a.documentId,
          ragPhase: event.phase as ProcessedFile['ragPhase'],
          ragProgress: event.progress,
          ragChunkCount: event.chunkCount ?? a.ragChunkCount,
          error: event.error ?? a.error
        }
      })
    }))
  },

  clearAttachments: () => {
    set({ pendingAttachments: [] })
  },

  setAttachmentsProcessing: (v: boolean) => {
    set({ attachmentsProcessing: v })
  },

  getRecentUserPrompts: (limit = 50) => {
    return getRecentUserPromptsFrom(get().messages, limit)
  }
}))
