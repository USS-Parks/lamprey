import { classifyToolResult, type AuditStatus } from './tool-result-status'
import type { NativeToolHandlerResult } from './tool-registry'

export interface NativeDispatchResult {
  result: string
  status: AuditStatus
}

/**
 * Run a native tool handler and resolve to the audit-ready `{ result, status }`.
 *
 * Three input shapes are handled:
 *   - thrown Error → status='error', result='Error: <message>'
 *   - structured envelope `{ result, status }` → status carried through
 *   - plain string return → status from {@link classifyToolResult}
 *
 * This is the single seam where a native tool's failure becomes an audit
 * 'error' row. Keeping it here lets chat.ts focus on the tool-loop
 * bookkeeping (audit log writes, IPC emits) and gives the
 * throw→`Error:`→status='error' chain a unit-testable unit without
 * standing up the full chat IPC harness.
 */
export async function dispatchNativeTool(
  handler: () => Promise<NativeToolHandlerResult>
): Promise<NativeDispatchResult> {
  try {
    const raw = await handler()
    if (typeof raw === 'string') {
      return { result: raw, status: classifyToolResult(raw) }
    }
    return { result: raw.result, status: raw.status }
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message || err.name || 'unknown error'
        : typeof err === 'string'
          ? err
          : String(err)
    return { result: `Error: ${message}`, status: 'error' }
  }
}
