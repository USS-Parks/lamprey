import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from '@/stores/toast-store'
import type {
  PermissionPolicy,
  PolicyScope
} from '@/lib/types'

// Persistent approval policies. Lists every persisted policy, grouped by
// scope. The user can delete a single row or clear an entire scope. New
// policies are written via the approval modal during normal use — this
// surface is the inspect/cleanup side of the same store.
//
// When the main process cannot reach its DB (corrupt userData, denied
// filesystem permissions, etc.) it falls back to an in-memory layer. We
// surface that fallback with a banner so the user knows their answers
// will reset on next launch and can investigate.

type ListResponse = {
  success: boolean
  data?: { policies: PermissionPolicy[]; memoryFallback: boolean }
  error?: string
}

interface PermissionsApi {
  listPolicies: () => Promise<ListResponse>
  deletePolicy: (id: string) => Promise<{ success: boolean; error?: string }>
  clearScope: (scope: PolicyScope) => Promise<{ success: boolean; error?: string }>
}

function getApi(): PermissionsApi | null {
  if (typeof window === 'undefined') return null
  const api = (window as unknown as { api?: { permissions?: PermissionsApi } }).api
  return api?.permissions ?? null
}

const SCOPE_LABEL: Record<PolicyScope, string> = {
  conversation: 'Conversation',
  workspace: 'Workspace',
  global: 'Global'
}

const SCOPE_DESCRIPTION: Record<PolicyScope, string> = {
  conversation:
    'Sticky for a single chat thread. Cleared when you delete the thread.',
  workspace: 'Sticky for one folder. Cleared when you remove the policy here.',
  global: 'Sticky across every folder. The broadest scope.'
}

function formatDecision(decision: 'allow' | 'deny'): string {
  return decision === 'allow' ? 'Allow' : 'Deny'
}

function formatSubject(p: PermissionPolicy): string {
  const prefix = p.subjectKind === 'tool' ? 'Tool' : 'Risk'
  return `${prefix}: ${p.subject}`
}

function formatScopeMeta(p: PermissionPolicy): string | null {
  if (p.scope === 'conversation' && p.conversationId) {
    return `Conversation ${p.conversationId.slice(0, 8)}…`
  }
  if (p.scope === 'workspace' && p.workspacePath) {
    return p.workspacePath
  }
  return null
}

function formatAge(epochMs: number): string {
  const delta = Date.now() - epochMs
  const day = 86_400_000
  if (delta < day) return 'today'
  const days = Math.floor(delta / day)
  if (days === 1) return '1 day ago'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  if (months === 1) return '1 month ago'
  return `${months} months ago`
}

export function PermissionsSettings() {
  const [policies, setPolicies] = useState<PermissionPolicy[]>([])
  const [memoryFallback, setMemoryFallback] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const api = getApi()
    if (!api) return
    setLoading(true)
    try {
      const response = await api.listPolicies()
      if (response.success && response.data) {
        setPolicies(response.data.policies)
        setMemoryFallback(Boolean(response.data.memoryFallback))
      } else {
        toast.error(`Failed to load policies: ${response.error ?? 'unknown error'}`)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const grouped = useMemo(() => {
    const result: Record<PolicyScope, PermissionPolicy[]> = {
      conversation: [],
      workspace: [],
      global: []
    }
    for (const p of policies) {
      result[p.scope].push(p)
    }
    for (const scope of Object.keys(result) as PolicyScope[]) {
      result[scope].sort((a, b) => b.updatedAt - a.updatedAt)
    }
    return result
  }, [policies])

  const handleDelete = async (id: string) => {
    const api = getApi()
    if (!api) return
    setBusy(id)
    try {
      const response = await api.deletePolicy(id)
      if (!response.success) {
        toast.error(`Failed to delete policy: ${response.error ?? 'unknown error'}`)
        return
      }
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  const handleClearScope = async (scope: PolicyScope) => {
    const api = getApi()
    if (!api) return
    const count = grouped[scope].length
    if (count === 0) return
    if (
      !window.confirm(
        `Remove all ${count} ${SCOPE_LABEL[scope].toLowerCase()} ${
          count === 1 ? 'policy' : 'policies'
        }? You'll be prompted again the next time the model uses these tools.`
      )
    ) {
      return
    }
    setBusy(`scope:${scope}`)
    try {
      const response = await api.clearScope(scope)
      if (!response.success) {
        toast.error(`Failed to clear scope: ${response.error ?? 'unknown error'}`)
        return
      }
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6 text-sm text-[var(--text-primary)]">
      <div>
        <h2 className="text-base font-semibold">Tool permissions</h2>
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          Approval decisions you've made stick to this list. Pick "Just this
          once" in the approval dialog to avoid persisting; pick "This
          conversation", "This workspace", or "Always" to add a row here.
        </p>
      </div>

      {memoryFallback && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
          <strong className="font-semibold">Persistence unavailable.</strong>{' '}
          Policies are being held in memory only and will reset on the next app
          launch. Check the main process log for the underlying error.
        </div>
      )}

      {loading && (
        <div className="text-xs text-[var(--text-muted)]">Loading policies…</div>
      )}

      {!loading &&
        (Object.keys(SCOPE_LABEL) as PolicyScope[]).map((scope) => {
          const rows = grouped[scope]
          const clearing = busy === `scope:${scope}`
          return (
            <section
              key={scope}
              className="rounded-lg border border-[var(--panel-border)] bg-[var(--bg-primary)] p-3"
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                    {SCOPE_LABEL[scope]}{' '}
                    <span className="ml-1 font-mono text-xs text-[var(--text-muted)]">
                      ({rows.length})
                    </span>
                  </h3>
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    {SCOPE_DESCRIPTION[scope]}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={rows.length === 0 || clearing}
                  onClick={() => handleClearScope(scope)}
                  className="shrink-0 rounded border border-[var(--panel-border)] bg-[var(--bg-tertiary)] px-2 py-1 font-mono text-[10px] uppercase text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-secondary)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {clearing ? 'Clearing…' : 'Clear all'}
                </button>
              </div>

              {rows.length === 0 ? (
                <div className="rounded border border-dashed border-[var(--panel-border)] px-3 py-4 text-center text-xs text-[var(--text-muted)]">
                  No {SCOPE_LABEL[scope].toLowerCase()} policies.
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {rows.map((policy) => {
                    const scopeMeta = formatScopeMeta(policy)
                    const isBusy = busy === policy.id
                    return (
                      <li
                        key={policy.id}
                        className="flex items-start justify-between gap-3 rounded border border-[var(--panel-border)] bg-[var(--bg-secondary)] px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                                policy.decision === 'allow'
                                  ? 'border-emerald-500/30 text-emerald-300'
                                  : 'border-red-500/40 text-red-300'
                              }`}
                            >
                              {formatDecision(policy.decision)}
                            </span>
                            <span className="truncate font-mono text-xs text-[var(--text-primary)]">
                              {formatSubject(policy)}
                            </span>
                          </div>
                          {scopeMeta && (
                            <div className="mt-1 truncate font-mono text-[10px] text-[var(--text-muted)]">
                              {scopeMeta}
                            </div>
                          )}
                          <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                            Updated {formatAge(policy.updatedAt)}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleDelete(policy.id)}
                          className="shrink-0 rounded border border-[var(--panel-border)] bg-[var(--bg-tertiary)] px-2 py-1 font-mono text-[10px] uppercase text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isBusy ? 'Removing…' : 'Delete'}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )
        })}

      <div className="rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] p-3 text-[11px] text-[var(--text-muted)]">
        Policies are matched in order: conversation, workspace, then global —
        and within a level a Deny beats an Allow. Risk policies (Network,
        Destructive, Secret) match every tool that carries the same risk, so
        one row can silence prompts across several tools.
      </div>
    </div>
  )
}
