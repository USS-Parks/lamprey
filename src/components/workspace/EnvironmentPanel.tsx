import { useEffect, useRef, useState } from 'react'
import { useUiStore } from '@/stores/ui-store'
import { useEnvironment } from '@/hooks/useEnvironment'
import { useSources } from '@/hooks/useSources'
import { toast } from '@/stores/toast-store'
import { WorkModePopover } from './WorkModePopover'
import { BranchPickerPopover } from './BranchPickerPopover'
import { RepositoryPickerDialog } from './RepositoryPickerDialog'
import { PullRequestDialog } from './PullRequestDialog'
import { PullRequestListPopover } from './PullRequestListPopover'
import { useGitHubStore } from '@/stores/github-store'
import { useChatStore } from '@/stores/chat-store'
import { github as githubClient } from '@/lib/ipc-client'
import type { ConversationPullRequestLink, GitHubProjectRepoLink } from '@/lib/github-types'

function ChevronDownGlyph(): React.ReactElement {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function ChangesGlyph(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="12" y1="8" x2="12" y2="16" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  )
}

function MonitorGlyph(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  )
}

function BranchGlyph(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  )
}

function CommitGlyph(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <line x1="2" y1="12" x2="8" y2="12" />
      <line x1="16" y1="12" x2="22" y2="12" />
    </svg>
  )
}

function GitHubGlyph(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
    </svg>
  )
}

function PullRequestGlyph(): React.ReactElement {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="18" r="3" />
      <line x1="6" y1="9" x2="6" y2="15" />
      <path d="M18 9a9 9 0 0 0-9-6h-2" />
      <polyline points="11 5 7 1 11 5 7 9" transform="translate(0 -1)" />
    </svg>
  )
}

interface PanelRowProps {
  leading: React.ReactNode
  label: string
  trailing?: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  title?: string
  buttonRef?: React.Ref<HTMLButtonElement>
}

function PanelRow({
  leading,
  label,
  trailing,
  onClick,
  disabled,
  title,
  buttonRef
}: PanelRowProps): React.ReactElement {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={() => {
        if (disabled) return
        onClick?.()
      }}
      disabled={disabled}
      title={title}
      className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] transition-colors ${
        disabled
          ? 'cursor-not-allowed text-[var(--text-muted)] opacity-60'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
      }`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{leading}</span>
      <span className="flex-1 truncate">{label}</span>
      {trailing && <span className="shrink-0">{trailing}</span>}
    </button>
  )
}

export function EnvironmentPanel(): React.ReactElement {
  const setActiveTool = useUiStore((s) => s.setActiveTool)
  const { snapshot, refresh } = useEnvironment()
  const { sources, groups } = useSources()

  const workModeRef = useRef<HTMLButtonElement>(null)
  const branchRef = useRef<HTMLButtonElement>(null)
  const prListRef = useRef<HTMLButtonElement>(null)
  const [workModeOpen, setWorkModeOpen] = useState(false)
  const [branchOpen, setBranchOpen] = useState(false)
  const [committing, setCommitting] = useState(false)

  // GitHub integration state — kept local because the picker/dialogs are
  // only opened from this panel.
  const conversations = useChatStore((s) => s.conversations)
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const activeConversation = conversations.find((c) => c.id === activeConversationId) ?? null
  const projectId = activeConversation?.projectId ?? null
  const githubStatus = useGitHubStore((s) => s.status)
  const refreshGithubStatus = useGitHubStore((s) => s.refreshStatus)
  const [repoLink, setRepoLink] = useState<GitHubProjectRepoLink | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [prDialogOpen, setPrDialogOpen] = useState(false)
  const [prListOpen, setPrListOpen] = useState(false)
  const [linkedPrs, setLinkedPrs] = useState<ConversationPullRequestLink[]>([])

  useEffect(() => {
    if (!activeConversationId) {
      setLinkedPrs([])
      return
    }
    let cancelled = false
    void githubClient.listConversationPullRequests(activeConversationId).then((res) => {
      if (!cancelled) setLinkedPrs(res.success ? res.data : [])
    })
    return () => {
      cancelled = true
    }
    // Refresh when the PR dialog closes (a new PR may have been created).
  }, [activeConversationId, prDialogOpen])

  useEffect(() => {
    void refreshGithubStatus()
  }, [refreshGithubStatus])

  useEffect(() => {
    if (!projectId) {
      setRepoLink(null)
      return
    }
    void githubClient.getProjectRepo(projectId).then((res) => {
      setRepoLink(res.success ? res.data : null)
    })
  }, [projectId])

  // Phase 2a: close the no-project dead-end. If the conversation has a cwd
  // (which `useEnvironment()` already surfaces from the local git status),
  // auto-ensure a project rooted at that cwd and assign this conversation
  // to it before opening the picker. The user sees one fewer modal hop
  // and never sees the old "Assign this conversation to a project first"
  // dead-end toast.
  const openRepoPicker = async (): Promise<void> => {
    if (projectId) {
      setPickerOpen(true)
      return
    }
    if (!snapshot.cwd) {
      toast.warning(
        'Open a folder (Files → Workspace) before linking a GitHub repo — Lamprey needs a project root.'
      )
      return
    }
    if (!activeConversationId) {
      toast.error('No active conversation. Start a chat first.')
      return
    }
    const ensured = await window.api?.projects?.ensureForPath(snapshot.cwd)
    if (!ensured?.success) {
      toast.error(ensured?.error ?? 'Could not create project for current folder')
      return
    }
    const assign = await window.api?.projects?.assignConversation(
      activeConversationId,
      ensured.data.id
    )
    if (!assign?.success) {
      toast.error(assign?.error ?? 'Could not assign conversation to project')
      return
    }
    // The picker reads projectId from the active conversation via the
    // chat store. assignConversation IPC only mutates the DB row, not the
    // in-memory conversations array, so we have to refresh the store
    // before opening the picker — otherwise the picker would read a
    // null projectId and the post-clone assignment would silently no-op.
    await useChatStore.getState().loadConversations()
    setPickerOpen(true)
  }

  const handleCommitOrPush = async () => {
    if (committing || !window.api?.review) return
    if (snapshot.hasChanges) {
      const msg = window.prompt('Commit message:')
      if (!msg?.trim()) return
      setCommitting(true)
      const res = await window.api.review.commit({ message: msg.trim(), stageAll: true })
      setCommitting(false)
      if (!res.success) {
        toast.error(res.error ?? 'Commit failed')
        return
      }
      toast.success('Committed')
      void refresh()
    } else if (snapshot.ahead > 0) {
      setCommitting(true)
      const res = await window.api.review.push()
      setCommitting(false)
      if (!res.success) {
        toast.error(res.error ?? 'Push failed')
        return
      }
      toast.success('Pushed')
      void refresh()
    }
  }

  const commitDisabled = !snapshot.hasChanges && snapshot.ahead === 0
  const commitLabel = snapshot.hasChanges
    ? 'Commit'
    : snapshot.ahead > 0
    ? `Push (${snapshot.ahead} ahead)`
    : 'Commit or push'
  // UB-6 — single-agent always; the 'Pipeline' label died with the toggle.
  const workModeLabel = 'Local'

  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-2">
      <PanelRow
        leading={<ChangesGlyph />}
        label="Changes"
        trailing={
          <span className="font-mono text-[11px]">
            <span className="text-green-500">+{snapshot.additions}</span>{' '}
            <span className="text-red-500">-{snapshot.deletions}</span>
          </span>
        }
        onClick={() => setActiveTool('review')}
      />
      <PanelRow
        buttonRef={workModeRef}
        leading={<MonitorGlyph />}
        label={workModeLabel}
        trailing={<ChevronDownGlyph />}
        onClick={() => setWorkModeOpen((v) => !v)}
      />
      <PanelRow
        buttonRef={branchRef}
        leading={<BranchGlyph />}
        label={snapshot.branch ?? 'detached HEAD'}
        trailing={<ChevronDownGlyph />}
        onClick={() => setBranchOpen((v) => !v)}
        title={
          snapshot.ahead || snapshot.behind
            ? `↑${snapshot.ahead} ↓${snapshot.behind}`
            : undefined
        }
      />
      <PanelRow
        leading={<CommitGlyph />}
        label={commitLabel}
        onClick={() => void handleCommitOrPush()}
        disabled={commitDisabled || committing}
      />

      <div className="my-2 border-t border-[var(--panel-border)]" aria-hidden />

      <div className="px-3 pb-1 pt-1 text-[12px] font-medium text-[var(--text-secondary)]">
        GitHub
      </div>
      <PanelRow
        leading={<GitHubGlyph />}
        label={
          repoLink
            ? repoLink.fullName
            : githubStatus?.connected
              ? 'Link GitHub repo…'
              : 'Connect GitHub…'
        }
        trailing={
          repoLink ? (
            <span className="font-mono text-[10px] text-[var(--text-muted)]">
              {repoLink.localPath ? 'local' : 'remote'}
            </span>
          ) : undefined
        }
        onClick={() => {
          void openRepoPicker()
        }}
        title={
          repoLink
            ? `Default branch: ${repoLink.defaultBranch}`
            : 'Pick a GitHub repository to associate with this project'
        }
      />
      {repoLink && (
        <PanelRow
          buttonRef={prListRef}
          leading={<PullRequestGlyph />}
          label="Pull requests"
          trailing={<ChevronDownGlyph />}
          onClick={() => setPrListOpen((v) => !v)}
        />
      )}
      {repoLink && snapshot.branch && (
        <PanelRow
          leading={<PullRequestGlyph />}
          label={
            snapshot.branch === repoLink.defaultBranch
              ? `New PR from ${snapshot.branch}…`
              : `New PR (${snapshot.branch} → ${repoLink.defaultBranch})`
          }
          onClick={() => setPrDialogOpen(true)}
          disabled={snapshot.branch === repoLink.defaultBranch && !snapshot.hasChanges && snapshot.ahead === 0}
          title="Push the current branch and open a pull request"
        />
      )}

      {linkedPrs.length > 0 && (
        <div className="mt-1">
          <div className="px-3 pb-0.5 pt-1 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
            Opened from this chat
          </div>
          {linkedPrs.map((pr) => (
            <button
              key={`${pr.fullName}#${pr.prNumber}`}
              type="button"
              onClick={() => void githubClient.openInBrowser(pr.htmlUrl)}
              className="flex w-full items-center gap-2 px-3 py-1 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
              title={pr.htmlUrl}
            >
              <span className="font-mono text-[var(--text-muted)]">#{pr.prNumber}</span>
              <span className="min-w-0 flex-1 truncate">{pr.title}</span>
            </button>
          ))}
        </div>
      )}

      <div className="my-2 border-t border-[var(--panel-border)]" aria-hidden />

      <div className="px-3 pb-1 pt-1 text-[12px] font-medium text-[var(--text-secondary)]">
        Sources
      </div>
      {sources.length === 0 ? (
        <div className="px-3 pb-2 text-[12px] text-[var(--text-muted)]">No sources yet</div>
      ) : (
        <div className="flex flex-col gap-0.5">
          {(['files', 'skills', 'memory', 'mcp', 'github'] as const).map((groupKey) => {
            const group = groups[groupKey]
            if (group.length === 0) return null
            const labels = {
              files: 'Files',
              skills: 'Skills',
              memory: 'Memory',
              mcp: 'MCP servers',
              github: 'GitHub'
            }
            return (
              <div key={groupKey}>
                <div className="px-3 pb-0.5 pt-2 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
                  {labels[groupKey]}
                </div>
                {group.map((item) => (
                  <div
                    key={item.id}
                    className="group flex items-center gap-2 px-3 py-1.5 text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                  >
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    {item.subtitle && (
                      <span className="shrink-0 truncate font-mono text-[10px] text-[var(--text-muted)]">
                        {item.subtitle}
                      </span>
                    )}
                    {item.onRemove && (
                      <button
                        type="button"
                        onClick={item.onRemove}
                        aria-label={`Remove ${item.title}`}
                        className="rounded p-0.5 text-[var(--text-muted)] opacity-0 transition-opacity hover:text-[var(--text-primary)] group-hover:opacity-100"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}

      <WorkModePopover
        open={workModeOpen}
        onClose={() => setWorkModeOpen(false)}
        anchorRef={workModeRef}
      />
      <BranchPickerPopover
        open={branchOpen}
        onClose={() => setBranchOpen(false)}
        anchorRef={branchRef}
        onChanged={() => void refresh()}
      />
      {projectId && (
        <RepositoryPickerDialog
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          projectId={projectId}
          onSelected={({ repo, localPath }) => {
            setRepoLink({
              projectId,
              repoId: repo.id,
              fullName: repo.fullName,
              owner: repo.owner,
              name: repo.name,
              defaultBranch: repo.defaultBranch,
              htmlUrl: repo.htmlUrl,
              cloneUrl: repo.cloneUrl,
              localPath,
              linkedAt: Date.now()
            })
          }}
        />
      )}
      {repoLink && (
        <PullRequestListPopover
          open={prListOpen}
          onClose={() => setPrListOpen(false)}
          anchorRef={prListRef}
          repoLink={repoLink}
        />
      )}
      {repoLink && snapshot.branch && (
        <PullRequestDialog
          open={prDialogOpen}
          onClose={() => setPrDialogOpen(false)}
          repoLink={repoLink}
          headBranch={snapshot.branch}
          cwd={snapshot.cwd || repoLink.localPath || ''}
          conversationId={activeConversationId ?? undefined}
        />
      )}
    </div>
  )
}
