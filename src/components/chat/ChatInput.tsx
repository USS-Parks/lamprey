import { useState, useRef, useEffect } from 'react'
import { useChatStore } from '@/stores/chat-store'
import { useModelStore } from '@/stores/model-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useProvidersStore } from '@/stores/providers-store'
import { useUiStore, type PermissionsMode } from '@/stores/ui-store'
import { toast } from '@/stores/toast-store'
import { ApiKeyModal } from '@/components/settings/ApiKeyModal'
import { SlashCommandPalette } from './SlashCommandPalette'
import { AtFileMention } from './AtFileMention'
import { ToolActivityChip } from './ToolActivityChip'
import { useSlashCommandsStore } from '@/stores/slash-commands-store'
import { usePlanStore } from '@/stores/plan-store'
import { detectAtMention } from '@/lib/file-rank'
import { detectMemoryShortcut } from '@/lib/memory-shortcut'
import {
  emptyHistoryState,
  historyDown,
  historyReset,
  historyUp,
  type PromptHistoryState
} from '@/lib/prompt-history'
import {
  currentSlot,
  nextMode,
  slotLabel,
  type ModeSlot
} from '@/lib/mode-cycle'
import { usePlanMode } from '@/hooks/usePlanMode'
import type { ModelInfo, ProcessedFile } from '@/lib/types'

import defaultAccessIcon from '@assets/Lamprey Default Access Icon.png'
import autoReviewIcon from '@assets/Lamprey Auto-Review Icon.png'
import fullAccessIcon from '@assets/Lamprey Full Access Icon.png'
import micIcon from '@assets/Lamprey Microphone Icon.png'
import sendIcon from '@assets/Lamprey Prompt Enter Icon.png'
import stopIcon from '@assets/Lamprey Chat Pill Stop Icon Light View.png'
import workLocationIcon from '@assets/Lamprey Work Location Icon.png'
import folderIcon from '@assets/Lamprey Folder 1 Icon.png'
import worktreeIcon from '@assets/Lamprey Worktree Icon.png'
import addFileIcon from '@assets/Lamprey Add File Icon.png'

interface ChatInputProps {
  onSend: (content: string) => void
  onCancel: () => void
  isStreaming: boolean
  disabled?: boolean
}

const LONG_PASTE_THRESHOLD = 500

interface PermissionOption {
  id: PermissionsMode
  label: string
  icon: string
}

const PERMISSION_OPTIONS: PermissionOption[] = [
  { id: 'default', label: 'Default permissions', icon: defaultAccessIcon },
  { id: 'auto-review', label: 'Auto Review', icon: autoReviewIcon },
  { id: 'full', label: 'Full Access', icon: fullAccessIcon }
]

function looksLikeCode(text: string): boolean {
  if (text.length < LONG_PASTE_THRESHOLD) return false
  const lines = text.split(/\r?\n/)
  if (lines.length < 5) return false
  let signals = 0
  if (/[{};]\s*$/m.test(text)) signals++
  if (/^\s*(import|from|const|let|var|function|class|def|public|private)\b/m.test(text)) signals++
  if (/^\s*[{[]\s*$/m.test(text) && /^\s*[}\]]\s*$/m.test(text)) signals++
  if (/<\/?[a-zA-Z][^>]*>/.test(text)) signals++
  return signals >= 1
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.readAsDataURL(blob)
  })
}

function ChevronDown() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

interface DropdownButtonProps {
  open: boolean
  onToggle: () => void
  children: React.ReactNode
  title?: string
}

function DropdownButton({ open, onToggle, children, title }: DropdownButtonProps) {
  return (
    <button
      onClick={onToggle}
      title={title}
      aria-expanded={open}
      className="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
    >
      {children}
      <ChevronDown />
    </button>
  )
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside()
    }
    window.addEventListener('mousedown', onMouseDown)
    return () => window.removeEventListener('mousedown', onMouseDown)
  }, [active, onOutside, ref])
}

function CodingModeToggle() {
  // Pill mirrors AppSettings.agenticCodingMode. Persists via the standard
  // settings store, so the chat input and the SettingsDialog stay in sync
  // both ways without a separate IPC channel.
  const on = useSettingsStore((s) => s.settings.agenticCodingMode)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const openSettings = useUiStore((s) => s.openSettings)

  const handleToggle = () => {
    void updateSettings({ agenticCodingMode: !on })
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      onContextMenu={(e) => {
        e.preventDefault()
        openSettings('agenticCoding')
      }}
      title={
        on
          ? 'Agentic coding mode is ON · click to turn off · right-click to configure'
          : 'Turn on agentic coding mode (coding contract + codex skills + composer) · right-click to configure'
      }
      aria-pressed={on}
      className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs transition-colors ${
        on
          ? 'border-[var(--accent)] bg-[var(--accent-dim)] text-[var(--accent)]'
          : 'border-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
      }`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          on ? 'bg-[var(--accent)]' : 'bg-[var(--text-muted)]'
        }`}
        aria-hidden
      />
      <span className="font-mono uppercase tracking-wider">Coding</span>
    </button>
  )
}

function PermissionsDropdown() {
  const mode = useUiStore((s) => s.permissionsMode)
  const setMode = useUiStore((s) => s.setPermissionsMode)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useClickOutside(wrapRef, () => setOpen(false), open)

  const active = PERMISSION_OPTIONS.find((o) => o.id === mode) ?? PERMISSION_OPTIONS[0]

  return (
    <div ref={wrapRef} className="relative">
      <DropdownButton open={open} onToggle={() => setOpen((v) => !v)} title="Permissions mode">
        <img src={active.icon} alt="" aria-hidden className="icon-asset h-[25px] w-[25px] object-contain" />
        <span>{active.label}</span>
      </DropdownButton>
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-1 w-52 overflow-hidden rounded-lg border border-[var(--panel-border)] bg-[var(--bg-secondary)] shadow-xl">
          {PERMISSION_OPTIONS.map((opt) => {
            const icon = opt.icon
            return (
              <button
                key={opt.id}
                onClick={() => {
                  setMode(opt.id)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors ${
                  opt.id === mode
                    ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <img src={icon} alt="" aria-hidden className="icon-asset h-[25px] w-[25px] object-contain" />
                <span>{opt.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface ModelDropdownProps {
  onRequestKey: (providerId: string) => void
}

function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 1 1 8 0v4" />
    </svg>
  )
}

function ModelDropdown({ onRequestKey }: ModelDropdownProps) {
  const activeModel = useChatStore((s) => s.activeModel)
  const setModel = useChatStore((s) => s.setModel)
  const allModels = useModelStore((s) => s.models)
  const hasKey = useProvidersStore((s) => s.hasKey)
  const refreshProviders = useProvidersStore((s) => s.refresh)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useClickOutside(wrapRef, () => setOpen(false), open)

  useEffect(() => {
    void refreshProviders()
  }, [refreshProviders])

  const fallback: ModelInfo[] = [
    { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', provider: 'deepseek', contextWindow: 1_000_000, supportsTools: true, supportsVision: false },
    { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', provider: 'deepseek', contextWindow: 1_000_000, supportsTools: true, supportsVision: false },
    { id: 'qwen3-max', name: 'Qwen3 Max', provider: 'dashscope', contextWindow: 262144, supportsTools: true, supportsVision: false },
    { id: 'qwen3-coder-plus', name: 'Qwen3 Coder Plus', provider: 'dashscope', contextWindow: 1_000_000, supportsTools: true, supportsVision: false },
    { id: 'qwen3-coder-flash', name: 'Qwen3 Coder Flash', provider: 'dashscope', contextWindow: 1_000_000, supportsTools: true, supportsVision: false },
    { id: 'qwen3.5-plus', name: 'Qwen 3.5 Plus', provider: 'dashscope', contextWindow: 1_000_000, supportsTools: false, supportsVision: true },
    { id: 'qwen3.5-flash', name: 'Qwen 3.5 Flash', provider: 'dashscope', contextWindow: 1_000_000, supportsTools: false, supportsVision: true },
    { id: 'qwen-long', name: 'Qwen Long', provider: 'dashscope', contextWindow: 10_000_000, supportsTools: false, supportsVision: false },
    { id: 'gemma-4-31b-it-free', name: 'Gemma 4 31B (free, OpenRouter)', provider: 'openrouter', contextWindow: 262144, supportsTools: true, supportsVision: true },
    { id: 'gemma-4-31b-it', name: 'Gemma 4 31B (OpenRouter)', provider: 'openrouter', contextWindow: 262144, supportsTools: true, supportsVision: true },
    { id: 'gemma-4-26b-a4b-it-free', name: 'Gemma 4 26B A4B (free, OpenRouter)', provider: 'openrouter', contextWindow: 262144, supportsTools: true, supportsVision: true },
    { id: 'gemma-4-26b-a4b-it', name: 'Gemma 4 26B A4B (OpenRouter)', provider: 'openrouter', contextWindow: 262144, supportsTools: true, supportsVision: true },
    { id: 'gemma-3-27b-it', name: 'Gemma 3 27B', provider: 'google', contextWindow: 131072, supportsTools: true, supportsVision: true },
    { id: 'gemma-3-12b-it', name: 'Gemma 3 12B', provider: 'google', contextWindow: 131072, supportsTools: true, supportsVision: true },
    { id: 'deepseek-chat', name: 'DeepSeek Chat (legacy alias)', provider: 'deepseek', contextWindow: 1_000_000, supportsTools: true, supportsVision: false },
    { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner (legacy alias)', provider: 'deepseek', contextWindow: 1_000_000, supportsTools: false, supportsVision: false }
  ]
  const models = allModels.length > 0 ? allModels : fallback
  const active = models.find((m) => m.id === activeModel) ?? models[0]
  const activeLocked = !hasKey(active.provider)

  return (
    <div ref={wrapRef} className="relative">
      <DropdownButton open={open} onToggle={() => setOpen((v) => !v)} title="Switch model">
        {activeLocked && (
          <span className="text-[var(--warning)]" title={`${active.provider ?? 'provider'} key required`}>
            <LockIcon />
          </span>
        )}
        <span className="font-medium">{active.name}</span>
      </DropdownButton>
      {open && (
        <div className="absolute bottom-full right-0 z-30 mb-1 w-72 overflow-hidden rounded-lg border border-[var(--panel-border)] bg-[var(--bg-secondary)] shadow-xl">
          {models.map((m) => {
            const locked = !hasKey(m.provider)
            return (
              <button
                key={m.id}
                onClick={() => {
                  setOpen(false)
                  if (locked) {
                    if (m.provider) onRequestKey(m.provider)
                    else toast.error(`No provider configured for ${m.name}`)
                    return
                  }
                  void setModel(m.id)
                }}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs transition-colors ${
                  m.id === activeModel
                    ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                    : locked
                    ? 'text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)]'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span className="flex items-center gap-1.5 truncate">
                  {locked && (
                    <span className="text-[var(--warning)]">
                      <LockIcon />
                    </span>
                  )}
                  <span className="truncate font-medium">{m.name}</span>
                </span>
                {locked ? (
                  <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--warning)]">
                    Add key
                  </span>
                ) : m.id === activeModel ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--accent)]" aria-hidden>
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                ) : null}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface ChipMenuItem {
  label: string
  description?: string
  onSelect: () => void
  active?: boolean
}

interface ContextChipProps {
  icon: string
  label: string
  title?: string
  onClick?: () => void
  menu?: ChipMenuItem[]
}

function ContextChip({ icon, label, title, onClick, menu }: ContextChipProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useClickOutside(wrapRef, () => setOpen(false), open)

  const hasMenu = !!menu && menu.length > 0
  const interactive = hasMenu || !!onClick

  const handleClick = () => {
    if (hasMenu) {
      setOpen((v) => !v)
      return
    }
    onClick?.()
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={handleClick}
        title={title ?? label}
        disabled={!interactive}
        aria-haspopup={hasMenu ? 'menu' : undefined}
        aria-expanded={hasMenu ? open : undefined}
        className={`flex items-center gap-1.5 rounded-md border border-[var(--panel-border)] bg-[var(--bg-tertiary)] px-2 py-1 text-[12px] text-[var(--text-secondary)] transition-colors ${
          interactive
            ? 'hover:border-[var(--accent)] hover:text-[var(--text-primary)]'
            : 'cursor-default opacity-90'
        } ${open ? 'border-[var(--accent)] text-[var(--text-primary)]' : ''}`}
      >
        <span className="relative flex h-[18px] w-[18px] items-center justify-center">
          <img
            src={icon}
            alt=""
            aria-hidden
            className="icon-asset h-[18px] w-[18px] object-contain"
          />
        </span>
        <span className="leading-none">{label}</span>
        {hasMenu && (
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        )}
      </button>

      {hasMenu && open && (
        <div
          role="menu"
          className="absolute bottom-full left-0 z-30 mb-1 min-w-[220px] overflow-hidden rounded-lg border border-[var(--panel-border)] bg-[var(--bg-secondary)] py-1 shadow-xl"
        >
          {menu!.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
              className={`flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left text-[12px] transition-colors ${
                item.active
                  ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <span className="font-medium">{item.label}</span>
              {item.description && (
                <span className="text-[11px] text-[var(--text-muted)]">{item.description}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface ContextChipRowProps {
  onAddFile: () => void
}

function ContextChipRow({ onAddFile }: ContextChipRowProps) {
  const [workdir, setWorkdir] = useState<{ path: string; name: string } | null>(null)

  useEffect(() => {
    if (!window.api?.files?.getWorkdir) return
    let cancelled = false
    window.api.files
      .getWorkdir()
      .then((res: { success: boolean; data?: { path: string; name: string } }) => {
        if (!cancelled && res.success && res.data) setWorkdir(res.data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const handlePickFolder = async () => {
    if (!window.api?.files?.pickWorkdir) return
    try {
      const res = await window.api.files.pickWorkdir()
      if (!(res.success && res.data)) return
      // pickWorkdir only returns the chosen path; persisting it through
      // setWorkdir is what makes tool execution honor the user's choice.
      // The chip-local state mirrors the persisted value either way.
      const persisted = await window.api.files.setWorkdir?.(res.data.path)
      if (persisted && persisted.success && persisted.data) {
        setWorkdir(persisted.data)
      } else {
        setWorkdir(res.data)
      }
    } catch {
      /* ignore */
    }
  }

  const folderLabel = workdir?.name ?? '(no folder)'
  const folderTitle = workdir?.path
    ? `Working folder: ${workdir.path} (click to change)`
    : 'Click to choose a working folder'

  const locationMenu: ChipMenuItem[] = [
    {
      label: 'Local',
      description: 'This machine',
      active: true,
      onSelect: () => {
        /* already local */
      }
    },
    {
      label: 'Remote (coming soon)',
      description: 'Run against a remote dev container',
      onSelect: () => toast.info('Remote execution — coming soon')
    }
  ]

  const folderMenu: ChipMenuItem[] = [
    {
      label: 'Change folder…',
      description: workdir?.path ?? 'No folder selected',
      onSelect: handlePickFolder
    },
    {
      label: 'Use current process folder',
      description: 'Reset to the folder Lamprey was launched from',
      onSelect: () => {
        // Reset: clearWorkdir drops the persisted override, getWorkdir then
        // returns process.cwd() as the fallback.
        const api = window.api?.files
        if (!api) return
        const clear = api.clearWorkdir
          ? api.clearWorkdir()
          : Promise.resolve({ success: true })
        Promise.resolve(clear)
          .then(() => api.getWorkdir())
          .then((res: { success: boolean; data?: { path: string; name: string } }) => {
            if (res.success && res.data) setWorkdir(res.data)
          })
          .catch(() => {})
      }
    }
  ]

  const worktreeMenu: ChipMenuItem[] = [
    { label: 'main', description: 'Default branch', active: true, onSelect: () => {} },
    {
      label: 'Switch branch (coming soon)',
      description: 'Pick a different git branch',
      onSelect: () => toast.info('Branch switching — coming soon')
    },
    {
      label: 'New worktree (coming soon)',
      description: 'Run agents in an isolated worktree',
      onSelect: () => toast.info('Worktrees — coming soon')
    }
  ]

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 px-1">
      <ContextChip
        icon={workLocationIcon}
        label="Local"
        title="Running locally on this machine"
        menu={locationMenu}
      />
      <ContextChip
        icon={folderIcon}
        label={folderLabel}
        title={folderTitle}
        menu={folderMenu}
      />
      <ContextChip
        icon={worktreeIcon}
        label="main · worktree"
        title="Active git worktree"
        menu={worktreeMenu}
      />
      <ContextChip
        icon={addFileIcon}
        label="Add file"
        title="Attach a file to your prompt"
        onClick={onAddFile}
      />
      {/* Right-aligned tool-activity consolidator. The cards used to live
          inline in the transcript and stack into a wall of rows during
          exploration bursts; they now hide behind this chip so the chat
          panel stays clean. The chip itself returns null when the turn
          has no tool calls, so idle turns show nothing here. */}
      <ToolActivityChip />
    </div>
  )
}

interface AddMenuItem {
  label: string
  shortcut?: string
  onSelect: () => void
}

interface AddMenuProps {
  onPickFile: () => void
  onOpenSettings: () => void
  onInsertSlash: () => void
}

function AddMenu({ onPickFile, onOpenSettings, onInsertSlash }: AddMenuProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  useClickOutside(wrapRef, () => setOpen(false), open)

  const items: AddMenuItem[] = [
    { label: 'Add files or photos', shortcut: 'Ctrl+U', onSelect: onPickFile },
    { label: 'Add folder', onSelect: () => toast.info('Add folder — coming soon') },
    { label: 'Import GitHub issue', onSelect: () => toast.info('Import GitHub issue — coming soon') },
    { label: 'Slash commands', onSelect: onInsertSlash },
    { label: 'Connectors', onSelect: () => toast.info('Connectors — coming soon') },
    { label: 'Plugins', onSelect: onOpenSettings }
  ]

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Add"
        aria-label="Add"
        className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-30 mb-1 w-60 overflow-hidden rounded-lg border border-[var(--panel-border)] bg-[var(--bg-secondary)] py-1 shadow-xl">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
            >
              <span>{item.label}</span>
              {item.shortcut && (
                <span className="font-mono text-[11px] text-[var(--text-muted)]">{item.shortcut}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ChatInput({ onSend, onCancel, isStreaming, disabled }: ChatInputProps) {
  const [content, setContent] = useState('')
  const [pasteOffer, setPasteOffer] = useState<string | null>(null)
  const [keyPromptProvider, setKeyPromptProvider] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Fluidity J1: ↑/↓ walks past user prompts. Index tracking lives in a ref
  // so re-renders triggered by setContent() don't reset our position.
  const historyRef = useRef<PromptHistoryState>(emptyHistoryState)
  const addAttachments = useChatStore((s) => s.addAttachments)
  const setProcessing = useChatStore((s) => s.setAttachmentsProcessing)
  const composeSeedToken = useUiStore((s) => s.composeSeedToken)
  const consumeComposeDraft = useUiStore((s) => s.consumeComposeDraft)
  const seedMemoryDescription = useUiStore((s) => s.seedMemoryDescription)
  const openSettings = useUiStore((s) => s.openSettings)
  const refreshProviders = useProvidersStore((s) => s.refresh)
  const hasKey = useProvidersStore((s) => s.hasKey)
  const activeModel = useChatStore((s) => s.activeModel)
  const allModels = useModelStore((s) => s.models)
  const activeModelInfo = allModels.find((m) => m.id === activeModel)
  const activeProvider = activeModelInfo?.provider
  const activeProviderHasKey = activeProvider ? hasKey(activeProvider) : true

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
    }
  }, [content])

  useEffect(() => {
    if (composeSeedToken === 0) return
    const seed = consumeComposeDraft()
    if (!seed) return
    setContent(seed)
    const ta = textareaRef.current
    if (ta) {
      ta.focus()
      requestAnimationFrame(() => {
        const len = ta.value.length
        ta.setSelectionRange(len, len)
      })
    }
  }, [composeSeedToken, consumeComposeDraft])

  const handleSlashCommand = async (raw: string): Promise<boolean> => {
    const tokens = raw.trim().split(/\s+/)
    const cmd = tokens[0]?.toLowerCase()
    const activeConvId = useChatStore.getState().activeConversationId
    switch (cmd) {
      case '/compact': {
        if (!activeConvId) {
          toast.error('No active conversation.')
          return true
        }
        toast.info('Compacting conversation…')
        const res = await window.api?.conversation?.compact(activeConvId)
        if (!res?.success) {
          toast.error(res?.error ?? 'Compact failed')
        } else {
          await useChatStore.getState().selectConversation(activeConvId)
          toast.success('Conversation compacted.')
        }
        return true
      }
      case '/fork': {
        if (!activeConvId) {
          toast.error('No active conversation.')
          return true
        }
        const res = await window.api?.conversation?.fork(activeConvId)
        if (!res?.success) {
          toast.error(res?.error ?? 'Fork failed')
        } else {
          await useChatStore.getState().loadConversations()
          const forked = res.data as { id: string }
          await useChatStore.getState().selectConversation(forked.id)
          toast.success('Forked conversation.')
        }
        return true
      }
      case '/models': {
        // Open settings on the Models pane — closest hook we have.
        useUiStore.getState().openSettings()
        toast.info('Pick a model in Settings → Models')
        return true
      }
      case '/fast': {
        toast.info('Fast mode is not yet wired to a provider in Lamprey.')
        return true
      }
      case '/plan': {
        // Track 2 / C4 + C3 — `/plan` now flips the real per-conversation
        // dispatcher gate (PlanModeBanner appears). The legacy UI flag
        // and Shift+Tab toggle keep working alongside it for now.
        if (activeConvId) {
          const ok = await usePlanStore.getState().enterPlanMode(activeConvId)
          if (ok) toast.success('Plan mode is on. Mutating tools are blocked.')
          else toast.error('Failed to enter plan mode.')
        } else {
          toast.error('No active conversation.')
        }
        return true
      }
      case '/clear': {
        // Track 2 / C4 — renderer-side clear: drop visible messages but
        // keep the conversation row. The `clear.md` template is hidden in
        // the palette and only resolves through IPC for harness use.
        useChatStore.setState({ messages: [], streamingContent: '', streamingReasoning: '' })
        toast.info('Cleared visible messages.')
        return true
      }
      default: {
        // Track 2 / C4 — try the filesystem-discovered slash-command
        // resolver. Anything that resolves to a prompt is dispatched as a
        // normal user turn. Unknown commands fall through to a toast so
        // the user sees the typo.
        const rest = raw.trim().slice(cmd?.length ?? 0).trim()
        const slashResult = await useSlashCommandsStore
          .getState()
          .resolve(cmd?.slice(1) ?? '', rest)
        if (slashResult) {
          onSend(slashResult.prompt)
          return true
        }
        toast.error(`Unknown slash command: ${cmd}`)
        return true
      }
    }
  }

  // Fluidity J3: @file mention popover state. The popover is independent
  // of the slash palette and triggers when detectAtMention finds an
  // `@<token>` immediately preceding the caret (not inside a code fence).
  // workspaceFiles caches walkProject() output for the popover to rank
  // against — same shape QuickOpenPalette uses, kept local here so the
  // input bar doesn't depend on the docked file panel's lifecycle.
  const [workspaceFiles, setWorkspaceFiles] = useState<string[] | null>(null)
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [atMentionDismissed, setAtMentionDismissed] = useState(false)
  const [caretPos, setCaretPos] = useState<number>(0)

  // Track 2 / C4 — slash palette state. The palette appears whenever the
  // input begins with '/' AND has no newline (so a code block beginning
  // with '/' does not trip it). The user can dismiss with Esc; we close
  // the palette via `slashPaletteOpen=false` and re-open on the next '/'
  // typed at the start.
  const [slashPaletteOpen, setSlashPaletteOpen] = useState(true)
  const isSlashInput =
    content.startsWith('/') && !content.includes('\n')
  const showSlashPalette =
    isSlashInput && slashPaletteOpen && !isStreaming && !disabled
  // Strip the leading '/' and take everything up to the first whitespace.
  const slashQuery = isSlashInput ? content.slice(1).split(/\s/)[0] : ''

  useEffect(() => {
    // Re-open the palette whenever the user starts a fresh '/' token.
    if (isSlashInput && !slashPaletteOpen) setSlashPaletteOpen(true)
  }, [isSlashInput, slashPaletteOpen])

  const applySlashName = (name: string) => {
    setContent(`/${name} `)
    setSlashPaletteOpen(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  // Fluidity J3 — derive the active @-mention token from (content, caret).
  // Recomputed on every render; cheap, and avoids missing a token when the
  // user clicks elsewhere in the textarea.
  const mention = detectAtMention(content, caretPos)
  const showAtMention = mention !== null && !atMentionDismissed && !isStreaming && !disabled

  // Lazy-load the workspace file index the first time the popover opens.
  useEffect(() => {
    if (!showAtMention) return
    if (workspaceFiles !== null || workspaceLoading) return
    if (!window.api?.files) return
    let cancelled = false
    setWorkspaceLoading(true)
    void (async () => {
      try {
        const wd = await window.api.files.getWorkdir()
        if (cancelled || !wd.success || !wd.data) {
          if (!cancelled) setWorkspaceLoading(false)
          return
        }
        const root = wd.data.path
        const w = await window.api.files.walkProject(root)
        if (cancelled) return
        if (w.success) {
          const data = w.data as { files: string[] }
          setWorkspaceFiles(data.files)
          setWorkspaceRoot(root)
        }
      } finally {
        if (!cancelled) setWorkspaceLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [showAtMention, workspaceFiles, workspaceLoading])

  const applyAtMention = (relPath: string) => {
    if (!mention) return
    const sep = workspaceRoot && workspaceRoot.includes('\\') ? '\\' : '/'
    const fullPath = workspaceRoot ? `${workspaceRoot}${sep}${relPath}` : relPath
    const basename = relPath.split(/[\\/]/).pop() ?? relPath
    // Replace the @<token> run with a collapsed @<basename> in the textarea.
    const next = `${content.slice(0, mention.start)}@${basename} ${content.slice(mention.end)}`
    setContent(next)
    setAtMentionDismissed(false)
    // Process + attach the picked file via the existing pipeline so the
    // next send carries its content as a ProcessedFile attachment.
    if (window.api?.files?.process) {
      setProcessing(true)
      void window.api.files
        .process([fullPath])
        .then((res) => {
          if (res.success) addAttachments(res.data as ProcessedFile[])
          else if (res.error) toast.error(`Attach failed: ${res.error}`)
        })
        .finally(() => setProcessing(false))
    }
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      const newCaret = mention.start + basename.length + 2 // "@" + name + " "
      ta.focus()
      ta.setSelectionRange(newCaret, newCaret)
      setCaretPos(newCaret)
    })
  }

  // Fluidity J4 — derive memory-write mode from the current content.
  // Pure detector lives in @/lib/memory-shortcut; this is just the wiring.
  const memoryShortcut = detectMemoryShortcut(content)

  const handleSubmit = () => {
    const trimmed = content.trim()
    if (!trimmed || isStreaming || disabled) return
    if (activeProvider && !activeProviderHasKey) {
      setKeyPromptProvider(activeProvider)
      return
    }
    // Fluidity J4 — `#…` opens MemoryEditor with the description prefilled
    // instead of dispatching as a normal chat turn. The editor is the
    // confirm-before-save step required by the feedback_no_fake_polish
    // invariant: we never write memory silently.
    if (memoryShortcut) {
      seedMemoryDescription(memoryShortcut.description)
      setContent('')
      historyRef.current = emptyHistoryState
      return
    }
    if (trimmed.startsWith('/')) {
      void handleSlashCommand(trimmed).then((handled) => {
        if (handled) {
          setContent('')
          setSlashPaletteOpen(true)
          historyRef.current = emptyHistoryState
        }
      })
      return
    }
    const planMode = useUiStore.getState().planMode
    const final = planMode
      ? `[PLAN MODE — produce a plan first, list assumptions and steps, then await my confirmation before executing.]\n\n${trimmed}`
      : trimmed
    onSend(final)
    setContent('')
    historyRef.current = emptyHistoryState
  }

  // Fluidity J2: Shift+Tab walks default → auto-review → full → plan → default.
  // permissionsMode + the legacy planMode flag both update unconditionally so
  // the existing PermissionsDropdown + plan banner stay in sync; if an active
  // conversation exists, plan transitions also drive the real IPC gate via
  // usePlanMode so persistence (conversations.plan_mode_active) is honored.
  const permissionsMode = useUiStore((s) => s.permissionsMode)
  const planModeLocal = useUiStore((s) => s.planMode)
  const planModeActive = usePlanStore((s) => s.planModeActive ?? false)
  const setPermissionsMode = useUiStore((s) => s.setPermissionsMode)
  const setPlanModeFlag = useUiStore((s) => s.setPlanMode)
  const planControl = usePlanMode()

  // "Live" slot blends ui-store's local flags with plan-store's IPC truth so
  // the indicator reflects whichever transitioned most recently.
  const liveSlot: ModeSlot = currentSlot({
    permissions: permissionsMode,
    plan: planModeLocal || planModeActive
  })

  const cycleMode = () => {
    const next = nextMode({
      permissions: permissionsMode,
      plan: planModeLocal || planModeActive
    })
    setPermissionsMode(next.permissions)
    setPlanModeFlag(next.plan)
    if (next.plan && !(planModeLocal || planModeActive)) {
      void planControl.enter()
    } else if (!next.plan && (planModeLocal || planModeActive)) {
      void planControl.exit()
    }
    toast.info(`Mode: ${slotLabel(currentSlot(next))}`)
  }

  const moveCaretToEnd = () => {
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      const len = ta.value.length
      ta.setSelectionRange(len, len)
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (pasteOffer) return
    // IME composition (e.g. typing kana / pinyin) sends interim keystrokes;
    // never intercept while a candidate is being assembled.
    if (e.nativeEvent.isComposing) return

    // Fluidity J1 — ↑ / ↓ walks prompt history when the caret is on line 1
    // and nothing is selected. Otherwise it falls through to native arrow
    // navigation so the user can still move inside a multi-line draft.
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const ta = e.currentTarget
      const selStart = ta.selectionStart ?? 0
      const selEnd = ta.selectionEnd ?? 0
      const onFirstLine = ta.value.slice(0, selStart).indexOf('\n') === -1
      const hasSelection = selStart !== selEnd
      const browsing = historyRef.current.index !== null
      // While browsing, both arrows are owned by the walker regardless of
      // caret position — the textarea holds a recalled prompt and the user
      // is paging through history, not editing.
      if (browsing || (onFirstLine && !hasSelection)) {
        const history = useChatStore.getState().getRecentUserPrompts()
        if (e.key === 'ArrowUp') {
          if (history.length === 0) return
          e.preventDefault()
          const step = historyUp(history, historyRef.current, content)
          historyRef.current = step.state
          setContent(step.text)
          moveCaretToEnd()
          return
        }
        if (e.key === 'ArrowDown' && browsing) {
          e.preventDefault()
          const step = historyDown(history, historyRef.current)
          historyRef.current = step.state
          setContent(step.text)
          moveCaretToEnd()
          return
        }
      }
    }

    // Esc while browsing restores the saved draft. Streaming-cancel and
    // search-clear are handled globally in useKeyboardShortcuts — we only
    // claim Esc here when we have local history state to unwind.
    if (e.key === 'Escape' && historyRef.current.index !== null) {
      e.preventDefault()
      e.stopPropagation()
      const step = historyReset(historyRef.current)
      historyRef.current = step.state
      setContent(step.text)
      moveCaretToEnd()
      return
    }

    if (e.key === 'Tab' && e.shiftKey) {
      // Only claim Shift+Tab when the textarea has no content — mid-draft
      // we leave it for native focus navigation per the J2 spec.
      if (content.length > 0) return
      e.preventDefault()
      cycleMode()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handlePickerClick = async () => {
    if (!window.api) return
    setProcessing(true)
    try {
      const result = await window.api.files.openPicker()
      if (result.success) addAttachments(result.data as ProcessedFile[])
      else if (result.error) toast.error(`File picker failed: ${result.error}`)
    } finally {
      setProcessing(false)
    }
  }

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const blob = item.getAsFile()
          if (!blob) continue
          e.preventDefault()
          try {
            const dataUrl = await blobToDataURL(blob)
            const ext = (blob.type.split('/')[1] ?? 'png').replace('+xml', '')
            const stamp = new Date().toISOString().replace(/[:.]/g, '-')
            const attachment: ProcessedFile = {
              name: `pasted-${stamp}.${ext}`,
              kind: 'image',
              mimeType: blob.type,
              size: blob.size,
              content: dataUrl,
              previewText: `Pasted image (${Math.round(blob.size / 1024)} KB)`
            }
            addAttachments([attachment])
          } catch (err) {
            toast.error(`Could not paste image: ${(err as Error).message}`)
          }
          return
        }
      }
    }

    const text = e.clipboardData?.getData('text/plain') ?? ''
    if (looksLikeCode(text)) {
      e.preventDefault()
      setPasteOffer(text)
    }
  }

  const handlePasteOfferAccept = () => {
    if (!pasteOffer) return
    const ext = /<\/?[a-zA-Z][^>]*>/.test(pasteOffer) ? 'html' : 'txt'
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const attachment: ProcessedFile = {
      name: `pasted-${stamp}.${ext}`,
      kind: 'text',
      mimeType: 'text/plain',
      size: new Blob([pasteOffer]).size,
      content: pasteOffer,
      previewText: `${pasteOffer.split(/\r?\n/).length} lines · pasted`
    }
    addAttachments([attachment])
    setPasteOffer(null)
  }

  const handlePasteOfferInline = () => {
    if (!pasteOffer) return
    const textarea = textareaRef.current
    if (textarea) {
      const start = textarea.selectionStart ?? content.length
      const end = textarea.selectionEnd ?? content.length
      setContent(content.slice(0, start) + pasteOffer + content.slice(end))
    } else {
      setContent(content + pasteOffer)
    }
    setPasteOffer(null)
  }

  const canSend = content.trim().length > 0 && !disabled && !isStreaming
  const planMode = useUiStore((s) => s.planMode)

  return (
    <div className="w-full">
      {planMode && (
        <div className="mb-2 flex items-center justify-between rounded-md border border-[var(--accent)] bg-[var(--accent-dim)] px-3 py-1.5 text-[12px] text-[var(--accent)]">
          <span className="font-mono">PLAN MODE · Shift+Tab to toggle</span>
          <button
            onClick={() => useUiStore.getState().setPlanMode(false)}
            className="rounded px-1 text-[10px] uppercase tracking-wider hover:bg-[var(--bg-tertiary)]"
            title="Turn plan mode off"
          >
            off
          </button>
        </div>
      )}
      {pasteOffer && (
        <div className="mb-2 flex w-full flex-wrap items-center gap-2 rounded-2xl border border-[var(--accent)] bg-[var(--accent-dim)] px-3 py-2 text-xs text-[var(--text-primary)]">
          <span className="flex-1">
            That looks like code ({pasteOffer.length.toLocaleString()} chars). Attach it as a file or
            paste inline?
          </span>
          <button
            onClick={handlePasteOfferAccept}
            className="rounded bg-[var(--accent)] px-2 py-1 text-[13px] font-medium text-white hover:opacity-90"
          >
            Paste as attachment
          </button>
          <button
            onClick={handlePasteOfferInline}
            className="rounded border border-[var(--panel-border)] px-2 py-1 text-[13px] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            Paste inline
          </button>
          <button
            onClick={() => setPasteOffer(null)}
            className="rounded px-1.5 py-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            title="Dismiss"
            aria-label="Dismiss"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <div className="relative flex w-full flex-col gap-2 rounded-3xl border border-[var(--panel-border)] bg-[var(--panel-bg)] px-4 pt-3 pb-2 shadow-lg backdrop-blur-sm">
        {/* Track 2 / C4 — slash-command palette. Anchored to this
            container's top edge via `bottom-full`, so it floats above
            the input box without affecting layout. */}
        {showSlashPalette && (
          <SlashCommandPalette
            query={slashQuery}
            onApply={applySlashName}
            onClose={() => setSlashPaletteOpen(false)}
          />
        )}
        {/* Fluidity J3 — @file mention popover. Mounted only when the
            caret sits inside an @<token> run that's NOT inside a code
            fence. Slash palette and this one are mutually exclusive in
            practice because a single character can't be both `/` AND
            `@`-prefixed. */}
        {showAtMention && mention && (
          <AtFileMention
            query={mention.token}
            files={workspaceFiles ?? []}
            loading={workspaceLoading}
            onApply={applyAtMention}
            onClose={() => setAtMentionDismissed(true)}
          />
        )}
        <div className="flex items-start gap-2">
          <textarea
            ref={textareaRef}
            data-chat-input
            value={content}
            onChange={(e) => {
              setContent(e.target.value)
              setCaretPos(e.target.selectionStart ?? e.target.value.length)
              // Any keystroke that mutates text is "I'm done browsing":
              // drop the history index so the next ↑ starts fresh.
              if (historyRef.current.index !== null) {
                historyRef.current = emptyHistoryState
              }
              // Typing extends/changes the @-token — re-arm the popover
              // even if the user just dismissed it with Esc.
              if (atMentionDismissed) setAtMentionDismissed(false)
            }}
            onClick={(e) => setCaretPos(e.currentTarget.selectionStart ?? 0)}
            onSelect={(e) => setCaretPos(e.currentTarget.selectionStart ?? 0)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Ask anything — ↑ for history"
            rows={1}
            disabled={disabled}
            style={{ paddingLeft: '20px', paddingTop: '8px' }}
            className="max-h-[200px] min-h-[28px] flex-1 resize-none bg-transparent text-sm leading-relaxed text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
          />

          {isStreaming ? (
            <button
              onClick={onCancel}
              title="Stop streaming"
              aria-label="Stop streaming"
              className="group flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-full bg-[var(--bg-tertiary)] transition-all hover:scale-105 hover:bg-[var(--error)]"
            >
              <img
                src={stopIcon}
                alt=""
                aria-hidden
                className="icon-asset-crisp themed-variant-light h-[45px] w-[45px] object-contain"
              />
            </button>
          ) : memoryShortcut ? (
            // Fluidity J4 — in memory-write mode the Send pill becomes a
            // "Remember" pill that opens the editor instead of dispatching.
            <button
              onClick={handleSubmit}
              disabled={!canSend}
              title="Open memory editor (Enter)"
              aria-label="Remember"
              data-mode="memory"
              className="flex h-[60px] shrink-0 items-center justify-center gap-1.5 rounded-full bg-[var(--accent)] px-4 text-sm font-medium text-[var(--bg-primary)] transition-all hover:scale-105 hover:opacity-90 disabled:opacity-50 disabled:hover:scale-100"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
              </svg>
              Remember
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!canSend}
              title="Send (Enter)"
              aria-label="Send"
              className="flex h-[60px] w-[60px] shrink-0 items-center justify-center rounded-full bg-[var(--bg-tertiary)] transition-all hover:scale-105 hover:bg-[var(--accent)] disabled:opacity-40 disabled:hover:scale-100 disabled:hover:bg-[var(--bg-tertiary)]"
            >
              <img
                src={sendIcon}
                alt=""
                aria-hidden
                className="icon-asset-crisp h-[45px] w-[45px] object-contain"
              />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1">
          <AddMenu
            onPickFile={handlePickerClick}
            onOpenSettings={openSettings}
            onInsertSlash={() => {
              setContent((c) => (c.startsWith('/') ? c : `/${c}`))
              textareaRef.current?.focus()
            }}
          />

          <PermissionsDropdown />

          <CodingModeToggle />

          <div className="flex-1" />

          <ModelDropdown onRequestKey={(providerId) => setKeyPromptProvider(providerId)} />

          <button
            onClick={() => toast.info('Voice input coming soon')}
            title="Voice input"
            aria-label="Voice input"
            className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            <img src={micIcon} alt="" aria-hidden className="icon-asset h-[25px] w-[25px] object-contain" />
          </button>
        </div>

        <ContextChipRow onAddFile={handlePickerClick} />
      </div>

      {/* Fluidity J2 — slim mode indicator below the input bar. The `key` swap
          on slot change gives React a fresh element each cycle so the CSS
          opacity transition replays without needing a keyframe definition. */}
      <div className="mt-1 flex justify-center">
        <span
          key={liveSlot}
          data-mode-slot={liveSlot}
          style={{ opacity: 0, animation: 'lamprey-mode-fade 200ms ease-out forwards' }}
          className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-muted)]"
        >
          {slotLabel(liveSlot)} · ⇧⇥ to cycle
        </span>
      </div>
      <style>{`@keyframes lamprey-mode-fade { from { opacity: 0; transform: translateY(-1px) } to { opacity: 1; transform: translateY(0) } }`}</style>

      {keyPromptProvider && (
        <ApiKeyModal
          defaultProvider={keyPromptProvider}
          required={false}
          onDismiss={() => setKeyPromptProvider(null)}
          onComplete={async () => {
            await refreshProviders()
            setKeyPromptProvider(null)
            toast.success('Key saved — model unlocked')
          }}
        />
      )}
    </div>
  )
}
