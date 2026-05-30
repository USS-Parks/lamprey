import { create } from 'zustand'
import type { Conversation, Message, ToolCallEvent, ToolCallResultEvent } from '@/lib/types'

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

  loadConversations: () => Promise<void>
  selectConversation: (id: string) => Promise<void>
  createConversation: () => Promise<string>
  deleteConversation: (id: string) => Promise<void>
  sendMessage: (content: string, activeSkillIds: string[]) => Promise<void>
  cancelStream: () => void
  setModel: (model: string) => void
  appendStreamChunk: (content: string) => void
  finishStream: (message: Message) => void
  streamError: (error: string) => void
  addToolCall: (event: ToolCallEvent) => void
  updateToolCall: (event: ToolCallResultEvent) => void
  clearToolCalls: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  messages: [],
  isStreaming: false,
  streamingContent: '',
  activeModel: 'deepseek-chat',
  toolCalls: [],

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

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
      conversationId,
      model: state.activeModel
    }

    set((s) => ({
      messages: [...s.messages, userMessage],
      isStreaming: true,
      streamingContent: '',
      toolCalls: []
    }))

    const result = await window.api.chat.send({
      conversationId,
      model: state.activeModel,
      content,
      activeSkillIds
    })

    if (result.success && result.data.conversationId !== conversationId) {
      set({ activeConversationId: result.data.conversationId })
    }

    // Auto-title: first message sets conversation title
    const msgs = get().messages
    const userMsgs = msgs.filter((m) => m.role === 'user')
    if (userMsgs.length === 1) {
      const title = content.slice(0, 40)
      await window.api.conversation.updateTitle(
        get().activeConversationId!,
        title
      )
      await get().loadConversations()
    }
  },

  cancelStream: () => {
    const id = get().activeConversationId
    if (id) {
      window.api.chat.cancel(id)
    }
  },

  setModel: (model: string) => {
    set({ activeModel: model })
    window.api.model.setActive(model)
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
  }
}))
