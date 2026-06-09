import { useState, useEffect, useRef, type FormEvent } from 'react'
import { useProjectsStore } from '@/stores/projects-store'
import { validateCreateProjectInput } from '@/lib/projects'
import { toast } from '@/stores/toast-store'

interface Props {
  open: boolean
  onClose: () => void
}

export function NewProjectModal({ open, onClose }: Props) {
  const nameRef = useRef<HTMLInputElement>(null)
  const projects = useProjectsStore((s) => s.projects)
  const createProject = useProjectsStore((s) => s.createProject)

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [path, setPath] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  // Reset form on open
  useEffect(() => {
    if (open) {
      setName('')
      setDescription('')
      setPath('')
      setErrors([])
      setSubmitting(false)
      // Autofocus after a tick for modal transition
      setTimeout(() => nameRef.current?.focus(), 50)
    }
  }, [open])

  // Escape to close
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        if (!submitting) onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, submitting])

  const validate = (): boolean => {
    const result = validateCreateProjectInput({ name, path: path || null }, projects)
    setErrors(result.errors)
    return result.valid
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    setSubmitting(true)
    setErrors([])
    try {
      const project = await createProject(name.trim(), path.trim() || null, description.trim() || null)
      if (project) {
        toast.success(`Project "${project.name}" created`)
        onClose()
      } else {
        setErrors(['Failed to create project. Please try again.'])
      }
    } catch {
      setErrors(['An unexpected error occurred.'])
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="New project"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={submitting ? undefined : onClose}
    >
      <div
        className="relative flex w-[min(480px,92vw)] flex-col overflow-hidden rounded-xl border border-[var(--panel-border)] bg-[var(--bg-secondary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3">
          <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
            New Project
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close"
            className="rounded-md p-1 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-30"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-4 py-2">
          {/* Errors */}
          {errors.length > 0 && (
            <div
              role="alert"
              aria-live="polite"
              className="rounded-md border border-[var(--accent-red)]/40 bg-[var(--accent-red)]/10 px-3 py-2 text-[13px] text-[var(--accent-red)]"
            >
              {errors.map((err, i) => (
                <p key={i}>{err}</p>
              ))}
            </div>
          )}

          {/* Name */}
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[var(--text-secondary)]">
              Project name <span className="text-[var(--accent-red)]">*</span>
            </span>
            <input
              ref={nameRef}
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setErrors([]) }}
              placeholder="My Project"
              maxLength={128}
              className="rounded-md border border-[var(--panel-border)] bg-[var(--bg-primary)] px-3 py-2 text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none"
            />
          </label>

          {/* Description */}
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[var(--text-secondary)]">
              Description
            </span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              rows={2}
              className="resize-none rounded-md border border-[var(--panel-border)] bg-[var(--bg-primary)] px-3 py-2 text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none"
            />
          </label>

          {/* Path */}
          <label className="flex flex-col gap-1">
            <span className="text-[12px] font-medium text-[var(--text-secondary)]">
              Local path
            </span>
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="C:\Users\..."
              className="rounded-md border border-[var(--panel-border)] bg-[var(--bg-primary)] px-3 py-2 text-[14px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none"
            />
          </label>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 border-t border-[var(--panel-border)] py-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-md px-4 py-2 text-[13px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] disabled:opacity-30"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !name.trim()}
              className="rounded-md bg-[var(--accent-blue)] px-4 py-2 text-[13px] font-medium text-white transition-colors hover:brightness-110 disabled:opacity-30"
            >
              {submitting ? 'Creating...' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
