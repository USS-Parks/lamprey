// Fluidity J2: pure cycle helper for the Shift+Tab permission/plan rotation.
//
// The visible cycle is a single sequence of four slots:
//   default → auto-review → full → plan → default
//
// PermissionsMode and planMode live in separate fields on ui-store so the
// existing dropdown + banner code keeps working unchanged. The cycle just
// projects a virtual slot from (permissions, plan) and back.

export type PermissionsMode = 'default' | 'auto-review' | 'full'
export type ModeSlot = PermissionsMode | 'plan'

export interface ModeState {
  permissions: PermissionsMode
  plan: boolean
}

export const MODE_CYCLE: readonly ModeSlot[] = [
  'default',
  'auto-review',
  'full',
  'plan'
]

/** plan=true masks whatever permission mode is set; otherwise the permission
 *  itself names the slot. Keeping it derived (not stored) avoids two sources
 *  of truth — the dropdown can change permissions without touching the cycle. */
export function currentSlot(state: ModeState): ModeSlot {
  return state.plan ? 'plan' : state.permissions
}

export function nextMode(state: ModeState): ModeState {
  const cur = currentSlot(state)
  const idx = MODE_CYCLE.indexOf(cur)
  // If somehow we're not in the cycle (shouldn't happen — both fields are
  // typed), fall through to slot 0.
  const nextSlot = MODE_CYCLE[(idx === -1 ? 0 : idx + 1) % MODE_CYCLE.length]
  if (nextSlot === 'plan') {
    // Entering plan keeps the prior permission selection so leaving plan
    // returns to the user's familiar pre-plan permissions slot via the next
    // Shift+Tab → default (the cycle is a loop, not a reversible history).
    return { permissions: state.permissions, plan: true }
  }
  return { permissions: nextSlot, plan: false }
}

export function slotLabel(slot: ModeSlot): string {
  switch (slot) {
    case 'default':
      return 'Default permissions'
    case 'auto-review':
      return 'Auto-review'
    case 'full':
      return 'Full access'
    case 'plan':
      return 'Plan mode'
  }
}
