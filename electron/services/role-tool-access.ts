/**
 * FC-8 — Role-based tool access filtering.
 *
 * Each agent pipeline role is restricted to a specific set of tools:
 *   - Planner: read-only tools + update_plan
 *   - Reviewer: read-only inspection, proof receipts, diff tools
 *   - Coder: full access (gated by plan mode and permissions)
 *
 * Tool capabilities are derived from descriptor metadata (risks, mutates,
 * parallelizable). When metadata is insufficient, explicit per-role
 * allowlists provide a tested fallback.
 */

import type { LampreyToolDescriptor } from './tool-registry'

export type PipelineRole = 'planner' | 'coder' | 'reviewer'

/**
 * Tools explicitly allowed for the Planner role (read-only + plan management).
 */
const PLANNER_TOOLS = new Set([
  'workspace_context',
  'view_image',
  'read_thread_terminal',
  'load_workspace_dependencies',
  'shell_list',
  'shell_monitor',
  'shell_output',
  'browser_get_current_tab',
  'browser_evaluate_readonly',
  'browser_find',
  'browser_screenshot',
  'web_search',
  'web_open',
  'web_find',
  'image_search',
  'time_lookup',
  'finance_quote',
  'weather_lookup',
  'sports_lookup',
  'frontend_qa',
  'update_plan',
  'get_goal',
  'create_goal',
  'update_goal',
  'mark_chapter',
  'ask_user_question',
  'create_document',
  'memory_add'
])

/**
 * Tools explicitly allowed for the Reviewer role (read-only inspection +
 * proof receipts + diff tools).
 */
const REVIEWER_TOOLS = new Set([
  'workspace_context',
  'view_image',
  'read_thread_terminal',
  'shell_list',
  'shell_monitor',
  'shell_output',
  'browser_get_current_tab',
  'browser_evaluate_readonly',
  'browser_find',
  'browser_screenshot',
  'web_search',
  'web_open',
  'web_find',
  'image_search',
  'time_lookup',
  'frontend_qa',
  'create_document',
  'get_goal'
])

/**
 * Filter tool descriptors for a given pipeline role.
 *
 * Planner: read-only (mutates: false) tools + update_plan / goal management.
 * Reviewer: read-only inspection, proof receipts, diff tools.
 * Coder: all tools (full access, gated by plan mode + permissions).
 */
export function filterToolsForRole(
  descriptors: LampreyToolDescriptor[],
  role: PipelineRole
): LampreyToolDescriptor[] {
  switch (role) {
    case 'planner':
      return descriptors.filter((d) => {
        // Explicit allowlist takes priority when metadata is absent
        if (d.mutates === undefined && d.risks.length === 0) {
          return PLANNER_TOOLS.has(d.name)
        }
        // Read-only tools (mutates: false) + plan management
        if (d.mutates === false) return true
        // Explicitly allowed write tools for planner
        return PLANNER_TOOLS.has(d.name)
      })

    case 'reviewer':
      return descriptors.filter((d) => {
        if (d.mutates === undefined && d.risks.length === 0) {
          return REVIEWER_TOOLS.has(d.name)
        }
        if (d.mutates === false) return true
        return REVIEWER_TOOLS.has(d.name)
      })

    case 'coder':
      // Coder gets everything — plan mode and permissions gate at dispatch
      return descriptors

    default:
      return descriptors
  }
}
