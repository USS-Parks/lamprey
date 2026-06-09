import { useState, useEffect } from 'react'
import { useProjectsStore } from '@/stores/projects-store'
import { useChatStore } from '@/stores/chat-store'
import { useUiStore } from '@/stores/ui-store'
import type { Project } from '@/lib/types'

interface Props {
  projectId: string | null
  onClose: () => void
}

export function ProjectHome({ projectId, onClose }: Props) {
  const projects = useProjectsStore((s) => s.projects)
  const selectProject = useProjectsStore((s) => s.selectProject)
  const createConversation = useChatStore((s) => s.createConversation)
  const conversations = useChatStore((s) => s.conversations)
  const selectConversation = useChatStore((s) => s.selectConversation)

  const project: Project | null = projectId
    ? projects.find((p) => p.id === projectId) ?? null
    : null

  const projectConversations = conversations.filter(
    (c) => c.projectId === projectId
  )

  const [startingSession, setStartingSession] = useState(false)

  // Track lastOpenedAt via selectProject on mount
  useEffect(() => {
    if (projectId) {
      selectProject(projectId).catch(() => {})
    }
  }, [projectId, selectProject])

  // Escape to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleStartSession = async () => {
    setStartingSession(true)
    try {
      const newId = await createConversation()
      if (newId && projectId) {
        await window.api?.projects?.assignConversation(newId, projectId)
        selectConversation(newId)
        onClose()
      }
    } finally {
      setStartingSession(false)
    }
  }

  if (!project) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="w-[min(480px,92vw)] rounded-xl border border-[var(--panel-border)] bg-[var(--bg-secondary)] p-6 shadow-2xl text-center">
          <p className="text-[var(--text-secondary)]">Project not found.</p>
          <button
            onClick={onClose}
            className="mt-3 rounded-md px-4 py-2 text-[13px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
          >
            Close
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={project.name}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex w-[min(560px,92vw)] flex-col overflow-hidden rounded-xl border border-[var(--panel-border)] bg-[var(--bg-secondary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-center justify-between px-5 py-4">
          <div>
            <h2 className="text-[17px] font-semibold text-[var(--text-primary)]">
              {project.name}
            </h2>
            {project.description && (
              <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
                {project.description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>

        {/* Meta */}
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-y border-[var(--panel-border)] px-5 py-3 text-[12px] text-[var(--text-muted)]">
          {project.path && (
            <span title={project.path}>
              📁 {project.path}
            </span>
          )}
          <span>Created {new Date(project.createdAt).toLocaleDateString()}</span>
          {project.lastOpenedAt && (
            <span>Last opened {new Date(project.lastOpenedAt).toLocaleDateString()}</span>
          )}
          <span>{projectConversations.length} session{projectConversations.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Sessions */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {projectConversations.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-[var(--text-muted)]">
              No sessions yet.
              <br />
              Start a new session in this project to begin working.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {projectConversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => {
                    selectConversation(conv.id)
                    onClose()
                  }}
                  className="flex items-center gap-3 rounded-md px-3 py-2 text-left text-[14px] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                >
                  <span className="flex-1 truncate">{conv.title || 'Untitled session'}</span>
                  <span className="shrink-0 text-[12px] text-[var(--text-muted)]">
                    {conv.messageCount ?? 0}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between border-t border-[var(--panel-border)] px-5 py-3">
          <span className="text-[12px] text-[var(--text-muted)]">
            {project.slug}
          </span>
          <button
            type="button"
            onClick={handleStartSession}
            disabled={startingSession}
            className="rounded-md bg-[var(--accent-blue)] px-4 py-2 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-30"
          >
            {startingSession ? 'Starting...' : 'Start new session'}
          </button>
        </div>
      </div>
    </div>
  )
}
