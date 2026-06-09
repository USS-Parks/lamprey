import { create } from 'zustand'
import type {
  AgentRunPhase,
  Conversation,
  DocumentAttachment,
  Message,
  ProcessedFile,
  ToolCallEvent,
  ToolCallResultEvent,
  ToolProviderKind,
  ToolRisk,
  ForkParams
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
  // True when MessageList must skip rendering a ToolUseCard for this call —
  // see LampreyToolDescriptor.transcriptHidden.
  transcriptHidden?: boolean
}

interface ChatState {
  conversations: Conversation[]
  activeConversationId: string | null
  messages: Message[]
  isStreaming: boolean
  streamingContent: string
  /** Live chain-of-thought captured off the provider's reasoning channel
   *  (DeepSeek `delta.reasoning_content`, OpenRouter `delta.reasoning`).
   *  Reset when a new stream starts; cleared on finishStream/streamError. */
  streamingReasoning: string
  /** Documents the model emitted via `create_document` during the current
   *  in-flight turn. Appended on `chat:document-created`; cleared on
   *  finishStream/streamError. The persisted message returned by chat:done
   *  already carries the same attachments, so the live buffer is only for
   *  rendering during the streaming bubble. */
  streamingDocuments: DocumentAttachment[]
  streamStartedAt: number | null
  /** T4 — last streaming-vitals heartbeat (lastChunkAt, chunkCount, etc.).
   *  Null when no stream is active or the provider hasn't fired a heartbeat
   *  yet. Drives the "Ns since last chunk" indicator in the streaming pill. */
  streamingVitals: {
    lastChunkAt: number
    msSinceLastChunk: number
    chunkCount: number
    tokenEstimate: number
    attemptElapsedMs: number
  } | null
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
  forkFromMessage: (messageId: string, opts?: Partial<ForkParams>) => Promise<string | null>
  deleteConversation: (id: string) => Promise<void>
  sendMessage: (content: string, activeSkillIds: string[]) => Promise<void>
  cancelStream: () => void
  setModel: (model: string) => Promise<void>
  appendStreamChunk: (content: string) => void
  appendReasoningChunk: (content: string) => void
  appendStreamingDocument: (doc: DocumentAttachment) => void
  /** Reasoning Audit Phase R4 — append a persisted Planner audit row
   *  mid-pipeline (between Planner and Coder stages). Unlike
   *  finishStream, this does NOT clear streaming state — the Coder is
   *  still streaming when the Planner row arrives. Idempotent on
   *  message.id so a duplicate event is dropped. */
  appendPlannerMessage: (message: Message) => void
  finishStream: (message: Message) => void
  streamError: (error: string) => void
  setStreamingVitals: (
    v: ChatState['streamingVitals']
  ) => void
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

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err.trim()) return err
  return fallback
}

// Walk a freshly-loaded message list and synthesize ToolCallState entries
// for every recorded tool invocation, pairing each assistant tool_call with
// its matching tool-role result message. Used by selectConversation so the
// ToolActivityChip re-populates on conversation reopen — without this the
// chip stays empty until a new live event arrives, hiding every prior turn's
// work from the user. Descriptor metadata (title, risks, providerKind) is
// not persisted, so historical entries leave those undefined; the cards
// gracefully fall back to toolName + args.
function hydrateToolCallsFromHistory(messages: Message[]): ToolCallState[] {
  const resultsByCallId = new Map<
    string,
    { result: string; timestamp: number }
  >()
  for (const m of messages) {
    if (m.role === 'tool' && m.toolCallId) {
      resultsByCallId.set(m.toolCallId, {
        result: m.content,
        timestamp: m.timestamp
      })
    }
  }
  const out: ToolCallState[] = []
  for (const m of messages) {
    if (m.role !== 'assistant' || !m.toolCalls) continue
    for (const tc of m.toolCalls) {
      let args: Record<string, unknown> = {}
      try {
        const parsed = JSON.parse(tc.function.arguments)
        if (parsed && typeof parsed === 'object') args = parsed as Record<string, unknown>
      } catch {
        // Arguments string isn't valid JSON — leave args empty. ToolUseCard
        // renders the raw arguments string as a fallback when args is empty.
      }
      const r = resultsByCallId.get(tc.id)
      out.push({
        callId: tc.id,
        // Descriptor data isn't persisted; 'history' is a neutral marker that
        // tells the renderer this entry came from a reopen, not a live run.
        serverId: 'history',
        toolName: tc.function.name,
        args,
        status: r ? 'success' : 'error',
        result: r?.result,
        startedAt: m.timestamp,
        duration: r ? Math.max(0, r.timestamp - m.timestamp) : undefined
      })
    }
  }
  return out
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messages: [],
  isStreaming: false,
  streamingContent: '',
  streamingReasoning: '',
  streamingDocuments: [],
  streamStartedAt: null,
  streamingVitals: null,
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
      set({
        messages: result.data,
        // Rehydrate the tool-activity chip from history so reopening a
        // previously-finished conversation still shows what work the model
        // did, not an empty chip. Live events from a new turn will append
        // to this list via addToolCall.
        toolCalls: hydrateToolCallsFromHistory(result.data)
      })
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
    try {
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
      const msg = result.error ?? 'Could not create conversation'
      console.error('[chat-store] conversation:create failed:', msg)
      toast.error(msg)
    } catch (err) {
      const msg = errorMessage(err, 'Could not create conversation')
      console.error('[chat-store] conversation:create threw:', err)
      toast.error(msg)
    }
    return ''
  },

  forkFromMessage: async (messageId: string, opts: Partial<ForkParams> = {}) => {
    const state = get()
    const sourceConversationId = state.activeConversationId
    if (!sourceConversationId) return null
    const message = state.messages.find((m) => m.id === messageId)
    if (!message) {
      toast.error('Could not find the message to fork from')
      return null
    }
    const result = await window.api.conversation.fork({
      sourceConversationId,
      sourceMessageId: messageId,
      seedKind: opts.seedKind ?? 'message',
      seedContent: opts.seedContent ?? message.content,
      includeRagAttachments: opts.includeRagAttachments ?? true,
      workspaceMode: opts.workspaceMode ?? 'current',
      titleOverride: opts.titleOverride
    })
    if (!result.success) {
      toast.error(result.error ?? 'Could not create fork')
      return null
    }
    const nextId = (result.data as { conversationId: string }).conversationId
    await get().loadConversations()
    await get().selectConversation(nextId)
    toast.success('Fork created')
    return nextId
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
      streamingReasoning: '',
      streamingDocuments: [],
      streamingVitals: null,
      streamStartedAt: Date.now(),
      toolCalls: [],
      runPhase: 'understanding',
      pendingAttachments: []
    }))

    // L8 (Lampshade Phase, 2026-06-09) — the chat:send per-turn override
    // remains binary ('single' | 'multi' | undefined). When the user picks
    // 'auto' in Settings, the dispatch decision is made server-side by
    // resolveAgentDispatch + routeAgentMode based on settings.agentMode,
    // not the per-turn override. So we leave the override undefined here.
    const storedMode = useAgentStore.getState().mode
    const agentMode = storedMode === 'auto' ? undefined : storedMode
    let result
    try {
      result = await window.api.chat.send({
        conversationId,
        model: state.activeModel,
        content: augmentedContent,
        activeSkillIds,
        agentMode
      })
    } catch (err) {
      const msg = errorMessage(err, 'Message failed')
      console.error('[chat-store] chat:send threw:', err)
      toast.error(msg)
      get().streamError(msg)
      return
    }

    if (!result.success) {
      const msg = result.error ?? 'Message failed'
      console.error('[chat-store] chat:send failed:', msg)
      toast.error(msg)
      get().streamError(msg)
      return
    }

    if (result.data.conversationId !== conversationId) {
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

  appendReasoningChunk: (content: string) => {
    set((state) => ({
      streamingReasoning: state.streamingReasoning + content
    }))
  },

  appendStreamingDocument: (doc: DocumentAttachment) => {
    set((state) => ({
      streamingDocuments: [...state.streamingDocuments, doc]
    }))
  },

  setStreamingVitals: (v) => {
    set({ streamingVitals: v })
  },

  appendPlannerMessage: (message: Message) => {
    set((state) => {
      // Idempotent — duplicate planner-message events (e.g. re-fire after
      // a brief disconnect) shouldn't double-append.
      if (state.messages.some((m) => m.id === message.id)) return state
      return { messages: [...state.messages, message] }
    })
  },

  finishStream: (message: Message) => {
    set((state) => ({
      messages: [...state.messages, message],
      isStreaming: false,
      streamingContent: '',
      streamingReasoning: '',
      streamingDocuments: [],
      streamingVitals: null,
      streamStartedAt: null,
      runPhase: null
    }))
    get().loadConversations()
  },

  streamError: (_error: string) => {
    set({
      isStreaming: false,
      streamingContent: '',
      streamingReasoning: '',
      streamingDocuments: [],
      streamingVitals: null,
      streamStartedAt: null,
      runPhase: null
    })
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
          startedAt: event.startedAt,
          transcriptHidden: event.transcriptHidden
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
