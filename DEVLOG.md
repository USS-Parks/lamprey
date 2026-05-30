# Lamprey Harness Dev Log

## Prompt 1 — Project Initialization (2026-05-30)

Scaffolded the Electron + React 19 + TypeScript project using electron-vite. Manual scaffold was required because `npm create electron-vite` has interactive prompts that don't work in non-interactive mode. All core and dev dependencies installed: better-sqlite3, openai, @modelcontextprotocol/sdk, chokidar, gray-matter, zustand, react-markdown, remark-gfm, Tailwind CSS 4, Shiki, Vitest, Playwright, electron-builder. Created the full directory structure per the plan. Three-column layout (sidebar 240px, chat flex-grow, artifact panel 420px) renders with the correct dark color palette. Custom frameless titlebar with drag region. Three bundled skill files created (direct-voice, code-review, git-commit). Electron binary required `ELECTRON_EXEC_PATH` env var workaround for electron-vite resolution. Verification: `npm run dev` launches Electron window with correct layout, dark background (#0d0d0d), no TypeScript errors, no console errors.

## Prompt 2 — Typed IPC Foundation (2026-05-30)

Built the complete typed IPC layer. Created `src/lib/types.ts` with all interfaces: Message, Conversation, Skill, MemoryEntry, McpServerConfig, ModelInfo, AppSettings, IpcResponse<T>, and all event types (ChatChunkEvent, ChatDoneEvent, ToolCallEvent, etc.). Expanded `electron/preload.ts` with the full contextBridge API surface covering chat, conversation, settings, model, skills, memory, mcp, and artifact namespaces. Created `src/lib/ipc-client.ts` as typed wrappers and `src/hooks/useIpc.ts` with loading/error state management. Built stub IPC handler files for all 8 domains (chat, conversation, settings, model, skills, memory, mcp, artifact) returning `{ success: true, data: null }`. All handlers registered via `electron/ipc/index.ts` and wired into `main.ts`. Added "Test IPC" button to App.tsx. Verification: electron-vite builds 11 modules for main process (6.44 KB), 4.15 KB preload. `tsc --noEmit` passes with zero errors on both tsconfig.node.json and tsconfig.web.json. IPC stubs respond correctly inside Electron (hasApiKey returns `{ success: true, data: false }`).

## Prompt 3 — DeepSeek API Client (2026-05-30)

Built `electron/services/keychain.ts` using Electron safeStorage for OS-level encryption of API keys. Falls back to plaintext with a logged warning if safeStorage is unavailable (Linux without libsecret). Keys stored as base64-encoded encrypted buffers in `userData/keys.json`. Built `electron/services/deepseek.ts` with DeepSeekClient class wrapping the `openai` npm package pointed at `https://api.deepseek.com/v1`. Supports streaming via `chatStream()` with tool call accumulation, 3x exponential backoff retry for 429/network errors, immediate fail on 401. Non-streaming `chat()` and `validateKey()` methods included. Wired real implementations for `settings:saveApiKey`, `settings:hasApiKey`, `settings:testApiKey`, `settings:get/set`, `settings:saveGoogleCredentials`, `model:list`, `model:getActive`, `model:setActive`. Verification: `tsc --noEmit` zero errors. Full production build succeeds (13 main modules, 14.05 KB). API key validation deferred to user-provided key test in Prompt 5.

## Prompt 4 — SQLite Persistence Layer (2026-05-30)

Built `electron/services/database.ts` as shared better-sqlite3 initialization with WAL mode and foreign keys enabled. Schema creates conversations, messages (with cascade delete), and memory_entries tables plus an index on messages(conversation_id, created_at). Built `electron/services/conversation-store.ts` with full CRUD: createConversation, getConversation, listConversations (sorted by updated_at desc), deleteConversation, updateConversationTitle, touchConversation, saveMessage, getMessages. Built `electron/services/memory-store.ts` with listMemories, addMemory, updateMemory, deleteMemory, clearAllMemories, exportMemories (JSON), importMemories (transactional batch insert), and buildMemoryBlock() which formats entries as an XML `<memory>` block for system prompt injection. Wired real implementations for all conversation:* and memory:* IPC handlers. Database closes cleanly on app quit via `will-quit` event. Verification: `tsc --noEmit` zero errors. Full production build succeeds (16 main modules, 21.15 KB).

## Prompt 5 — Streaming Chat IPC Bridge (2026-05-30)

Built `electron/services/system-prompt-builder.ts` assembling base prompt + memory block + skill blocks. Implemented full `chat:send` handler in `electron/ipc/chat.ts`: creates conversation if new, saves user message, fetches history, builds system prompt with memory and skills, collects MCP tools, registers `memory_add` pseudo-tool, and streams via DeepSeek client. Tool call loop runs up to 10 rounds: parses tool calls, handles `memory_add` internally (saves to memory_entries, emits `memory:added`), routes MCP calls with confirmation flow for destructive Chrome actions (30s timeout auto-deny), saves tool result messages, and continues streaming. `chat:cancel` uses AbortController to cleanly abort streams. Created stub services for `skill-loader` and `mcp-manager` to satisfy imports (dynamic `import()` with graceful catch for when they're not yet initialized). Verification: `tsc --noEmit` zero errors. Production build succeeds (19 main modules, 31.49 KB, with code-split chunks for skill-loader and mcp-manager).

## Prompt 6 — Basic Chat UI (2026-05-30) — UNCOMMITTED

**Status: Code complete, visually verified, NOT YET COMMITTED.**

Built three Zustand stores: `chat-store.ts` (conversations, messages, streaming state, tool calls, model switching, auto-title on first message), `settings-store.ts` (load/update from IPC), `model-store.ts` (model list + active model). Created `useChat` hook to wire IPC event listeners (chunk/done/error/tool-call) to store actions with cleanup on unmount. Built all UI components: `Sidebar.tsx` (conversation list grouped by date, model badges, delete with confirm), `Titlebar.tsx` (wordmark, model dropdown, settings gear), `ChatView.tsx` (welcome screen + message area), `MessageList.tsx` (auto-scroll), `MessageBubble.tsx` (user/assistant styling with hover metadata), `StreamingText.tsx` (blinking cursor), `ChatInput.tsx` (auto-resize textarea, Enter/Shift+Enter, send/stop buttons). Created `ApiKeyModal.tsx` (masked input, test-on-submit, encryption notice). Added `window.api` guards for browser-mode graceful degradation. Verification: Full build compiles (42 renderer modules). Three-column layout renders with API key modal, sidebar empty state, model dropdown, and chat input. **Next session: commit this, then continue to Prompt 7.**

Uncommitted files:
- `src/App.tsx` (modified)
- `src/components/layout/Sidebar.tsx` (new)
- `src/components/layout/Titlebar.tsx` (new)
- `src/components/chat/ChatView.tsx` (new)
- `src/components/chat/MessageList.tsx` (new)
- `src/components/chat/MessageBubble.tsx` (new)
- `src/components/chat/StreamingText.tsx` (new)
- `src/components/chat/ChatInput.tsx` (new)
- `src/components/settings/ApiKeyModal.tsx` (new)
- `src/stores/chat-store.ts` (new)
- `src/stores/settings-store.ts` (new)
- `src/stores/model-store.ts` (new)
- `src/hooks/useChat.ts` (new)
