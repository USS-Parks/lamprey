import { contextBridge, ipcRenderer, webUtils } from 'electron'

const api = {
  chat: {
    send: (request: {
      conversationId: string
      model: string
      content: string
      activeSkillIds: string[]
      agentMode?: 'single' | 'multi'
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
    onPhase: (cb: (e: { conversationId: string; phase: string }) => void) =>
      ipcRenderer.on('chat:phase', (_, e) => cb(e)),
    onAgentStatus: (cb: (e: unknown) => void) =>
      ipcRenderer.on('agent:status', (_, e) => cb(e)),
    offAll: () => {
      ;[
        'chat:chunk',
        'chat:done',
        'chat:error',
        'chat:tool-call',
        'chat:tool-call-result',
        'chat:phase',
        'agent:status'
      ].forEach((ch) => ipcRenderer.removeAllListeners(ch))
    },
    // Per-conversation subscription that returns an unsubscribe function.
    // Use for side-chat panels so they don't fight the global useChat listener.
    subscribe: (
      conversationId: string,
      cbs: {
        onChunk?: (e: { conversationId: string; content: string }) => void
        onDone?: (e: { conversationId: string; message: unknown }) => void
        onError?: (e: { conversationId: string; error: string }) => void
      }
    ) => {
      const handlers: Array<[string, (...args: any[]) => void]> = []
      const wire = (channel: string, fn?: (e: any) => void) => {
        if (!fn) return
        const h = (_: any, e: any) => {
          if (e?.conversationId === conversationId) fn(e)
        }
        ipcRenderer.on(channel, h)
        handlers.push([channel, h])
      }
      wire('chat:chunk', cbs.onChunk)
      wire('chat:done', cbs.onDone)
      wire('chat:error', cbs.onError)
      return () => {
        for (const [ch, h] of handlers) ipcRenderer.removeListener(ch, h)
      }
    }
  },

  conversation: {
    list: () => ipcRenderer.invoke('conversation:list'),
    get: (id: string) => ipcRenderer.invoke('conversation:get', id),
    create: (
      model: string,
      opts?: {
        kind?: 'local' | 'cloud' | 'worktree'
        worktreePath?: string | null
        projectId?: string | null
      }
    ) => ipcRenderer.invoke('conversation:create', model, opts),
    delete: (id: string) => ipcRenderer.invoke('conversation:delete', id),
    updateTitle: (id: string, title: string) =>
      ipcRenderer.invoke('conversation:updateTitle', id, title),
    getMessages: (id: string) => ipcRenderer.invoke('conversation:getMessages', id),
    appendSystem: (id: string, content: string) =>
      ipcRenderer.invoke('conversation:appendSystem', id, content),
    setModel: (id: string, model: string) =>
      ipcRenderer.invoke('conversation:setModel', id, model),
    fork: (id: string) => ipcRenderer.invoke('conversation:fork', id),
    compact: (id: string) => ipcRenderer.invoke('conversation:compact', id)
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (partial: Record<string, unknown>) => ipcRenderer.invoke('settings:set', partial),

    listProviderKeys: () => ipcRenderer.invoke('settings:listProviderKeys'),
    saveProviderKey: (provider: string, key: string) =>
      ipcRenderer.invoke('settings:saveProviderKey', provider, key),
    hasProviderKey: (provider: string) =>
      ipcRenderer.invoke('settings:hasProviderKey', provider),
    testProviderKey: (provider: string) =>
      ipcRenderer.invoke('settings:testProviderKey', provider),
    deleteProviderKey: (provider: string) =>
      ipcRenderer.invoke('settings:deleteProviderKey', provider),

    saveApiKey: (key: string) => ipcRenderer.invoke('settings:saveApiKey', key),
    hasApiKey: () => ipcRenderer.invoke('settings:hasApiKey'),
    testApiKey: () => ipcRenderer.invoke('settings:testApiKey'),
    saveGoogleCredentials: (clientId: string, clientSecret: string) =>
      ipcRenderer.invoke('settings:saveGoogleCredentials', clientId, clientSecret),
    deleteApiKey: () => ipcRenderer.invoke('settings:deleteApiKey'),
    isEncryptionAvailable: () => ipcRenderer.invoke('settings:isEncryptionAvailable'),
    grantPlaintextConsent: () => ipcRenderer.invoke('settings:grantPlaintextConsent'),
    hasPlaintextConsent: () => ipcRenderer.invoke('settings:hasPlaintextConsent')
  },

  model: {
    list: () => ipcRenderer.invoke('model:list'),
    listProviders: () => ipcRenderer.invoke('model:listProviders'),
    getActive: () => ipcRenderer.invoke('model:getActive'),
    setActive: (id: string) => ipcRenderer.invoke('model:setActive', id),
    addCustom: (model: {
      id: string
      name: string
      provider?: string
      contextWindow: number
      supportsTools: boolean
      supportsVision: boolean
    }) => ipcRenderer.invoke('model:addCustom', model),
    removeCustom: (id: string) => ipcRenderer.invoke('model:removeCustom', id),
    verifyCatalog: () => ipcRenderer.invoke('model:verifyCatalog')
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

  tools: {
    list: () => ipcRenderer.invoke('tools:list'),
    get: (id: string) => ipcRenderer.invoke('tools:get', id),
    getRecentCalls: (limit?: number) => ipcRenderer.invoke('tools:getRecentCalls', limit),
    getCallsForConversation: (conversationId: string, limit?: number) =>
      ipcRenderer.invoke('tools:getCallsForConversation', conversationId, limit),
    /**
     * Subscribe to approval requests. Returns an unsubscribe function so
     * effect cleanup (hot reload, dialog remount) can detach the listener
     * and avoid duplicate modal handling.
     */
    onApprovalRequired: (cb: (e: unknown) => void): (() => void) => {
      const handler = (_: unknown, e: unknown): void => cb(e)
      ipcRenderer.on('tools:approvalRequired', handler)
      return () => ipcRenderer.removeListener('tools:approvalRequired', handler)
    },
    respondToApproval: (response: {
      callId: string
      decision: 'allow' | 'deny'
      scope: 'once' | 'conversation' | 'workspace' | 'always'
    }) => ipcRenderer.invoke('tools:respondToApproval', response)
  },

  permissions: {
    listGlobalPolicies: () => ipcRenderer.invoke('permissions:listGlobalPolicies'),
    setGlobalPolicy: (toolId: string, decision: 'allow' | 'deny' | null) =>
      ipcRenderer.invoke('permissions:setGlobalPolicy', toolId, decision),
    clearConversationPolicies: (conversationId: string) =>
      ipcRenderer.invoke('permissions:clearConversationPolicies', conversationId),
    // Wider policy CRUD — Settings UI uses these to inspect/edit any scope.
    listPolicies: () => ipcRenderer.invoke('permissions:listPolicies'),
    addPolicy: (input: {
      scope: 'conversation' | 'workspace' | 'global'
      subjectKind: 'tool' | 'risk'
      subject: string
      decision: 'allow' | 'deny'
      conversationId?: string
      workspacePath?: string
    }) => ipcRenderer.invoke('permissions:addPolicy', input),
    deletePolicy: (id: string) => ipcRenderer.invoke('permissions:deletePolicy', id),
    clearScope: (scope: 'conversation' | 'workspace' | 'global') =>
      ipcRenderer.invoke('permissions:clearScope', scope),
    clearConversation: (conversationId: string) =>
      ipcRenderer.invoke('permissions:clearConversation', conversationId)
  },

  plan: {
    get: (conversationId: string) => ipcRenderer.invoke('plan:get', conversationId),
    listAllState: () => ipcRenderer.invoke('plan:listAllState'),
    clearConversationState: (conversationId: string) =>
      ipcRenderer.invoke('plan:clearConversationState', conversationId),
    clearAllState: () => ipcRenderer.invoke('plan:clearAllState'),
    onUpdated: (cb: (e: { conversationId: string; snapshot: unknown }) => void): (() => void) => {
      const handler = (_: unknown, e: { conversationId: string; snapshot: unknown }) => cb(e)
      ipcRenderer.on('plan:updated', handler)
      return () => ipcRenderer.removeListener('plan:updated', handler)
    }
  },

  files: {
    process: (paths: string[]) => ipcRenderer.invoke('files:process', paths),
    openPicker: () => ipcRenderer.invoke('files:openPicker'),
    getWorkdir: () => ipcRenderer.invoke('files:getWorkdir'),
    pickWorkdir: () => ipcRenderer.invoke('files:pickWorkdir'),
    setWorkdir: (path: string) => ipcRenderer.invoke('files:setWorkdir', path),
    clearWorkdir: () => ipcRenderer.invoke('files:clearWorkdir'),
    openInVSCode: (args?: { targetPath?: string }) =>
      ipcRenderer.invoke('files:openInVSCode', args),
    openInExplorer: (args?: { targetPath?: string }) =>
      ipcRenderer.invoke('files:openInExplorer', args),
    listDir: (dirPath: string) => ipcRenderer.invoke('files:listDir', dirPath),
    readText: (filePath: string) => ipcRenderer.invoke('files:readText', filePath),
    walkProject: (rootPath: string) => ipcRenderer.invoke('files:walkProject', rootPath),
    getPathForFile: (file: File) => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return ''
      }
    }
  },

  hooks: {
    list: () => ipcRenderer.invoke('hooks:list'),
    create: (input: { event: string; label: string; command: string }) =>
      ipcRenderer.invoke('hooks:create', input),
    update: (
      id: string,
      patch: Partial<{ event: string; label: string; command: string; enabled: boolean }>
    ) => ipcRenderer.invoke('hooks:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('hooks:delete', id)
  },

  automations: {
    list: () => ipcRenderer.invoke('automations:list'),
    create: (input: { label: string; cron: string; prompt: string; model?: string }) =>
      ipcRenderer.invoke('automations:create', input),
    update: (
      id: string,
      patch: Partial<{ label: string; cron: string; prompt: string; model: string; enabled: boolean }>
    ) => ipcRenderer.invoke('automations:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('automations:delete', id),
    runNow: (id: string) => ipcRenderer.invoke('automations:runNow', id)
  },

  worktree: {
    list: (args: { cwd?: string }) => ipcRenderer.invoke('worktree:list', args),
    create: (args: { cwd?: string; path: string; branch: string; baseRef?: string }) =>
      ipcRenderer.invoke('worktree:create', args),
    remove: (args: { cwd?: string; path: string; force?: boolean }) =>
      ipcRenderer.invoke('worktree:remove', args)
  },

  projects: {
    list: (args?: { includeArchived?: boolean }) =>
      ipcRenderer.invoke('projects:list', args),
    get: (id: string) => ipcRenderer.invoke('projects:get', id),
    create: (input: { name: string; path?: string | null }) =>
      ipcRenderer.invoke('projects:create', input),
    rename: (id: string, name: string) => ipcRenderer.invoke('projects:rename', id, name),
    setPinned: (id: string, pinned: boolean) =>
      ipcRenderer.invoke('projects:setPinned', id, pinned),
    setArchived: (id: string, archived: boolean) =>
      ipcRenderer.invoke('projects:setArchived', id, archived),
    delete: (id: string) => ipcRenderer.invoke('projects:delete', id),
    openFolder: (id: string) => ipcRenderer.invoke('projects:openFolder', id),
    copyPath: (id: string) => ipcRenderer.invoke('projects:copyPath', id),
    assignConversation: (conversationId: string, projectId: string | null) =>
      ipcRenderer.invoke('projects:assignConversation', conversationId, projectId),
    ensureForPath: (path: string, fallbackName?: string) =>
      ipcRenderer.invoke('projects:ensureForPath', path, fallbackName)
  },

  review: {
    status: (args: { cwd?: string }) => ipcRenderer.invoke('review:status', args),
    diff: (args: { cwd?: string; path?: string; staged?: boolean }) =>
      ipcRenderer.invoke('review:diff', args),
    stage: (args: { cwd?: string; path: string }) => ipcRenderer.invoke('review:stage', args),
    unstage: (args: { cwd?: string; path: string }) => ipcRenderer.invoke('review:unstage', args),
    discard: (args: { cwd?: string; path: string }) => ipcRenderer.invoke('review:discard', args),
    branches: (args?: { cwd?: string }) => ipcRenderer.invoke('review:branches', args),
    checkout: (args: { cwd?: string; name: string }) =>
      ipcRenderer.invoke('review:checkout', args),
    createBranch: (args: { cwd?: string; name: string }) =>
      ipcRenderer.invoke('review:createBranch', args),
    summary: (args?: { cwd?: string }) => ipcRenderer.invoke('review:summary', args),
    commit: (args: { cwd?: string; message: string; stageAll?: boolean }) =>
      ipcRenderer.invoke('review:commit', args),
    push: (args?: { cwd?: string }) => ipcRenderer.invoke('review:push', args),
    onChanged: (cb: (e: { cwd: string }) => void) => {
      const handler = (_: unknown, e: { cwd: string }) => cb(e)
      ipcRenderer.on('review:changed', handler)
      return () => ipcRenderer.removeListener('review:changed', handler)
    }
  },

  browser: {
    newTab: (args: { url?: string }) => ipcRenderer.invoke('browser:newTab', args),
    closeTab: (args: { id: string }) => ipcRenderer.invoke('browser:closeTab', args),
    setActiveTab: (args: { id: string }) => ipcRenderer.invoke('browser:setActiveTab', args),
    navigate: (args: { id: string; url: string }) => ipcRenderer.invoke('browser:navigate', args),
    back: (args: { id: string }) => ipcRenderer.invoke('browser:back', args),
    forward: (args: { id: string }) => ipcRenderer.invoke('browser:forward', args),
    reload: (args: { id: string }) => ipcRenderer.invoke('browser:reload', args),
    setBounds: (args: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke('browser:setBounds', args),
    setVisible: (args: { visible: boolean }) => ipcRenderer.invoke('browser:setVisible', args),
    listTabs: () => ipcRenderer.invoke('browser:listTabs'),
    onTabUpdated: (
      cb: (e: {
        id: string
        title: string
        url: string
        loading: boolean
        canGoBack: boolean
        canGoForward: boolean
      }) => void
    ) => ipcRenderer.on('browser:tabUpdated', (_, e) => cb(e)),
    onTabClosed: (cb: (e: { id: string; activeTabId: string | null }) => void) =>
      ipcRenderer.on('browser:tabClosed', (_, e) => cb(e)),
    onActiveTab: (cb: (e: { id: string }) => void) =>
      ipcRenderer.on('browser:activeTab', (_, e) => cb(e)),
    offAll: () => {
      ;['browser:tabUpdated', 'browser:tabClosed', 'browser:activeTab'].forEach((ch) =>
        ipcRenderer.removeAllListeners(ch)
      )
    }
  },

  terminal: {
    spawn: (args: {
      id: string
      cwd?: string
      shellKind?: 'powershell' | 'cmd' | 'git-bash' | 'wsl'
    }) => ipcRenderer.invoke('terminal:spawn', args),
    write: (args: { id: string; data: string }) => ipcRenderer.invoke('terminal:write', args),
    resize: (args: { id: string; cols: number; rows: number }) =>
      ipcRenderer.invoke('terminal:resize', args),
    kill: (args: { id: string }) => ipcRenderer.invoke('terminal:kill', args),
    onData: (cb: (e: { id: string; chunk: string }) => void) => {
      const handler = (_: unknown, e: { id: string; chunk: string }) => cb(e)
      ipcRenderer.on('terminal:data', handler)
      return () => ipcRenderer.removeListener('terminal:data', handler)
    },
    onExit: (cb: (e: { id: string; code: number | null; signal: string | null }) => void) => {
      const handler = (_: unknown, e: { id: string; code: number | null; signal: string | null }) =>
        cb(e)
      ipcRenderer.on('terminal:exit', handler)
      return () => ipcRenderer.removeListener('terminal:exit', handler)
    },
    offAll: () => {
      ;['terminal:data', 'terminal:exit'].forEach((ch) => ipcRenderer.removeAllListeners(ch))
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
  },

  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximizeToggle: () => ipcRenderer.invoke('window:maximizeToggle'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    reload: () => ipcRenderer.invoke('window:reload'),
    toggleDevTools: () => ipcRenderer.invoke('window:toggleDevTools'),
    onMaximizedChanged: (cb: (maximized: boolean) => void): (() => void) => {
      const handler = (_: unknown, maximized: boolean) => cb(maximized)
      ipcRenderer.on('window:maximizedChanged', handler)
      return () => {
        ipcRenderer.removeListener('window:maximizedChanged', handler)
      }
    }
  },

  webTools: {
    setProvider: (provider: string, opts: { apiKey?: string; endpoint?: string }) =>
      ipcRenderer.invoke('webTools:setProvider', provider, opts),
    getProvider: () => ipcRenderer.invoke('webTools:getProvider'),
    testAdapter: () => ipcRenderer.invoke('webTools:testAdapter'),
    deleteKey: (provider: string) => ipcRenderer.invoke('webTools:deleteKey', provider)
  },

  currentInfo: {
    setProvider: (kind: string, provider: string, opts: { apiKey?: string }) =>
      ipcRenderer.invoke('currentInfo:setProvider', kind, provider, opts),
    getProvider: (kind?: string) => ipcRenderer.invoke('currentInfo:getProvider', kind),
    test: (kind: string) => ipcRenderer.invoke('currentInfo:test', kind)
  },

  imageGen: {
    setProvider: (provider: string, opts: { apiKey?: string; model?: string }) =>
      ipcRenderer.invoke('imageGen:setProvider', provider, opts),
    getProvider: () => ipcRenderer.invoke('imageGen:getProvider'),
    test: () => ipcRenderer.invoke('imageGen:test')
  },

  github: {
    status: () => ipcRenderer.invoke('github:status'),
    saveOAuthClient: (args: { clientId: string; clientSecret: string }) =>
      ipcRenderer.invoke('github:saveOAuthClient', args),
    hasOAuthClient: () => ipcRenderer.invoke('github:hasOAuthClient'),
    hasBundledClient: () => ipcRenderer.invoke('github:hasBundledClient'),
    setMode: (mode: 'oauth' | 'github_app' | 'gh-cli' | 'none') =>
      ipcRenderer.invoke('github:setMode', mode),
    connect: () => ipcRenderer.invoke('github:connect'),
    disconnect: () => ipcRenderer.invoke('github:disconnect'),
    viewer: () => ipcRenderer.invoke('github:viewer'),
    repositories: (args?: { page?: number; perPage?: number }) =>
      ipcRenderer.invoke('github:repositories', args),
    getRepository: (args: { owner: string; repo: string }) =>
      ipcRenderer.invoke('github:getRepository', args),
    pickCloneDir: () => ipcRenderer.invoke('github:pickCloneDir'),
    clone: (args: { owner: string; repo: string; targetDir: string }) =>
      ipcRenderer.invoke('github:clone', args),
    resolveCloneTarget: (args: { baseDir: string; repoName: string }) =>
      ipcRenderer.invoke('github:resolveCloneTarget', args),
    getProjectRepo: (args: { projectId: string }) =>
      ipcRenderer.invoke('github:getProjectRepo', args),
    assignRepoToProject: (args: {
      projectId: string
      owner: string
      repo: string
      localPath?: string | null
    }) => ipcRenderer.invoke('github:assignRepoToProject', args),
    unlinkRepo: (args: { projectId: string }) =>
      ipcRenderer.invoke('github:unlinkRepo', args),
    compare: (args: { owner: string; repo: string; base: string; head: string }) =>
      ipcRenderer.invoke('github:compare', args),
    createPullRequest: (args: {
      owner: string
      repo: string
      title: string
      body?: string
      head: string
      base: string
      draft?: boolean
      headLabel?: string
      conversationId?: string
    }) => ipcRenderer.invoke('github:createPullRequest', args),
    pullRequests: (args: {
      owner: string
      repo: string
      state?: 'open' | 'closed' | 'all'
      per_page?: number
    }) => ipcRenderer.invoke('github:pullRequests', args),
    getPullRequest: (args: { owner: string; repo: string; number: number }) =>
      ipcRenderer.invoke('github:getPullRequest', args),
    listConversationPullRequests: (args: { conversationId: string }) =>
      ipcRenderer.invoke('github:listConversationPullRequests', args),
    pushBranch: (args: {
      cwd: string
      branch: string
      owner: string
      repo: string
      setUpstream?: boolean
    }) => ipcRenderer.invoke('github:pushBranch', args),
    openInBrowser: (url: string) => ipcRenderer.invoke('github:openInBrowser', url),
    onTokenRejected: (cb: () => void): (() => void) => {
      const handler = () => cb()
      ipcRenderer.on('github:tokenRejected', handler)
      return () => ipcRenderer.removeListener('github:tokenRejected', handler)
    }
  },

  // Read-only access to the event spine. There is no `record` here — the
  // renderer must NOT be able to write into the audit log; producers live in
  // main-process services so the spine reflects what the harness actually did,
  // not what an arbitrary renderer claims it did.
  events: {
    list: (filter?: unknown) => ipcRenderer.invoke('events:list', filter ?? {}),
    get: (id: string) => ipcRenderer.invoke('events:get', id),
    timeline: (filter: unknown) => ipcRenderer.invoke('events:timeline', filter)
  },

  // Local RAG (Lamprey RAG Plan, R1+). R1 ships collection CRUD; R2 adds the
  // embedder catalogue + active-id surface. Document / query / attachment
  // namespaces arrive in R5-R12. `embed()` is intentionally NOT exposed —
  // raw embedding access would let a renderer DoS the worker.
  rag: {
    status: () => ipcRenderer.invoke('rag:status'),
    collection: {
      list: () => ipcRenderer.invoke('rag:collection:list'),
      create: (input: {
        name: string
        description?: string
        embedderId: string
        chunkSize?: number
        chunkOverlap?: number
        workspacePath?: string
        projectId?: string
      }) => ipcRenderer.invoke('rag:collection:create', input),
      update: (
        id: string,
        patch: {
          name?: string
          description?: string
          embedderId?: string
          chunkSize?: number
          chunkOverlap?: number
          workspacePath?: string
          projectId?: string
        }
      ) => ipcRenderer.invoke('rag:collection:update', id, patch),
      delete: (id: string) => ipcRenderer.invoke('rag:collection:delete', id)
    },
    embedder: {
      catalog: () => ipcRenderer.invoke('rag:embedder:catalog'),
      active: () => ipcRenderer.invoke('rag:embedder:active'),
      setActive: (id: string) => ipcRenderer.invoke('rag:embedder:setActive', id)
    },
    // R5 document + ingest surface. `onProgress` returns an unsubscribe
    // function so effect cleanup (hot reload, tab switch) detaches the
    // listener without duplicating progress event handling.
    document: {
      list: (collectionId: string) =>
        ipcRenderer.invoke('rag:document:list', collectionId),
      ingest: (
        collectionId: string,
        files: Array<{
          path?: string
          text?: string
          name: string
          sourceKind?: string
        }>
      ) => ipcRenderer.invoke('rag:document:ingest', collectionId, files),
      reingest: (documentId: string) =>
        ipcRenderer.invoke('rag:document:reingest', documentId),
      delete: (documentId: string) =>
        ipcRenderer.invoke('rag:document:delete', documentId),
      cancel: (jobId: string) =>
        ipcRenderer.invoke('rag:document:cancel', jobId),
      onProgress: (cb: (e: unknown) => void): (() => void) => {
        const handler = (_: unknown, e: unknown): void => cb(e)
        ipcRenderer.on('rag:document:progress', handler)
        return () => ipcRenderer.removeListener('rag:document:progress', handler)
      }
    },
    query: {
      run: (input: {
        query: string
        collectionIds: string[]
        topN?: number
      }) => ipcRenderer.invoke('rag:query:run', input)
    },
    attachments: {
      list: (conversationId: string) =>
        ipcRenderer.invoke('rag:attachments:list', conversationId),
      add: (input: {
        conversationId: string
        collectionId?: string
        documentId?: string
      }) => ipcRenderer.invoke('rag:attachments:add', input),
      remove: (input: {
        conversationId: string
        collectionId?: string
        documentId?: string
      }) => ipcRenderer.invoke('rag:attachments:remove', input)
    },
    chunk: {
      get: (chunkId: string) => ipcRenderer.invoke('rag:chunk:get', chunkId)
    }
  },

  app: {
    onError: (cb: (e: { message: string }) => void) =>
      ipcRenderer.on('app:error', (_, e) => cb(e)),
    onWarning: (cb: (e: { message: string }) => void) =>
      ipcRenderer.on('app:warning', (_, e) => cb(e)),
    getWorkingFolder: () => ipcRenderer.invoke('app:getWorkingFolder'),
    getDataDir: () => ipcRenderer.invoke('app:getDataDir'),
    openPath: (p: string) => ipcRenderer.invoke('app:openPath', p),
    // Synchronous from preload — process.platform is available in the
    // sandbox. Renderer reads it once via window.api.app.platform.
    platform: process.platform as NodeJS.Platform
  }
}

contextBridge.exposeInMainWorld('api', api)

export type LampreyAPI = typeof api
