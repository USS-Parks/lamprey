import { useSettingsStore } from '@/stores/settings-store'

// Reasoning Audit Phase R9 — settings surface for the one user-facing
// knob this phase introduced: `includePastReasoningInContext`. The rest
// of the phase (Planner row save, Reviewer reasoning save, composer
// trail concat, MessageBubble stage chip + Planner-trace toggle) is
// always-on by design — there's nothing to expose there.
//
// The toggle trades context tokens for audit continuity. When ON,
// every assistant row's persisted `reasoning` column is fed back into
// the API as a leading `<think>…</think>` block on the next turn, so
// the model can see its own past chain-of-thought. When OFF, the
// behaviour matches the pre-phase shape exactly.

export function ReasoningAuditSettings() {
  const settings = useSettingsStore((s) => s.settings)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  const enabled = settings.includePastReasoningInContext ?? true

  return (
    <div className="space-y-5">
      <h3 className="font-mono text-sm font-semibold text-[var(--text-primary)]">
        Reasoning audit
      </h3>
      <p className="text-xs leading-relaxed text-[var(--text-muted)]">
        Every assistant turn's chain-of-thought is persisted alongside the
        visible reply — for the Planner, Coder, Reviewer, and Composer rows
        of every multi-agent pipeline, plus single-agent turns that use a
        thinking model. The full audit trail is always available in the chat
        history (Reviewer + Composer bubbles carry their own reasoning pills;
        the Planner trace lives behind the "Show pipeline trace" toggle on
        the Coder bubble below it).
      </p>

      <label
        htmlFor="includePastReasoning"
        className="flex cursor-pointer flex-col gap-2 rounded border border-[var(--border)] bg-[var(--bg-primary)] p-4 text-xs text-[var(--text-secondary)]"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-medium text-[var(--text-primary)]">
            Include past reasoning in API context
          </span>
          <input
            id="includePastReasoning"
            type="checkbox"
            checked={enabled}
            onChange={(e) =>
              void updateSettings({ includePastReasoningInContext: e.target.checked })
            }
            className="h-4 w-4 cursor-pointer accent-[var(--accent)]"
          />
        </div>
        <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
          When on (default), each past assistant row's saved reasoning is
          re-fed into the next turn's API request as a leading{' '}
          <code className="rounded bg-[var(--code-bg)] px-1 py-[1px] font-mono">
            &lt;think&gt;…&lt;/think&gt;
          </code>{' '}
          block so the model can audit its own prior chain-of-thought. Trade-off:
          each rehydrated block inflates context tokens. If a long conversation
          hits a model's context limit, flip this off — the on-disk audit trail
          stays intact, only the live API stack stops carrying past reasoning.
        </p>
      </label>
    </div>
  )
}
