import { useState } from 'react'
import { toast } from '@/stores/toast-store'
import copyIcon from '@assets/Lamprey Copy Icon.png'
import thumbsUpIcon from '@assets/Lamprey Thumbs Up Icon.png'
import thumbsDownIcon from '@assets/Lamprey Thumbs Down Icon.png'
import forkIcon from '@assets/Lamprey Work-Fork Icon.png'
import pinIcon from '@assets/Lamprey Pin As Chapter Icon.png'

interface MessageActionsProps {
  content: string
  onFork?: () => void
  onPin?: () => void
}

type Vote = 'up' | 'down' | null

interface ActionButtonProps {
  icon: string
  title: string
  onClick: () => void
  active?: boolean
}

function ActionButton({ icon, title, onClick, active }: ActionButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`flex h-16 w-16 items-center justify-center rounded-md transition-colors ${
        active
          ? 'bg-[var(--accent-dim)] ring-1 ring-[var(--accent)]'
          : 'hover:bg-[var(--bg-tertiary)]'
      }`}
    >
      <img
        src={icon}
        alt=""
        aria-hidden
        className="icon-asset h-[36px] w-[36px] object-contain"
      />
    </button>
  )
}

function CheckIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-[var(--accent)]"
      aria-hidden
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}

export function MessageActions({ content, onFork, onPin }: MessageActionsProps) {
  const [vote, setVote] = useState<Vote>(null)
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }

  const setVoteWith = (v: Vote) => {
    setVote((prev) => (prev === v ? null : v))
  }

  const handleFork = () => {
    if (onFork) onFork()
    else toast.info('Fork from this message — coming soon')
  }

  const handlePin = () => {
    if (onPin) onPin()
    else toast.info('Pin as memory chapter — coming soon')
  }

  return (
    <div className="mt-2 flex items-center gap-1 pl-1">
      {copied ? (
        <button
          type="button"
          title="Copied"
          aria-label="Copied"
          className="flex h-16 w-16 items-center justify-center rounded-md bg-[var(--accent-dim)]"
        >
          <CheckIcon />
        </button>
      ) : (
        <ActionButton icon={copyIcon} title="Copy" onClick={handleCopy} />
      )}
      <ActionButton
        icon={thumbsUpIcon}
        title="Good response"
        onClick={() => setVoteWith('up')}
        active={vote === 'up'}
      />
      <ActionButton
        icon={thumbsDownIcon}
        title="Bad response"
        onClick={() => setVoteWith('down')}
        active={vote === 'down'}
      />
      <ActionButton icon={forkIcon} title="Fork from here" onClick={handleFork} />
      <ActionButton icon={pinIcon} title="Pin as memory chapter" onClick={handlePin} />
    </div>
  )
}
