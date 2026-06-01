import { PopoverMenu } from '@/components/ui/PopoverMenu'
import { MenuRow, MenuSeparator, MenuSectionLabel } from '@/components/ui/MenuRow'
import { useAgentStore } from '@/stores/agent-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useUiStore } from '@/stores/ui-store'
import { toast } from '@/stores/toast-store'

interface WorkModePopoverProps {
  open: boolean
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement | null>
}

function SingleAgentGlyph(): React.ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="8" />
    </svg>
  )
}

function PipelineGlyph(): React.ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="5" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <line x1="7" y1="12" x2="10" y2="12" />
      <line x1="14" y1="12" x2="17" y2="12" />
    </svg>
  )
}

function FolderGlyph(): React.ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  )
}

function WorktreeGlyph(): React.ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="6" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="12" r="2" />
      <path d="M6 8v8" />
      <path d="M6 12h10" />
    </svg>
  )
}

export function WorkModePopover({
  open,
  onClose,
  anchorRef
}: WorkModePopoverProps): React.ReactElement {
  const mode = useAgentStore((s) => s.mode)
  const roster = useAgentStore((s) => s.roster)
  const hydrate = useAgentStore((s) => s.hydrate)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const openWorktreeModal = useUiStore((s) => s.openWorktreeModal)

  const setMode = async (next: 'single' | 'multi') => {
    if (next === mode) {
      onClose()
      return
    }
    hydrate(next, roster)
    await updateSettings({ agentMode: next })
    onClose()
    toast.success(
      next === 'multi' ? 'Pipeline mode enabled' : 'Single agent mode enabled'
    )
  }

  const pickWorkdir = async () => {
    onClose()
    if (!window.api?.files?.pickWorkdir) {
      toast.error('Workdir picker unavailable')
      return
    }
    const res = await window.api.files.pickWorkdir()
    if (res.success && res.data) {
      toast.success(`Working folder set: ${res.data.name}`)
    }
  }

  return (
    <PopoverMenu
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      align="bottom-start"
      minWidth={240}
      ariaLabel="Work mode"
    >
      <MenuSectionLabel>Continue in</MenuSectionLabel>
      <MenuRow
        label="Single agent"
        leading={<SingleAgentGlyph />}
        selected={mode === 'single'}
        onSelect={() => void setMode('single')}
      />
      <MenuRow
        label="Pipeline (Planner → Coder → Reviewer)"
        leading={<PipelineGlyph />}
        selected={mode === 'multi'}
        onSelect={() => void setMode('multi')}
      />
      <MenuSeparator />
      <MenuRow
        label="Change workdir…"
        leading={<FolderGlyph />}
        onSelect={() => void pickWorkdir()}
      />
      <MenuRow
        label="Worktree manager"
        leading={<WorktreeGlyph />}
        onSelect={() => {
          onClose()
          openWorktreeModal()
        }}
      />
    </PopoverMenu>
  )
}
