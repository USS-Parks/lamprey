import { contextBridge, ipcRenderer, webUtils } from 'electron'

const api = {
  chat: {
    send: (request: {
      conversationId: string
      model: string
      content: string
      activeSkillIds: string[]
    }) => ipcRenderer.invoke('chat:send', request),
    cancel: (conversationId: string) => ipcRenderer.invoke('chat:cancel', conversationId),
    generateTitle: (content: string) => ipcRenderer.invoke('chat:generateTitle', content),
    onChunk: (cb: (e: { conversationId: string; content: string }) => void) =>
      ipcRenderer.on('chat:chunk', (_, e) => cb(e)),
    onDone: (cb: (e: { conversationId: string; message: unknown }) => void) =>
      ipcRenderer.on('chat:done', (_, e) => cb(e)),
    onError: (cb: (e: { conversationId: string; error: string }) => void) =>
      ipcRenderer.on('chat:error', (_, e) => cb(e)),
    onToolCall: (cb: (e: unknown) => void) => ipcRenderer.on('chat:tool-call', (_, e) => cb(e)),
    onToolCallResult: (cb: (e: unknown) => void) =>
      ipcRenderer.on('chat:tool-call-result', (_, e) => cb(e)),
    offAll: () => {
      ;[
        'chat:chunk',
        'chat:done',
        'chat:error',
        'chat:tool-call',
        'chat:tool-call-result'
      ].forEach((ch) => ipcRenderer.removeAllListeners(ch))
    }
  },

  conversation: {
    list: () => ipcRenderer.invoke('conversation:list'),
    get: (id: string) => ipcRenderer.invoke('conversation:get', id),
    create: (model: string) => ipcRenderer.invoke('conversation:create', model),
    delete: (id: string) => ipcRenderer.invoke('conversation:delete', id),
    updateTitle: (id: string, title: string) =>
      ipcRenderer.invoke('conversation:updateTitle', id, title),
    getMessages: (id: string) => ipcRenderer.invoke('conversation:getMessages', id),
    appendSystem: (id: string, content: string) =>
      ipcRenderer.invoke('conversation:appendSystem', id, content),
    setModel: (id: string, model: string) => ipcRenderer.invoke('conversation:setModel', id, model)
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (partial: Record<string, unknown>) => ipcRenderer.invoke('settings:set', partial),
    saveApiKey: (key: string) => ipcRenderer.invoke('settings:saveApiKey', key),
    hasApiKey: () => ipcRenderer.invoke('settings:hasApiKey'),
    testApiKey: () => ipcRenderer.invoke('settings:testApiKey'),
    saveGoogleCredentials: (clientId: string, clientSecret: string) =>
      ipcRenderer.invoke('settings:saveGoogleCredentials', clientId, clientSecret),
    deleteApiKey: () => ipcRenderer.invoke('settings:deleteApiKey'),
    isEncryptionAvailable: () => ipcRenderer.invoke('settings:isEncryptionAvailable')
  },

  model: {
    list: () => ipcRenderer.invoke('model:list'),
    getActive: () => ipcRenderer.invoke('model:getActive'),
    setActive: (id: string) => ipcRenderer.invoke('model:setActive', id)
  },

  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    create: (skill: { name: string; description: string; content: string }) =>
      ipcRenderer.invoke('skills:create', skill),
    update: (id: string, skill: { name: string; description: string; content: string }) =>
      ipcRenderer.invoke('skills:update', id, skill),
    delete: (id: string) => ipcRenderer.invoke('skills:delete', id),
    onChanged: (cb: (skills: unknown[]) => void) =>
      ipcRenderer.on('skills:changed', (_, skills) => cb(skills))
  },

  memory: {
    list: () => ipcRenderer.invoke('memory:list'),
    add: (content: string) => ipcRenderer.invoke('memory:add', content),
    update: (id: number, content: string) => ipcRenderer.invoke('memory:update', id, content),
    delete: (id: number) => ipcRenderer.invoke('memory:delete', id),
    clear: () => ipcRenderer.invoke('memory:clear'),
    export: () => ipcRenderer.invoke('memory:export'),
    import: (entries: unknown[]) => ipcRenderer.invoke('memory:import', entries),
    onAdded: (cb: (entry: unknown) => void) =>
      ipcRenderer.on('memory:added', (_, entry) => cb(entry))
  },

  mcp: {
    list: () => ipcRenderer.invoke('mcp:list'),
    getStatus: (id: string) => ipcRenderer.invoke('mcp:getStatus', id),
    reconnect: (id: string) => ipcRenderer.invoke('mcp:reconnect', id),
    setupGoogleOAuth: () => ipcRenderer.invoke('mcp:setupGoogleOAuth'),
    approveToolCall: (callId: string, approved: boolean) =>
      ipcRenderer.invoke('mcp:approveToolCall', callId, approved),
    onStatusChanged: (cb: (e: unknown) => void) =>
      ipcRenderer.on('mcp:statusChanged', (_, e) => cb(e)),
    onConfirmationRequired: (cb: (e: unknown) => void) =>
      ipcRenderer.on('mcp:confirmationRequired', (_, e) => cb(e))
  },

  files: {
    process: (paths: string[]) => ipcRenderer.invoke('files:process', paths),
    openPicker: () => ipcRenderer.invoke('files:openPicker'),
    getPathForFile: (file: File) => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return ''
      }
    }
  },

  artifact: {
    render: (type: string, content: string) =>
      ipcRenderer.invoke('artifact:render', type, content),
    hide: () => ipcRenderer.invoke('artifact:hide'),
    resize: (bounds: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke('artifact:resize', bounds),
    openInWindow: (type: string, content: string) =>
      ipcRenderer.invoke('artifact:openInWindow', type, content),
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
    getSource: () => ipcRenderer.invoke('artifact:getSource'),
    getType: () => ipcRenderer.invoke('artifact:getType')
  },

  update: {
    onAvailable: (cb: (info: { version: string | null; releaseNotes: string | null }) => void) =>
      ipcRenderer.on('update:available', (_, info) => cb(info)),
    onDownloaded: (cb: (info: { version: string | null }) => void) =>
      ipcRenderer.on('update:downloaded', (_, info) => cb(info)),
    onError: (cb: (e: { message: string }) => void) =>
      ipcRenderer.on('update:error', (_, e) => cb(e)),
    restart: () => ipcRenderer.invoke('update:restart'),
    check: () => ipcRenderer.invoke('update:check')
  },

  shortcuts: {
    onCopyLastAssistant: (cb: () => void) =>
      ipcRenderer.on('shortcut:copyLastAssistant', () => cb())
  },

  tray: {
    onNewConversation: (cb: () => void) =>
      ipcRenderer.on('tray:newConversation', () => cb())
  },

  clipboard: {
    writeText: (text: string) => ipcRenderer.invoke('clipboard:writeText', text)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type LampreyAPI = typeof api
