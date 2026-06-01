import { PopoverMenu } from '@/components/ui/PopoverMenu'
import { MenuRow } from '@/components/ui/MenuRow'
import { useUiStore, type ShellKind } from '@/stores/ui-store'
import { toast } from '@/stores/toast-store'

interface ToolLauncherPopoverProps {
  open: boolean
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement | null>
}

function VSCodeGlyph(): React.ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M16 4l4 2v12l-4 2-9-7 9-9z" />
      <path d="M16 4L4 12l12 8" />
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
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  )
}

function TerminalGlyph(): React.ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <polyline points="7 9 10 12 7 15" />
      <line x1="13" y1="16" x2="17" y2="16" />
    </svg>
  )
}

function GitBashGlyph(): React.ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l3 3-3 3" />
      <line x1="13" y1="15" x2="16" y2="15" />
    </svg>
  )
}

function WSLGlyph(): React.ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 12c2-4 5-6 9-6s7 2 9 6c-2 4-5 6-9 6s-7-2-9-6z" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  )
}

export function ToolLauncherPopover({
  open,
  onClose,
  anchorRef
}: ToolLauncherPopoverProps): React.ReactElement {
  const setActiveTool = useUiStore((s) => s.setActiveTool)
  const setActiveShell = useUiStore((s) => s.setActiveShell)
  // Prefer process.platform forwarded via preload; falls back to false when
  // running outside Electron (browser dev mode).
  const isWindows = window.api?.app?.platform === 'win32'

  const launchVSCode = async () => {
    onClose()
    if (!window.api?.files?.openInVSCode) {
      toast.error('VS Code launch unavailable')
      return
    }
    const res = await window.api.files.openInVSCode({})
    if (!res.success) {
      toast.error(res.error ?? 'Could not launch VS Code')
    }
  }

  const openFileExplorer = () => {
    onClose()
    setActiveTool('files')
  }

  const openTerminal = (shell?: ShellKind) => {
    onClose()
    if (shell) setActiveShell(shell)
    setActiveTool('terminal')
  }

  return (
    <PopoverMenu
      open={open}
      onClose={onClose}
      anchorRef={anchorRef}
      align="bottom-start"
      minWidth={200}
      ariaLabel="Open tool"
    >
      <MenuRow
        label="VS Code"
        leading={<VSCodeGlyph />}
        onSelect={() => void launchVSCode()}
      />
      <MenuRow
        label="File Explorer"
        leading={<FolderGlyph />}
        onSelect={openFileExplorer}
      />
      <MenuRow
        label="Terminal"
        leading={<TerminalGlyph />}
        onSelect={() => openTerminal('powershell')}
      />
      <MenuRow
        label="Git Bash"
        leading={<GitBashGlyph />}
        disabled={!isWindows}
        title={!isWindows ? 'Windows only' : undefined}
        onSelect={() => openTerminal('git-bash')}
      />
      <MenuRow
        label="WSL"
        leading={<WSLGlyph />}
        disabled={!isWindows}
        title={!isWindows ? 'Windows only' : undefined}
        onSelect={() => openTerminal('wsl')}
      />
    </PopoverMenu>
  )
}
