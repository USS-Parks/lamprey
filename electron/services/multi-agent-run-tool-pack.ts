import { chatOnce } from './providers/registry'
import { toolRegistry } from './tool-registry'
import {
  classifyMultiAgentRunResult,
  executeMultiAgentRun,
  validateMultiAgentArgs,
  MULTI_AGENT_DEFAULT_TIMEOUT_MS,
  MULTI_AGENT_MAX_CONTEXT_BYTES,
  MULTI_AGENT_MAX_TASKS,
  MULTI_AGENT_TOOL_ID,
  type MultiAgentRunResult
} from './multi-agent-run-tool'

// Native primitive: fan the active model into role-prompted sub-agents.
// Each sub-agent gets one chat turn against the supplied bounded context;
// outputs come back as a structured envelope the main assistant synthesises.
// No nested fan-out; no tool use inside the sub-agents. See
// PLANNING/CODEX_TOOLSET_PARITY_PROGRESS.md "Prompt 11" for the rationale.
toolRegistry.registerNative(
  {
    id: MULTI_AGENT_TOOL_ID,
    name: MULTI_AGENT_TOOL_ID,
    title: 'Multi-agent run',
    description:
      'Fan the active model into 1–5 role-prompted sub-agents (planner / reader / verifier / ' +
      'reviewer / coworker). Each sub-agent reasons only on the supplied bounded context — ' +
      'no tool use, no nested fan-out, ≤32 KB context per task, 60s default per-task timeout. ' +
      'Returns a JSON envelope: { results: [{role, output, error?, elapsedMs, ' +
      'tokensUsedEstimate?, callId}], totalElapsedMs, synthesisNotes }. Use for parallel ' +
      'planning + verification when the work decomposes cleanly into independent role-shaped ' +
      'sub-tasks. The main chat stream is not split; the run surfaces as one compact card.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: `1–${MULTI_AGENT_MAX_TASKS} sub-tasks to fan out.`,
          minItems: 1,
          maxItems: MULTI_AGENT_MAX_TASKS,
          items: {
            type: 'object',
            properties: {
              role: {
                type: 'string',
                enum: ['planner', 'reader', 'verifier', 'reviewer', 'coworker'],
                description: 'Role-prompt template applied to this sub-agent.'
              },
              prompt: {
                type: 'string',
                description: 'Role-specific user prompt for this sub-agent.'
              },
              context: {
                type: 'string',
                description: `Bounded context payload (≤${MULTI_AGENT_MAX_CONTEXT_BYTES} bytes UTF-8).`
              },
              outputFormat: {
                type: 'string',
                description: 'Optional explicit output-format requirements (free text).'
              }
            },
            required: ['role', 'prompt', 'context']
          }
        },
        timeoutMs: {
          type: 'number',
          description: `Per-sub-agent timeout. Default ${MULTI_AGENT_DEFAULT_TIMEOUT_MS} ms.`
        }
      },
      required: ['tasks']
    },
    // Network because the sub-agents call out to the provider. No write,
    // destructive, or secret risks — sub-agents do not touch the workspace
    // or any local state. Parallelism inside the executor handles the fan-
    // out; the dispatcher should not also try to parallelize the outer
    // call.
    risks: ['network', 'read'],
    requiresApproval: false,
    enabled: true
  },
  async (rawArgs, ctx) => {
    const args = validateMultiAgentArgs(rawArgs)
    if (!ctx.model) {
      throw new Error(
        'multi_agent_run: active chat model is not available in tool context (internal error).'
      )
    }
    const parentCallId = ctx.callId
    const result: MultiAgentRunResult = await executeMultiAgentRun({
      args,
      defaultModel: ctx.model,
      parentSignal: ctx.signal,
      parentCallId,
      runner: (messages, modelId, signal) => chatOnce(messages, modelId, signal)
    })

    // Persist a synthetic audit row per sub-agent, linked back to the
    // multi_agent_run call that spawned it. Sub-agents are not OpenAI
    // tool_calls, so the normal chat loop never sees them — these rows are
    // the only way they reach the audit log.
    if (parentCallId) {
      for (let i = 0; i < result.results.length; i++) {
        const r = result.results[i]
        const startedAt = Date.now() - r.elapsedMs
        toolRegistry.recordCallStart(
          {
            id: r.callId,
            toolId: `${MULTI_AGENT_TOOL_ID}:${r.role}`,
            name: `${MULTI_AGENT_TOOL_ID}:${r.role}`,
            conversationId: ctx.conversationId,
            args: { role: r.role, taskIndex: i },
            startedAt,
            status: 'running',
            parentCallId
          },
          ctx.correlationId
        )
        const auditStatus = r.error ? 'error' : 'done'
        toolRegistry.recordCallEnd(r.callId, {
          status: auditStatus,
          result: auditStatus === 'error' ? undefined : r.output ?? undefined,
          error: r.error,
          finishedAt: startedAt + r.elapsedMs,
          parentCallId,
          correlationId: ctx.correlationId
        })
      }
    }

    return {
      result: JSON.stringify(result, null, 2),
      status: classifyMultiAgentRunResult(result)
    }
  }
)
