import { create } from 'zustand'
import type {
  Conversation,
  Message,
  ProcessedFile,
  ToolCallEvent,
  ToolCallResultEvent
} from '@/lib/types'
import { useSettingsStore } from '@/stores/settings-store'
import { useModelStore } from '@/stores/model-store'
import { useAgentStore } from '@/stores/agent-store'
import { toast } from '@/stores/toast-store'

export interface ToolCallState {
  callId: string
  serverId: string
  toolName: string
  args: Record<string, unknown>
  status: 'pending' | 'running' | 'success' | 'error'
  result?: string
  duration?: number
}

interface ChatState {
  conversations: Conversation[]
  activeConversationId: string | null
  messages: Message[]
  isStreaming: boolean
  streamingContent: string
  activeModel: string
  toolCalls: ToolCallState[]
  pendingAttachments: ProcessedFile[]
  attachmentsProcessing: boolean

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
  addAttachments: (files: ProcessedFile[]) => void
  removeAttachment: (index: number) => void
  clearAttachments: () => void
  setAttachmentsProcessing: (v: boolean) => void
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
  return ''
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messages: [],
  isStreaming: false,
  streamingContent: '',
  activeModel: 'deepseek-v4-pro',
  toolCalls: [],
  pendingAttachments: [],
  attachmentsProcessing: false,

  loadConversations: async () => {
    const result = await window.api.conversation.list()
    if (result.success) {
      set({ conversations: result.data })
    }
  },

  selectConversation: async (id: string) => {
    set({ activeConversationId: id, toolCalls: [] })
    const result = await window.api.conversation.getMessages(id)
    if (result.success) {
      set({ messages: result.data })
    }
    const conv = get().conversations.find((c) => c.id === id)
    if (conv) {
      set({ activeModel: conv.model })
    }
  },

  createConversation: async () => {
    const model = get().activeModel
    const result = await window.api.conversation.create(model)
    if (result.success) {
      const conv = result.data
      set((state) => ({
        conversations: [conv, ...state.conversations],
        activeConversationId: conv.id,
        messages: [],
        toolCalls: []
      }))
      return conv.id
    }
    return ''
  },

  deleteConversation: async (id: string) => {
    await window.api.conversation.delete(id)
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== id),
      activeConversationId: state.activeConversationId === id ? null : state.activeConversationId,
      messages: state.activeConversationId === id ? [] : state.messages
    }))
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
      toolCalls: [],
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
      streamingContent: ''
    }))
    get().loadConversations()
  },

  streamError: (_error: string) => {
    set({ isStreaming: false, streamingContent: '' })
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
          status: 'pending'
        }
      ]
    }))
  },

  updateToolCall: (event: ToolCallResultEvent) => {
    set((state) => ({
      toolCalls: state.toolCalls.map((tc) =>
        tc.callId === event.callId
          ? { ...tc, status: 'success' as const, result: event.result, duration: event.duration }
          : tc
      )
    }))
  },

  clearToolCalls: () => {
    set({ toolCalls: [] })
  },

  addAttachments: (files: ProcessedFile[]) => {
    if (!files.length) return
    set((state) => ({ pendingAttachments: [...state.pendingAttachments, ...files] }))
    for (const f of files) {
      if (f.error) toast.warning(`${f.name}: ${f.error}`)
    }
  },

  removeAttachment: (index: number) => {
    set((state) => ({
      pendingAttachments: state.pendingAttachments.filter((_, i) => i !== index)
    }))
  },

  clearAttachments: () => {
    set({ pendingAttachments: [] })
  },

  setAttachmentsProcessing: (v: boolean) => {
    set({ attachmentsProcessing: v })
  }
}))
