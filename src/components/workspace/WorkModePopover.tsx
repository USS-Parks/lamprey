import { PopoverMenu } from '@/components/ui/PopoverMenu'
import { MenuRow } from '@/components/ui/MenuRow'
import { useUiStore } from '@/stores/ui-store'
import { toast } from '@/stores/toast-store'

interface WorkModePopoverProps {
  open: boolean
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement | null>
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
  // 2026-06-10 user direction — the Single/Pipeline mode switch is REMOVED:
  // the multi-agent pipeline is retired from dispatch and its toggle is gone
  // everywhere. This popover keeps its workspace affordances only.
  const openWorktreeModal = useUiStore((s) => s.openWorktreeModal)

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
