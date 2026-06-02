// Legacy-fallback classifier for tool result strings. Used only when the
// dispatch path can't deliver an explicit status — primarily MCP tool
// returns (the MCP SDK ships errors as exceptions or as result fields the
// chat loop already maps to 'Error:' strings) and the few native paths
// that still return plain strings instead of the structured envelope.
//
// Native handlers should prefer either throwing on failure or returning
// `{ result, status }` from tool-registry.ts — both routes set the audit
// status without going through this heuristic.

export type AuditStatus = 'done' | 'error' | 'denied'

export function classifyToolResult(result: string): AuditStatus {
  if (result === 'Action denied by user.') return 'denied'
  if (result.startsWith('Error:')) return 'error'
  if (result.startsWith('Unknown tool:')) return 'error'
  return 'done'
}
