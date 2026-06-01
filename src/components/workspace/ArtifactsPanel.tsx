import { useChatStore } from '@/stores/chat-store'
import { useThemedIcon } from '@/lib/themed-icon'
import artifactsHeaderLight from '@assets/Lamprey Code Window Icon.png'
import artifactsHeaderDark from '@assets/Lamprey Code Window Icon Dark View.png'
import thinkingLight from '@assets/Lamprey Thinking Icon.png'
import thinkingDark from '@assets/Lamprey Thinking Icon Dark View.png'
import { ActivityFeed } from '@/components/artifacts/ActivityFeed'
import { PanelEmptyState } from '@/components/ui/PanelEmptyState'

// Docked Artifacts mode. Shows the live ActivityFeed while a tool is
// running, otherwise an empty state directing the user to ask the assistant
// for a renderable artifact. The transient <ArtifactPanel /> in App.tsx
// still hijacks the right column when one is actually generated — this is
// the "no artifact yet" home.
export function ArtifactsPanel(): React.ReactElement {
  const isStreaming = useChatStore((s) => s.isStreaming)
  const toolCalls = useChatStore((s) => s.toolCalls)
  const artifactsIconUrl = useThemedIcon(artifactsHeaderLight, artifactsHeaderDark)
  const thinkingIconUrl = useThemedIcon(thinkingLight, thinkingDark)
  const showActivity = isStreaming || toolCalls.length > 0

  if (showActivity) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2 text-[12px] font-medium text-[var(--text-secondary)]">
          <img
            src={thinkingIconUrl}
            alt=""
            aria-hidden
            className="icon-asset h-6 w-6 animate-pulse object-contain"
          />
          Activity
        </div>
        <ActivityFeed />
      </div>
    )
  }

  return (
    <PanelEmptyState
      icon={
        <img
          src={artifactsIconUrl}
          alt=""
          aria-hidden
          className="icon-asset h-10 w-10 object-contain"
        />
      }
      title="No artifacts yet"
      body="HTML, SVG, Mermaid, or JSX artifacts open here when the assistant generates them."
    />
  )
}
