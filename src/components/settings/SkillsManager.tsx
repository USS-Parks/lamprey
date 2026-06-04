import { useEffect, useMemo, useState } from 'react'
import type { Skill } from '@/lib/types'
import { toast } from '@/stores/toast-store'
import { useSkillsStore } from '@/stores/skills-store'

interface SkillDraft {
  name: string
  description: string
  content: string
}

interface ParsedSkill extends SkillDraft {
  source: 'frontmatter' | 'plain'
}

function validateSkillDraft(draft: SkillDraft): string[] {
  const errors: string[] = []
  if (!draft.name.trim()) errors.push('name is required')
  if (!draft.description.trim()) errors.push('description is required')
  if (!draft.content.trim()) errors.push('content is required')
  if (draft.name.length > 80) errors.push('name should stay under 80 characters')
  if (draft.description.length > 240) errors.push('description should stay under 240 characters')
  return errors
}

function parseFrontmatterValue(line: string): string {
  return line
    .replace(/^['"]|['"]$/g, '')
    .replace(/\\n/g, '\n')
    .trim()
}

function parseSkillMarkdown(raw: string, fallbackName: string): ParsedSkill {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('---')) {
    return {
      name: fallbackName,
      description: '',
      content: trimmed,
      source: 'plain'
    }
  }

  const end = trimmed.indexOf('\n---', 3)
  if (end === -1) {
    return {
      name: fallbackName,
      description: '',
      content: trimmed,
      source: 'plain'
    }
  }

  const frontmatter = trimmed.slice(3, end).split(/\r?\n/)
  const data: Record<string, string> = {}
  for (const line of frontmatter) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (match) data[match[1]] = parseFrontmatterValue(match[2])
  }

  return {
    name: data.name || fallbackName,
    description: data.description || '',
    content: trimmed.slice(end + 4).trim(),
    source: 'frontmatter'
  }
}

function fallbackNameFromUrl(value: string): string {
  try {
    const url = new URL(value)
    const last = url.pathname.split('/').filter(Boolean).pop() ?? 'Imported skill'
    return last.replace(/\.md$/i, '').replace(/[-_]+/g, ' ') || 'Imported skill'
  } catch {
    return 'Imported skill'
  }
}

function validateImportUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return 'URL must start with http or https'
    }
    return null
  } catch {
    return 'Enter a valid URL'
  }
}

function formatTime(timestamp: number | null): string {
  if (!timestamp) return 'not yet'
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

export function SkillsManager() {
  const skills = useSkillsStore((s) => s.skills)
  const activeSkillIds = useSkillsStore((s) => s.activeSkillIds)
  const loadSkills = useSkillsStore((s) => s.loadSkills)
  const setSkillsFromEvent = useSkillsStore((s) => s.setSkillsFromEvent)
  const toggleSkill = useSkillsStore((s) => s.toggleSkill)
  const createSkill = useSkillsStore((s) => s.createSkill)
  const updateSkill = useSkillsStore((s) => s.updateSkill)
  const deleteSkill = useSkillsStore((s) => s.deleteSkill)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<SkillDraft>({ name: '', description: '', content: '' })
  const [importUrl, setImportUrl] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [reloadCount, setReloadCount] = useState(0)
  const [lastReloadAt, setLastReloadAt] = useState<number | null>(null)
  const [dryRunVisible, setDryRunVisible] = useState(false)

  useEffect(() => {
    void loadSkills()
  }, [loadSkills])

  useEffect(() => {
    const dispose = window.api.skills.onChanged((rows) => {
      setSkillsFromEvent(rows as Skill[])
      setReloadCount((count) => count + 1)
      setLastReloadAt(Date.now())
    }) as unknown
    return () => {
      if (typeof dispose === 'function') dispose()
    }
  }, [setSkillsFromEvent])

  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.id === selectedId) ?? skills[0] ?? null,
    [selectedId, skills]
  )

  useEffect(() => {
    if (!selectedSkill) {
      setDraft({ name: '', description: '', content: '' })
      return
    }
    setSelectedId(selectedSkill.id)
    setDraft({
      name: selectedSkill.name,
      description: selectedSkill.description,
      content: selectedSkill.content
    })
  }, [selectedSkill?.id])

  const validationErrors = useMemo(() => validateSkillDraft(draft), [draft])
  const importUrlError = importUrl.trim() ? validateImportUrl(importUrl.trim()) : null

  const dryRunText = `<skill name="${draft.name || 'Untitled'}">\n${draft.content || '(empty)'}\n</skill>`

  const saveSelected = async () => {
    if (!selectedSkill) return
    if (validationErrors.length) {
      toast.error(validationErrors[0])
      return
    }
    await updateSkill(selectedSkill.id, draft)
    toast.success(`Skill "${draft.name}" saved`)
  }

  const importFromUrl = async () => {
    const value = importUrl.trim()
    const urlError = validateImportUrl(value)
    if (urlError) {
      setImportMessage(urlError)
      return
    }

    setImportBusy(true)
    setImportMessage(null)
    try {
      const response = await fetch(value)
      if (!response.ok) throw new Error(`Fetch failed: ${response.status}`)
      const text = await response.text()
      const parsed = parseSkillMarkdown(text, fallbackNameFromUrl(value))
      const errors = validateSkillDraft(parsed)
      if (errors.length) {
        setImportMessage(`Invalid skill: ${errors.join(', ')}`)
        return
      }
      await createSkill({
        name: parsed.name.trim(),
        description: parsed.description.trim(),
        content: parsed.content
      })
      setImportMessage(
        parsed.source === 'frontmatter'
          ? 'Imported skill from URL frontmatter'
          : 'Imported skill; add a description before relying on it'
      )
      setImportUrl('')
      await loadSkills()
    } catch (error) {
      setImportMessage((error as Error).message)
    } finally {
      setImportBusy(false)
    }
  }

  const deleteSelected = async () => {
    if (!selectedSkill) return
    if (!confirm(`Delete skill "${selectedSkill.name}"?`)) return
    await deleteSkill(selectedSkill.id)
    setSelectedId(null)
  }

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-[14px] font-medium text-[var(--text-primary)]">Skills</h2>
        <p className="mt-1 text-[12px] text-[var(--text-muted)]">
          Manage local skill markdown, validate required frontmatter, preview the system-prompt
          block, and import marketplace-style skill URLs.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded border border-[var(--border)] bg-[var(--bg-primary)] px-3 py-2 text-[11px]">
        <span className="rounded bg-[var(--bg-secondary)] px-2 py-1 text-[var(--text-primary)]">
          hot reload: {reloadCount} events
        </span>
        <span className="text-[var(--text-muted)]">last change {formatTime(lastReloadAt)}</span>
        <button
          onClick={() => void loadSkills()}
          className="ml-auto rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 hover:border-[var(--accent)]"
        >
          Refresh
        </button>
      </div>

      <div className="rounded border border-[var(--border)] bg-[var(--bg-primary)] p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
            Marketplace import URL
          </span>
          {importUrlError && (
            <span className="text-[11px] text-[var(--error)]">{importUrlError}</span>
          )}
        </div>
        <div className="flex gap-2">
          <input
            value={importUrl}
            onChange={(event) => {
              setImportUrl(event.target.value)
              setImportMessage(null)
            }}
            placeholder="https://example.com/skills/reviewer.md"
            className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1.5 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={() => void importFromUrl()}
            disabled={importBusy || Boolean(importUrlError) || !importUrl.trim()}
            className="rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1 text-[12px] hover:border-[var(--accent)] disabled:opacity-50"
          >
            {importBusy ? 'Importing...' : 'Import'}
          </button>
        </div>
        {importMessage && (
          <p className="mt-2 text-[11px] text-[var(--text-muted)]">{importMessage}</p>
        )}
      </div>

      <div className="grid grid-cols-[240px_1fr] gap-3">
        <div className="rounded border border-[var(--border)] bg-[var(--bg-primary)]">
          <div className="border-b border-[var(--border)] px-2 py-1.5 text-[11px] uppercase tracking-wider text-[var(--text-muted)]">
            Local skills ({skills.length})
          </div>
          <div className="max-h-[360px] overflow-y-auto p-1">
            {skills.length === 0 && (
              <div className="px-2 py-3 text-[11px] text-[var(--text-muted)]">
                No skills installed yet.
              </div>
            )}
            {skills.map((skill) => {
              const selected = skill.id === selectedSkill?.id
              const active = activeSkillIds.includes(skill.id)
              return (
                <button
                  key={skill.id}
                  onClick={() => setSelectedId(skill.id)}
                  className={
                    'mb-1 block w-full rounded px-2 py-1.5 text-left text-[12px] ' +
                    (selected
                      ? 'bg-[var(--bg-secondary)] ring-1 ring-[var(--accent)]'
                      : 'hover:bg-[var(--bg-secondary)]')
                  }
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-medium">{skill.name}</span>
                    {active && (
                      <span className="rounded bg-[var(--accent)] px-1.5 py-0.5 text-[9px] uppercase text-white">
                        on
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block truncate text-[10px] text-[var(--text-muted)]">
                    {skill.description || 'No description'}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="rounded border border-[var(--border)] bg-[var(--bg-primary)] p-3">
          {!selectedSkill ? (
            <div className="text-[12px] text-[var(--text-muted)]">Select a skill to manage.</div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--text-muted)]">
                  {selectedSkill.filePath}
                </span>
                <button
                  onClick={() => toggleSkill(selectedSkill.id)}
                  className="rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 text-[11px] hover:border-[var(--accent)]"
                >
                  {activeSkillIds.includes(selectedSkill.id) ? 'Disable' : 'Enable'}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-[11px] text-[var(--text-muted)]">
                  Name
                  <input
                    value={draft.name}
                    onChange={(event) =>
                      setDraft((state) => ({ ...state, name: event.target.value }))
                    }
                    className="rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                  />
                </label>
                <label className="flex flex-col gap-1 text-[11px] text-[var(--text-muted)]">
                  Description
                  <input
                    value={draft.description}
                    onChange={(event) =>
                      setDraft((state) => ({ ...state, description: event.target.value }))
                    }
                    className="rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                  />
                </label>
              </div>

              <label className="block text-[11px] text-[var(--text-muted)]">
                Content
                <textarea
                  value={draft.content}
                  onChange={(event) =>
                    setDraft((state) => ({ ...state, content: event.target.value }))
                  }
                  spellCheck={false}
                  className="mt-1 h-[160px] w-full resize-y rounded border border-[var(--border)] bg-[var(--bg-secondary)] p-2 font-mono text-[12px] leading-relaxed text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                />
              </label>

              <div
                className={
                  'rounded border px-2 py-1.5 text-[11px] ' +
                  (validationErrors.length
                    ? 'border-[var(--error)] bg-[var(--error)]/10 text-[var(--error)]'
                    : 'border-[var(--success)] bg-[var(--success)]/10 text-[var(--success)]')
                }
              >
                {validationErrors.length
                  ? `Frontmatter check: ${validationErrors.join(', ')}`
                  : 'Frontmatter check: name, description, and content are present'}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => void saveSelected()}
                  disabled={validationErrors.length > 0}
                  className="rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1 text-[12px] hover:border-[var(--accent)] disabled:opacity-50"
                >
                  Save
                </button>
                <button
                  onClick={() => setDryRunVisible((value) => !value)}
                  className="rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1 text-[12px] hover:border-[var(--accent)]"
                >
                  Dry-run
                </button>
                <button
                  onClick={() => void deleteSelected()}
                  className="ml-auto rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-3 py-1 text-[12px] text-[var(--error)] hover:border-[var(--error)]"
                >
                  Delete
                </button>
              </div>

              {dryRunVisible && (
                <pre className="max-h-52 overflow-auto rounded border border-[var(--border)] bg-[var(--bg-secondary)] p-2 font-mono text-[11px] leading-relaxed text-[var(--text-muted)] whitespace-pre-wrap">
                  {dryRunText}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
