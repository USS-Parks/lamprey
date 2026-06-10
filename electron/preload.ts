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
    onReasoning: (cb: (e: { conversationId: string; content: string }) => void) =>
      ipcRenderer.on('chat:reasoning', (_, e) => cb(e)),
    onDone: (cb: (e: { conversationId: string; message: unknown }) => void) =>
      ipcRenderer.on('chat:done', (_, e) => cb(e)),
    /** Reasoning Audit Phase R4 — Planner row persisted during a
     *  multi-agent pipeline turn. Renderer treats it as audit-only:
     *  the row is appended to the conversation message list but R7's
     *  MessageList attaches it to the next downstream Coder/Composer
     *  bubble behind a "Show pipeline trace" toggle instead of
     *  rendering it as its own visible message bubble. */
    onPlannerMessage: (
      cb: (e: { conversationId: string; message: unknown }) => void
    ) => ipcRenderer.on('chat:planner-message', (_, e) => cb(e)),
    onError: (cb: (e: { conversationId: string; error: string }) => void) =>
      ipcRenderer.on('chat:error', (_, e) => cb(e)),
    onToolCall: (cb: (e: unknown) => void) => ipcRenderer.on('chat:tool-call', (_, e) => cb(e)),
    onToolCallResult: (cb: (e: unknown) => void) =>
      ipcRenderer.on('chat:tool-call-result', (_, e) => cb(e)),
    onPhase: (cb: (e: { conversationId: string; phase: string }) => void) =>
      ipcRenderer.on('chat:phase', (_, e) => cb(e)),
    onStreamingVitals: (
      cb: (e: {
        conversationId: string
        lastChunkAt: number
        msSinceLastChunk: number
        chunkCount: number
        tokenEstimate: number
        attemptElapsedMs: number
      }) => void
    ): (() => void) => {
      const handler = (_: unknown, e: any): void => cb(e)
      ipcRenderer.on('chat:streaming-vitals', handler)
      return () => ipcRenderer.removeListener('chat:streaming-vitals', handler)
    },
    onDocumentCreated: (
      cb: (e: {
        conversationId: string
        document: {
          id: string
          name: string
          mimeType: string
          content: string
          sizeBytes: number
          createdAt: number
        }
      }) => void
    ): (() => void) => {
      const handler = (_: unknown, e: any): void => cb(e)
      ipcRenderer.on('chat:document-created', handler)
      return () => ipcRenderer.removeListener('chat:document-created', handler)
    },
    onAgentStatus: (cb: (e: unknown) => void) => ipcRenderer.on('agent:status', (_, e) => cb(e)),
    onAsyncEvent: (cb: (e: unknown) => void): (() => void) => {
      const handler = (_: unknown, e: unknown): void => cb(e)
      ipcRenderer.on('async-event:received', handler)
      return () => ipcRenderer.removeListener('async-event:received', handler)
    },
    offAll: () => {
      ;[
        'chat:chunk',
        'chat:reasoning',
        'chat:done',
        'chat:planner-message',
        'chat:error',
        'chat:tool-call',
        'chat:tool-call-result',
        'chat:phase',
        'chat:streaming-vitals',
        'chat:document-created',
        'agent:status'
      ].forEach((ch) => ipcRenderer.removeAllListeners(ch))
    },
    // Per-conversation subscription that returns an unsubscribe function.
    // Use for side-chat panels so they don't fight the global useChat listener.
    subscribe: (
      conversationId: string,
      cbs: {
        onChunk?: (e: { conversationId: string; content: string }) => void
        onReasoning?: (e: { conversationId: string; content: string }) => void
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
      wire('chat:reasoning', cbs.onReasoning)
      wire('chat:done', cbs.onDone)
      wire('chat:error', cbs.onError)
      return () => {
        for (const [ch, h] of handlers) ipcRenderer.removeListener(ch, h)
      }
    }
  },

  // E3 — cross-session search + archive surface. Separate namespace so
  // the legacy `conversation.*` calls stay untouched.
  sessions: {
    list: (opts?: {
      tab?: 'recent' | 'pinned' | 'archived'
      query?: string
      limit?: number
      offset?: number
    }) => ipcRenderer.invoke('sessions:list', opts),
    archive: (id: string, archived: boolean) =>
      ipcRenderer.invoke('sessions:archive', id, archived),
    setPinned: (id: string, pinned: boolean) =>
      ipcRenderer.invoke('sessions:setPinned', id, pinned),
    search: (query: string, limit?: number) => ipcRenderer.invoke('sessions:search', query, limit),
    listActive: (limit?: number) => ipcRenderer.invoke('sessions:list-active', limit)
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
    setModel: (id: string, model: string) => ipcRenderer.invoke('conversation:setModel', id, model),
    fork: (input: unknown) => ipcRenderer.invoke('conversation:fork', input),
    lineage: (conversationId: string) => ipcRenderer.invoke('conversation:lineage', conversationId),
    compact: (id: string) => ipcRenderer.invoke('conversation:compact', id)
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (partial: Record<string, unknown>) => ipcRenderer.invoke('settings:set', partial),

    listProviderKeys: () => ipcRenderer.invoke('settings:listProviderKeys'),
    saveProviderKey: (provider: string, key: string) =>
      ipcRenderer.invoke('settings:saveProviderKey', provider, key),
    hasProviderKey: (provider: string) => ipcRenderer.invoke('settings:hasProviderKey', provider),
    testProviderKey: (provider: string) => ipcRenderer.invoke('settings:testProviderKey', provider),
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
    hasPlaintextConsent: () => ipcRenderer.invoke('settings:hasPlaintextConsent'),

    // R4 — search-provider key namespace. Separate from AI providers so the
    // type-narrowed handler can refuse cross-namespace writes.
    listSearchProviderKeys: () => ipcRenderer.invoke('settings:listSearchProviderKeys'),
    saveSearchProviderKey: (provider: string, key: string) =>
      ipcRenderer.invoke('settings:saveSearchProviderKey', provider, key),
    deleteSearchProviderKey: (provider: string) =>
      ipcRenderer.invoke('settings:deleteSearchProviderKey', provider)
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
    onChanged: (cb: (skills: unknown[]) => void) => {
      const listener = (_: unknown, skills: unknown[]): void => cb(skills)
      ipcRenderer.on('skills:changed', listener)
      return () => {
        ipcRenderer.removeListener('skills:changed', listener)
      }
    }
  },

  memory: {
    // `filter` is optional; pass `{ type?: MemoryType, projectSlug?: string }`
    // to scope the result to a typed file-backed view. The no-arg form
    // returns the legacy shape (numeric ids) so the pre-D3 MemoryPanel
    // keeps rendering during the transition.
    list: (filter?: { type?: string; projectSlug?: string }) =>
      ipcRenderer.invoke('memory:list', filter),
    add: (content: string) => ipcRenderer.invoke('memory:add', content),
    update: (id: number, content: string) => ipcRenderer.invoke('memory:update', id, content),
    delete: (idOrName: number | string) => ipcRenderer.invoke('memory:delete', idOrName),
    clear: () => ipcRenderer.invoke('memory:clear'),
    export: () => ipcRenderer.invoke('memory:export'),
    import: (entries: unknown[]) => ipcRenderer.invoke('memory:import', entries),
    // Typed file-backed surface (D1).
    write: (payload: {
      name: string
      type: 'user' | 'feedback' | 'project' | 'reference'
      body: string
      description?: string
      projectSlug?: string
      sourceConversationId?: string
    }) => ipcRenderer.invoke('memory:write', payload),
    read: (name: string) => ipcRenderer.invoke('memory:read', name),
    search: (query: string, limit?: number) => ipcRenderer.invoke('memory:search', query, limit),
    // D2: read the on-disk MEMORY.md for a project, plus the broken-link
    // list so D3's sidebar pip can surface "to-write" suggestions.
    readIndex: (projectSlug?: string) => ipcRenderer.invoke('memory:readIndex', projectSlug),
    listBrokenLinks: (projectSlug?: string) =>
      ipcRenderer.invoke('memory:listBrokenLinks', projectSlug),
    onAdded: (cb: (entry: unknown) => void) =>
      ipcRenderer.on('memory:added', (_, entry) => cb(entry)),
    onChanged: (cb: (entries: unknown[]) => void): (() => void) => {
      const handler = (_: unknown, entries: unknown[]) => cb(entries)
      ipcRenderer.on('memory:changed', handler)
      return () => ipcRenderer.removeListener('memory:changed', handler)
    }
  },

  plugins: {
    list: () => ipcRenderer.invoke('plugins:list'),
    get: (id: string) => ipcRenderer.invoke('plugins:get', id),
    enable: (id: string) => ipcRenderer.invoke('plugins:enable', id),
    disable: (id: string) => ipcRenderer.invoke('plugins:disable', id),
    remove: (id: string) => ipcRenderer.invoke('plugins:remove', id),
    installFromDirectory: (srcPath: string) =>
      ipcRenderer.invoke('plugins:installFromDirectory', srcPath),
    installFromManifest: (manifest: unknown, files?: Record<string, string>) =>
      ipcRenderer.invoke('plugins:installFromManifest', manifest, files),
    installFromUrl: (url: string) => ipcRenderer.invoke('plugins:installFromUrl', url),
    listBundledAvailable: () => ipcRenderer.invoke('plugins:listBundledAvailable'),
    installBundled: (id: string) => ipcRenderer.invoke('plugins:installBundled', id),
    pickDirectory: () => ipcRenderer.invoke('plugins:pickDirectory'),
    onChanged: (cb: (entries: unknown[]) => void) => {
      const handler = (_: unknown, entries: unknown[]) => cb(entries)
      ipcRenderer.on('plugins:changed', handler)
      return () => ipcRenderer.removeListener('plugins:changed', handler)
    }
  },

  ccImport: {
    discover: (opts?: { extraRoots?: string[] }) =>
      ipcRenderer.invoke('ccImport:discover', opts ?? {}),
    install: (payload: { sourcePath: string; overwrite?: boolean }) =>
      ipcRenderer.invoke('ccImport:install', payload),
    eject: (payload: { pluginId: string; skillSlug: string; overwrite?: boolean }) =>
      ipcRenderer.invoke('ccImport:eject', payload),
    pickExtraRoot: () => ipcRenderer.invoke('ccImport:pickExtraRoot')
  },

  mcp: {
    list: () => ipcRenderer.invoke('mcp:list'),
    getStatus: (id: string) => ipcRenderer.invoke('mcp:getStatus', id),
    reconnect: (id: string) => ipcRenderer.invoke('mcp:reconnect', id),
    addServer: (config: unknown) => ipcRenderer.invoke('mcp:addServer', config),
    setupGoogleOAuth: () => ipcRenderer.invoke('mcp:setupGoogleOAuth'),
    approveToolCall: (callId: string, approved: boolean) =>
      ipcRenderer.invoke('mcp:approveToolCall', callId, approved),
    onStatusChanged: (cb: (e: unknown) => void) =>
      ipcRenderer.on('mcp:statusChanged', (_, e) => cb(e)),
    onConfirmationRequired: (cb: (e: unknown) => void) =>
      ipcRenderer.on('mcp:confirmationRequired', (_, e) => cb(e))
  },

  tools: {
    // Track 2 / C1: `tools:list` returns lightweight stubs (no inputSchema).
    // Renderer uses `resolve` / `search` to pull full descriptors on demand.
    list: () => ipcRenderer.invoke('tools:list'),
    get: (id: string) => ipcRenderer.invoke('tools:get', id),
    resolve: (names: string[]) => ipcRenderer.invoke('tools:resolve', names),
    search: (payload: { query: string; maxResults?: number }) =>
      ipcRenderer.invoke('tools:search', payload),
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

  persistence: {
    // PS4–PS10 — read-write surface for the persistence floor.
    getStatus: () => ipcRenderer.invoke('persistence:getStatus'),
    runIntegrityCheck: () => ipcRenderer.invoke('persistence:runIntegrityCheck'),
    forceCheckpoint: () => ipcRenderer.invoke('persistence:forceCheckpoint'),
    createBackup: () => ipcRenderer.invoke('persistence:createBackup'),
    listBackups: () => ipcRenderer.invoke('persistence:listBackups'),
    restoreFromBackup: (backupPath: string) =>
      ipcRenderer.invoke('persistence:restoreFromBackup', backupPath),
    // PS9 encryption opt-in.
    getEncryptionStatus: () => ipcRenderer.invoke('persistence:getEncryptionStatus'),
    enableEncryption: (passphrase: string) =>
      ipcRenderer.invoke('persistence:enableEncryption', passphrase),
    disableEncryption: (passphrase: string) =>
      ipcRenderer.invoke('persistence:disableEncryption', passphrase),
    changePassphrase: (oldPassphrase: string, newPassphrase: string) =>
      ipcRenderer.invoke('persistence:changePassphrase', oldPassphrase, newPassphrase),
    setReadOnlyMode: (enabled: boolean) =>
      ipcRenderer.invoke('persistence:setReadOnlyMode', enabled)
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

  contracts: {
    create: (input: unknown) => ipcRenderer.invoke('contracts:create', input),
    update: (id: string, input: unknown) => ipcRenderer.invoke('contracts:update', id, input),
    close: (id: string) => ipcRenderer.invoke('contracts:close', id),
    waive: (input: { id: string; reason: string; waivedBy: string }) =>
      ipcRenderer.invoke('contracts:waive', input),
    get: (id: string) => ipcRenderer.invoke('contracts:get', id),
    list: (filter?: unknown) => ipcRenderer.invoke('contracts:list', filter ?? {}),
    active: (conversationId: string, correlationId?: string) =>
      ipcRenderer.invoke('contracts:active', conversationId, correlationId)
  },

  // WC-5 — Flip a message's persisted proof_status. Used by the proof
  // gate banner after a successful waiver so the banner does not return
  // on conversation reload.
  messages: {
    setProofStatus: (input: {
      messageId: string
      status: 'trusted' | 'untrusted' | 'blocked' | 'waived'
    }) => ipcRenderer.invoke('messages:setProofStatus', input)
  },

  plan: {
    get: (conversationId: string) => ipcRenderer.invoke('plan:get', conversationId),
    update: (
      conversationId: string,
      input: {
        replace?: boolean
        steps?: Array<{ id?: string; text?: string; status?: 'pending' | 'in_progress' | 'done' }>
      }
    ) => ipcRenderer.invoke('plan:update', conversationId, input),
    listAllState: () => ipcRenderer.invoke('plan:listAllState'),
    clearConversationState: (conversationId: string) =>
      ipcRenderer.invoke('plan:clearConversationState', conversationId),
    clearAllState: () => ipcRenderer.invoke('plan:clearAllState'),
    onUpdated: (cb: (e: { conversationId: string; snapshot: unknown }) => void): (() => void) => {
      const handler = (_: unknown, e: { conversationId: string; snapshot: unknown }) => cb(e)
      ipcRenderer.on('plan:updated', handler)
      return () => ipcRenderer.removeListener('plan:updated', handler)
    },
    // Track 2 / C3 — plan-mode gate. Banner hydrates via `isModeActive` on
    // conversation switch; the Exit button calls `exitMode`. Live updates
    // arrive via `onModeChanged` (the model toggles via the
    // enter_plan_mode / exit_plan_mode tools mid-turn).
    isModeActive: (conversationId: string) =>
      ipcRenderer.invoke('plan:isModeActive', conversationId),
    enterMode: (conversationId: string) => ipcRenderer.invoke('plan:enterMode', conversationId),
    exitMode: (conversationId: string) => ipcRenderer.invoke('plan:exitMode', conversationId),
    onModeChanged: (cb: (e: { conversationId: string; active: boolean }) => void): (() => void) => {
      const handler = (_: unknown, e: { conversationId: string; active: boolean }) => cb(e)
      ipcRenderer.on('plan:mode-changed', handler)
      return () => ipcRenderer.removeListener('plan:mode-changed', handler)
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

  // Track 2 / E1 — session chapters. `markChapter` anchors a chapter to
  // a message; `list` hydrates the renderer's TOC; `chaptersForAnchor`
  // returns rows pinned to a specific message id; `delete` removes one.
  // `onMarked` is the live subscription to `chat:chapter-marked` so any
  // open chapter sidebar updates without polling.
  session: {
    markChapter: (payload: {
      conversationId: string
      title: string
      summary?: string | null
      anchorMessageId: string
    }) => ipcRenderer.invoke('session:markChapter', payload),
    listChapters: (conversationId: string) =>
      ipcRenderer.invoke('session:listChapters', conversationId),
    chaptersForAnchor: (anchorMessageId: string) =>
      ipcRenderer.invoke('session:chaptersForAnchor', anchorMessageId),
    deleteChapter: (id: string) => ipcRenderer.invoke('session:deleteChapter', id),
    onChapterMarked: (
      cb: (e: { conversationId: string; chapter: unknown }) => void
    ): (() => void) => {
      const handler = (_: unknown, e: { conversationId: string; chapter: unknown }) => cb(e)
      ipcRenderer.on('chat:chapter-marked', handler)
      return () => ipcRenderer.removeListener('chat:chapter-marked', handler)
    }
  },

  // Track 2 / C4 — slash commands. `list` returns user-visible commands
  // only (`hidden: true` entries stay out of the palette but `resolve`
  // still resolves them by name); `listAll` is for diagnostics; `resolve`
  // returns the interpolated prompt body. `onChanged` fires whenever
  // chokidar picks up a file mutation in userData/slash-commands.
  slash: {
    list: () => ipcRenderer.invoke('slash:list'),
    listAll: () => ipcRenderer.invoke('slash:listAll'),
    resolve: (payload: { name: string; rest?: string }) =>
      ipcRenderer.invoke('slash:resolve', payload),
    onChanged: (cb: (e: unknown) => void): (() => void) => {
      const handler = (_: unknown, e: unknown) => cb(e)
      ipcRenderer.on('slash:changed', handler)
      return () => ipcRenderer.removeListener('slash:changed', handler)
    }
  },

  // Track 1 / B1+B3 — workflow runner control. `runInline` accepts a
  // raw script body; `run` fires a named workflow from disk. Progress
  // events arrive over `workflow:progress`.
  workflows: {
    list: () => ipcRenderer.invoke('workflows:list'),
    validate: (input: { script: string }) => ipcRenderer.invoke('workflows:validate', input),
    save: (input: { script: string }) => ipcRenderer.invoke('workflows:save', input),
    runInline: (input: {
      script: string
      args?: unknown
      budgetTotal?: number | null
      concurrencyCap?: number
      timeoutMs?: number
    }) => ipcRenderer.invoke('workflows:runInline', input),
    run: (input: { name: string; args?: unknown }) => ipcRenderer.invoke('workflows:run', input),
    stop: (runId: string) => ipcRenderer.invoke('workflows:stop', runId),
    onProgress: (listener: (event: unknown) => void): (() => void) => {
      const wrapped = (_e: unknown, event: unknown): void => listener(event)
      ipcRenderer.on('workflow:progress', wrapped)
      return () => ipcRenderer.removeListener('workflow:progress', wrapped)
    }
  },

  // Track 1 / A2 — background subagent task tracking. `onNotify` fires
  // when a background fork completes; E6 (this branch) layers the
  // async-event-bridge on top so the next user turn sees a synthetic
  // <task-notifications> block.
  tasks: {
    spawn: (payload: {
      sourceConversationId: string
      title: string
      prompt: string
      tldr?: string | null
      cwd?: string | null
      model?: string | null
    }) => ipcRenderer.invoke('tasks:spawn', payload),
    list: (filter?: {
      status?:
        | 'running'
        | 'done'
        | 'error'
        | 'aborted'
        | Array<'running' | 'done' | 'error' | 'aborted'>
      parentConvId?: string | null
      parentRunId?: string | null
      background?: boolean
      limit?: number
    }) => ipcRenderer.invoke('tasks:list', filter),
    get: (id: string) => ipcRenderer.invoke('tasks:get', id),
    output: (id: string) => ipcRenderer.invoke('tasks:output', id),
    stop: (id: string) => ipcRenderer.invoke('tasks:stop', id),
    update: (id: string, patch: { label?: string }) =>
      ipcRenderer.invoke('tasks:update', id, patch),
    onNotify: (listener: (event: unknown) => void): (() => void) => {
      const wrapped = (_e: unknown, event: unknown): void => listener(event)
      ipcRenderer.on('agent:run:notify', wrapped)
      return () => ipcRenderer.removeListener('agent:run:notify', wrapped)
    },
    onSpawned: (listener: (event: unknown) => void): (() => void) => {
      const wrapped = (_e: unknown, event: unknown): void => listener(event)
      ipcRenderer.on('tasks:spawned', wrapped)
      return () => ipcRenderer.removeListener('tasks:spawned', wrapped)
    }
  },

  hooks: {
    list: () => ipcRenderer.invoke('hooks:list'),
    create: (input: {
      event: string
      label: string
      command: string
      language?: 'js' | 'shell'
      timeoutMs?: number
    }) => ipcRenderer.invoke('hooks:create', input),
    update: (
      id: string,
      patch: Partial<{
        event: string
        label: string
        command: string
        enabled: boolean
        language: 'js' | 'shell'
        timeoutMs: number
      }>
    ) => ipcRenderer.invoke('hooks:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('hooks:delete', id),
    // Track 2 / C2 — test-run an unsaved hook body against a sample context.
    test: (payload: {
      code: string
      event: string
      context?: {
        conversationId?: string
        toolName?: string
        args?: Record<string, unknown>
        result?: string
        promptBody?: string
        cwd?: string
      }
      timeoutMs?: number
    }) => ipcRenderer.invoke('hooks:test', payload)
  },

  automations: {
    list: () => ipcRenderer.invoke('automations:list'),
    create: (input: { label: string; cron: string; prompt: string; model?: string }) =>
      ipcRenderer.invoke('automations:create', input),
    update: (
      id: string,
      patch: Partial<{
        label: string
        cron: string
        prompt: string
        model: string
        enabled: boolean
      }>
    ) => ipcRenderer.invoke('automations:update', id, patch),
    delete: (id: string) => ipcRenderer.invoke('automations:delete', id),
    runNow: (id: string) => ipcRenderer.invoke('automations:runNow', id),
    validateCron: (expr: string) => ipcRenderer.invoke('automations:validateCron', expr)
  },

  loops: {
    schedule: (input: {
      conversationId: string
      delaySeconds: number
      prompt: string
      reason?: string | null
    }) => ipcRenderer.invoke('loops:schedule', input),
    cancel: (id: string) => ipcRenderer.invoke('loops:cancel', id),
    list: (filter?: {
      conversationId?: string
      status?:
        | 'pending'
        | 'fired'
        | 'cancelled'
        | 'error'
        | Array<'pending' | 'fired' | 'cancelled' | 'error'>
      limit?: number
    }) => ipcRenderer.invoke('loops:list', filter),
    onFired: (cb: (event: unknown) => void): (() => void) => {
      const handler = (_: unknown, event: unknown): void => cb(event)
      ipcRenderer.on('loop:wakeup:fired', handler)
      return () => ipcRenderer.removeListener('loop:wakeup:fired', handler)
    }
  },

  notifications: {
    push: (input: { title: string; body: string; deepLink?: string | null }) =>
      ipcRenderer.invoke('notifications:push', input),
    onClicked: (cb: (event: unknown) => void): (() => void) => {
      const handler = (_: unknown, event: unknown): void => cb(event)
      ipcRenderer.on('notifications:clicked', handler)
      return () => ipcRenderer.removeListener('notifications:clicked', handler)
    }
  },

  sessionsMessaging: {
    sendMessage: (input: {
      targetSessionId: string
      body: string
      fromSessionId?: string | null
    }) => ipcRenderer.invoke('sessions-messaging:sendMessage', input),
    onIncoming: (cb: (event: unknown) => void): (() => void) => {
      const handler = (_: unknown, event: unknown): void => cb(event)
      ipcRenderer.on('sessions:incoming-message', handler)
      return () => ipcRenderer.removeListener('sessions:incoming-message', handler)
    }
  },

  askUser: {
    respond: (payload: { requestId: string; answer: unknown }) =>
      ipcRenderer.invoke('ask-user:respond', payload),
    list: () => ipcRenderer.invoke('ask-user:list'),
    cancelAll: () => ipcRenderer.invoke('ask-user:cancelAll'),
    onAwaiting: (cb: (event: unknown) => void): (() => void) => {
      const handler = (_: unknown, event: unknown): void => cb(event)
      ipcRenderer.on('ask-user:awaiting', handler)
      return () => ipcRenderer.removeListener('ask-user:awaiting', handler)
    }
  },

  statusline: {
    get: () => ipcRenderer.invoke('statusline:get'),
    set: (input: { slots?: string[]; formats?: Record<string, string> }) =>
      ipcRenderer.invoke('statusline:set', input),
    availableSlots: () => ipcRenderer.invoke('statusline:availableSlots')
  },

  snip: {
    stats: () => ipcRenderer.invoke('snip:stats'),
    recent: (payload?: { limit?: number }) => ipcRenderer.invoke('snip:recent', payload),
    listFilters: () => ipcRenderer.invoke('snip:listFilters'),
    setEnabled: (payload: { enabled: boolean }) => ipcRenderer.invoke('snip:setEnabled', payload),
    setVerbose: (payload: { verbose: boolean }) => ipcRenderer.invoke('snip:setVerbose', payload),
    reloadFilters: () => ipcRenderer.invoke('snip:reloadFilters'),
    discover: (payload?: { sinceDays?: number; limit?: number }) =>
      ipcRenderer.invoke('snip:discover', payload),
    clearHistory: () => ipcRenderer.invoke('snip:clearHistory'),
    openFilterDir: () => ipcRenderer.invoke('snip:openFilterDir'),
    onFiltersChanged: (cb: () => void): (() => void) => {
      const handler = (): void => cb()
      ipcRenderer.on('snip:filters-changed', handler)
      return () => ipcRenderer.removeListener('snip:filters-changed', handler)
    }
  },

  worktree: {
    list: (args: { cwd?: string }) => ipcRenderer.invoke('worktree:list', args),
    create: (args: { cwd?: string; path: string; branch: string; baseRef?: string }) =>
      ipcRenderer.invoke('worktree:create', args),
    remove: (args: { cwd?: string; path: string; force?: boolean }) =>
      ipcRenderer.invoke('worktree:remove', args)
  },

  projects: {
    list: (args?: { includeArchived?: boolean }) => ipcRenderer.invoke('projects:list', args),
    get: (id: string) => ipcRenderer.invoke('projects:get', id),
    create: (input: { name: string; path?: string | null; description?: string | null }) =>
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
      ipcRenderer.invoke('projects:ensureForPath', path, fallbackName),
    select: (id: string) => ipcRenderer.invoke('projects:select', id),
    update: (id: string, patch: { name?: string | null; description?: string | null; path?: string | null }) =>
      ipcRenderer.invoke('projects:update', id, patch)
  },

  review: {
    status: (args: { cwd?: string }) => ipcRenderer.invoke('review:status', args),
    diff: (args: { cwd?: string; path?: string; staged?: boolean }) =>
      ipcRenderer.invoke('review:diff', args),
    stage: (args: { cwd?: string; path: string }) => ipcRenderer.invoke('review:stage', args),
    unstage: (args: { cwd?: string; path: string }) => ipcRenderer.invoke('review:unstage', args),
    discard: (args: { cwd?: string; path: string }) => ipcRenderer.invoke('review:discard', args),
    branches: (args?: { cwd?: string }) => ipcRenderer.invoke('review:branches', args),
    checkout: (args: { cwd?: string; name: string }) => ipcRenderer.invoke('review:checkout', args),
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

  // F4 — Background shell + monitor primitive.
  shellBg: {
    spawn: (args: {
      command: string
      cwd?: string
      env?: Record<string, string>
      emitLines?: boolean
    }) => ipcRenderer.invoke('shell:bg:spawn', args),
    list: () => ipcRenderer.invoke('shell:bg:list'),
    get: (processId: string) => ipcRenderer.invoke('shell:bg:get', processId),
    kill: (processId: string) => ipcRenderer.invoke('shell:bg:kill', processId),
    destroy: (processId: string) => ipcRenderer.invoke('shell:bg:destroy', processId),
    onLine: (
      cb: (evt: {
        processId: string
        stream: 'stdout' | 'stderr'
        line: string
        at: number
      }) => void
    ) => {
      const h = (_: unknown, evt: any) => cb(evt)
      ipcRenderer.on('shell:bg:line', h)
      return () => ipcRenderer.removeListener('shell:bg:line', h)
    },
    onExit: (
      cb: (evt: {
        processId: string
        exitCode: number | null
        signal: string | null
        durationMs: number
      }) => void
    ) => {
      const h = (_: unknown, evt: any) => cb(evt)
      ipcRenderer.on('shell:bg:exit', h)
      return () => ipcRenderer.removeListener('shell:bg:exit', h)
    }
  },

  monitor: {
    start: (opts: { processId: string; untilPattern?: string }) =>
      ipcRenderer.invoke('monitor:start', opts),
    read: (streamId: string, since?: number) => ipcRenderer.invoke('monitor:read', streamId, since),
    stop: (streamId: string) => ipcRenderer.invoke('monitor:stop', streamId),
    destroy: (streamId: string) => ipcRenderer.invoke('monitor:destroy', streamId),
    list: () => ipcRenderer.invoke('monitor:list'),
    onLine: (cb: (evt: { streamId: string; processId: string; entry: unknown }) => void) => {
      const h = (_: unknown, evt: any) => cb(evt)
      ipcRenderer.on('monitor:line', h)
      return () => ipcRenderer.removeListener('monitor:line', h)
    },
    onMatched: (
      cb: (evt: {
        streamId: string
        processId: string
        matchedLine: string
        entry: unknown
      }) => void
    ) => {
      const h = (_: unknown, evt: any) => cb(evt)
      ipcRenderer.on('monitor:matched', h)
      return () => ipcRenderer.removeListener('monitor:matched', h)
    },
    onExit: (
      cb: (evt: { streamId: string; processId: string; exitCode: number | null }) => void
    ) => {
      const h = (_: unknown, evt: any) => cb(evt)
      ipcRenderer.on('monitor:exit', h)
      return () => ipcRenderer.removeListener('monitor:exit', h)
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
    render: (type: string, content: string) => ipcRenderer.invoke('artifact:render', type, content),
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
    onNewConversation: (cb: () => void) => ipcRenderer.on('tray:newConversation', () => cb())
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

  research: {
    start: (request: { question: string; depth?: 'quick' | 'standard' | 'exhaustive'; conversationId: string }) =>
      ipcRenderer.invoke('research:start', request),
    cancel: (runId: string) => ipcRenderer.invoke('research:cancel', runId),
    status: (runId: string) => ipcRenderer.invoke('research:status', runId),
    list: () => ipcRenderer.invoke('research:list'),
    read: (filename: string) => ipcRenderer.invoke('research:read', filename),
    download: (filename: string) => ipcRenderer.invoke('research:download', filename),
    onProgress: (cb: (e: unknown) => void): (() => void) => {
      const handler = (_: unknown, e: unknown): void => cb(e)
      ipcRenderer.on('research:progress', handler)
      return () => ipcRenderer.removeListener('research:progress', handler)
    },
    onCompleted: (cb: (e: unknown) => void): (() => void) => {
      const handler = (_: unknown, e: unknown): void => cb(e)
      ipcRenderer.on('research:completed', handler)
      return () => ipcRenderer.removeListener('research:completed', handler)
    },
    onFailed: (cb: (e: unknown) => void): (() => void) => {
      const handler = (_: unknown, e: unknown): void => cb(e)
      ipcRenderer.on('research:failed', handler)
      return () => ipcRenderer.removeListener('research:failed', handler)
    }
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
    unlinkRepo: (args: { projectId: string }) => ipcRenderer.invoke('github:unlinkRepo', args),
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

    // F2 — PR review threading + inline review post.
    listPullRequestReviewComments: (args: { owner: string; repo: string; number: number }) =>
      ipcRenderer.invoke('github:listPullRequestReviewComments', args),
    listPullRequestReviewThreads: (args: { owner: string; repo: string; number: number }) =>
      ipcRenderer.invoke('github:listPullRequestReviewThreads', args),
    createPullRequestReview: (args: {
      owner: string
      repo: string
      number: number
      body?: string
      event?: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT'
      commitId?: string
      comments?: Array<{
        path: string
        body: string
        position?: number
        line?: number
        start_line?: number
        side?: 'LEFT' | 'RIGHT'
        start_side?: 'LEFT' | 'RIGHT'
      }>
    }) => ipcRenderer.invoke('github:createPullRequestReview', args),
    replyToReviewComment: (args: {
      owner: string
      repo: string
      number: number
      commentId: number
      body: string
    }) => ipcRenderer.invoke('github:replyToReviewComment', args),
    resolveReviewThread: (args: { threadId: string }) =>
      ipcRenderer.invoke('github:resolveReviewThread', args),
    unresolveReviewThread: (args: { threadId: string }) =>
      ipcRenderer.invoke('github:unresolveReviewThread', args),

    // F3 — issues + status checks.
    listIssues: (args: {
      owner: string
      repo: string
      state?: 'open' | 'closed' | 'all'
      per_page?: number
      labels?: string
    }) => ipcRenderer.invoke('github:listIssues', args),
    getPullRequestStatus: (args: { owner: string; repo: string; number: number }) =>
      ipcRenderer.invoke('github:getPullRequestStatus', args),
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

  afterAction: {
    get: (conversationId: string) => ipcRenderer.invoke('after-action:get', conversationId),
    // SP-8 — recent auto-router decisions (session-scoped ring buffer, D6).
    routerTelemetry: (conversationId?: string) =>
      ipcRenderer.invoke('after-action:routerTelemetry', conversationId)
  },

  harnessRecs: {
    list: (conversationId?: string) => ipcRenderer.invoke('harness:recommendations', conversationId)
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
      list: (collectionId: string) => ipcRenderer.invoke('rag:document:list', collectionId),
      ingest: (
        collectionId: string,
        files: Array<{
          path?: string
          text?: string
          name: string
          sourceKind?: string
        }>
      ) => ipcRenderer.invoke('rag:document:ingest', collectionId, files),
      reingest: (documentId: string) => ipcRenderer.invoke('rag:document:reingest', documentId),
      delete: (documentId: string) => ipcRenderer.invoke('rag:document:delete', documentId),
      cancel: (jobId: string) => ipcRenderer.invoke('rag:document:cancel', jobId),
      onProgress: (cb: (e: unknown) => void): (() => void) => {
        const handler = (_: unknown, e: unknown): void => cb(e)
        ipcRenderer.on('rag:document:progress', handler)
        return () => ipcRenderer.removeListener('rag:document:progress', handler)
      }
    },
    query: {
      run: (input: { query: string; collectionIds: string[]; topN?: number }) =>
        ipcRenderer.invoke('rag:query:run', input)
    },
    attachments: {
      list: (conversationId: string) => ipcRenderer.invoke('rag:attachments:list', conversationId),
      add: (input: { conversationId: string; collectionId?: string; documentId?: string }) =>
        ipcRenderer.invoke('rag:attachments:add', input),
      remove: (input: { conversationId: string; collectionId?: string; documentId?: string }) =>
        ipcRenderer.invoke('rag:attachments:remove', input)
    },
    // Auto-route a large file through the RAG ingest pipeline into a
    // per-conversation auto-collection. The renderer calls this when a
    // ProcessedFile arrives with kind: 'rag-pending'. Progress updates flow
    // over the existing rag.document.onProgress subscription — match the
    // returned jobId to the IngestProgressEvent.jobId.
    autoAttach: (input: { conversationId: string; filePath: string; displayName?: string }) =>
      ipcRenderer.invoke('rag:auto-attach', input),
    chunk: {
      get: (chunkId: string) => ipcRenderer.invoke('rag:chunk:get', chunkId)
    }
  },

  app: {
    onError: (cb: (e: { message: string }) => void) => ipcRenderer.on('app:error', (_, e) => cb(e)),
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
