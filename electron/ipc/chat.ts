import { ipcMain, app } from 'electron'
import { randomUUID } from 'crypto'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import {
  chatOnce,
  chatStream,
  getProviderForModel,
  resolveModel,
  type ModelRequestAudit,
  type ProviderId
} from '../services/providers/registry'
import { boundedJsonPreview, recordEvent } from '../services/event-log'
import { validateChatSendRequest } from './chat-validation'
import * as convStore from '../services/conversation-store'
import {
  isPlanModeActive,
  setPlanModeActive,
  type StoredDocument
} from '../services/conversation-store'
import * as memStore from '../services/memory-store'
import { buildChaptersBlock, createChapter } from '../services/chapters-store'
import {
  compressOldestMessages,
  getEffectiveMessages
} from '../services/context-compressor'
import {
  buildTaskNotificationsBlock,
  drainAsyncEventsForPrompt
} from '../services/async-event-bridge'
import { buildSystemPrompt } from '../services/system-prompt-builder'
import { resolveAgentDispatch, runAgentPipeline } from '../services/agent-pipeline'
import { readAgentsMd } from '../services/agents-md-loader'
import { fireHooks } from '../services/hooks-runner'
import { mcpManager } from '../services/mcp-manager'
import { listSkills, getSkillContent } from '../services/skill-loader'
import { buildApiMessagesFromStoredMessages } from '../services/chat-history'
import { toolRegistry, isMutatingDescriptor } from '../services/tool-registry'
import { TOOL_SEARCH_TOOL_NAME } from '../services/model-tool-surface'
import {
  activateLazySurface,
  isLazyActive,
  isSurfaceDowngraded,
  unlockTools,
  getUnlockedTools,
  recordMalformedSearch
} from '../services/tool-unlock-state'
import {
  maybeSpillToolResult,
  DEFAULT_SPILL_THRESHOLD
} from '../services/tool-result-spill'
import {
  setProofRigor,
  isProofRigorActive,
  resolveProofRigor
} from '../services/proof-rigor'
import {
  partitionToolCallWindows,
  type ProviderToolCall
} from '../services/tool-call-windowing'
import { permissionsService, descriptorNeedsApproval } from '../services/permissions-store'
import { inferPhaseFromDescriptor, type AgentRunPhase } from '../services/agent-run-phase'
import { getActiveWorkspace } from '../services/workspace-state'
import { classifyToolResult } from '../services/tool-result-status'
import { validateToolArguments } from '../services/tool-schema-validator'
import { parseFallbackToolCalls } from '../services/fallback-tool-parser'
import { recordCapabilityCheck, isDowngraded } from '../services/providers/capability-tracker'
import { dispatchNativeTool } from '../services/native-dispatch'
import { emitChatEvent } from '../services/chat-events'
import { readDeepResearchSettings } from '../services/research/adapter-cascade'
import { trace } from '../services/debug-trace'
import { routeChatTurn } from '../services/research/intent'
import {
  runDeepResearch,
  FabricatedCitationError,
  DeepResearchCancelledError,
  NoSourcesError
} from '../services/research'
import {
  composeFinalResponse,
  concatReasoningTrail,
  shouldComposeFinalResponse,
  summarizeRun
} from '../services/final-response-composer'
import { evaluateProofGate, proofGateNotice } from '../services/proof-gate'
import { listProofReceipts } from '../services/proof-receipts'
import {
  listChangeContracts,
  synthesizeImplicitChangeContract
} from '../services/change-contract-store'
import { getPlanSnapshot } from '../services/plan-goal-store'
import { getAskUserRuntime } from '../services/ask-user-runtime'
import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions'

interface ModelParams {
  temperature?: number
  topP?: number
  maxTokens?: number | null
}

type AgenticComposerMode = 'auto' | 'always' | 'never'

interface AgenticCodingConfig {
  mode: boolean
  skills: string[]
  composer: AgenticComposerMode
}

function readSettingsJson(): Record<string, unknown> | null {
  try {
    const path = join(app.getPath('userData'), 'settings.json')
    if (!existsSync(path)) return null
    return JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function loadModelConfig(
  raw: Record<string, unknown> | null,
  model: string
): { params: ModelParams; systemPromptOverride?: string } {
  if (!raw) return { params: {} }
  const cfg = (raw.modelConfig as Record<string, Record<string, unknown>> | undefined)?.[model]
  if (!cfg) return { params: {} }
  return {
    params: {
      temperature: typeof cfg.temperature === 'number' ? cfg.temperature : undefined,
      topP: typeof cfg.topP === 'number' ? cfg.topP : undefined,
      maxTokens:
        typeof cfg.maxTokens === 'number'
          ? cfg.maxTokens
          : cfg.maxTokens === null
          ? null
          : undefined
    },
    systemPromptOverride:
      typeof cfg.systemPromptOverride === 'string' ? cfg.systemPromptOverride : undefined
  }
}

const DEFAULT_AGENTIC_SKILLS = ['plan', 'context', 'verify'] as const

function loadAgenticCodingConfig(raw: Record<string, unknown> | null): AgenticCodingConfig {
  const off: AgenticCodingConfig = {
    mode: false,
    skills: [...DEFAULT_AGENTIC_SKILLS],
    composer: 'auto'
  }
  if (!raw) return off
  const mode = raw.agenticCodingMode === true
  const rawSkills = Array.isArray(raw.agenticCodingSkills)
    ? (raw.agenticCodingSkills as unknown[]).filter((s): s is string => typeof s === 'string')
    : [...DEFAULT_AGENTIC_SKILLS]
  const composerRaw = raw.agenticCodingComposer
  const composer: AgenticComposerMode =
    composerRaw === 'always' || composerRaw === 'never' ? composerRaw : 'auto'
  return { mode, skills: rawSkills, composer }
}

// Idempotent union: preserves order of `base`, then appends ids from `extra`
// that aren't already present. Used to merge auto-activated agentic skills
// into the request's activeSkillIds without duplicating user-picked entries.
export function mergeAgenticSkillIds(base: string[], extra: string[]): string[] {
  const seen = new Set(base)
  const out = [...base]
  for (const id of extra) {
    if (id && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

// Composer gate honoring agentic coding settings. 'auto' keeps the
// pre-Prompt-14 behavior (compose only when at least one tool round ran);
// 'always' composes on pure-chat turns too; 'never' skips entirely.
export function resolveComposerGate(mode: AgenticComposerMode, round: number): boolean {
  if (mode === 'never') return false
  if (mode === 'always') return true
  return shouldComposeFinalResponse(round)
}

// A chat turn's runtime context. `chat:send` opens the entry, `chat:cancel`
// reads it to find the correlationId for the chat.cancelled event, and the
// catch in chat:send tears it down. The correlationId is generated here and
// threaded through every downstream producer.
interface ActiveRun {
  controller: AbortController
  correlationId: string
  startedAt: number
}
const activeAbortControllers = new Map<string, ActiveRun>()

// Documents the model emits via `create_document` during a single chat:send
// turn. Keyed by correlationId so the buffer is stable across the recursive
// runChatRound calls and isolated between concurrent turns (parallel agent
// pipeline). The final-message branch in runChatRound drains the buffer when
// it persists the assistant row; the catch block in chat:send clears it on
// failure so a partial run does not leak into the next turn.
const pendingDocuments = new Map<string, StoredDocument[]>()

const CREATE_DOCUMENT_MAX_BYTES = 256 * 1024

function pushPendingDocument(correlationId: string | undefined, doc: StoredDocument): void {
  if (!correlationId) return
  const list = pendingDocuments.get(correlationId)
  if (list) {
    list.push(doc)
  } else {
    pendingDocuments.set(correlationId, [doc])
  }
}

function drainPendingDocuments(correlationId: string | undefined): StoredDocument[] | undefined {
  if (!correlationId) return undefined
  const list = pendingDocuments.get(correlationId)
  if (!list || list.length === 0) {
    pendingDocuments.delete(correlationId)
    return undefined
  }
  pendingDocuments.delete(correlationId)
  return list
}

// Tool definitions (memory_add + MCP tools) come from toolRegistry.
// Approval gating is owned by permissionsService — both live in services/.

// Per-stage tool-call iteration ceiling. Each runChatRound recursive call
// increments `round`; we hard-stop when the counter exceeds this. The cap
// is PER-STAGE (multi-agent pipelines reset the counter at each Planner
// / Coder / Reviewer hand-off), not per-turn — so the effective ceiling
// across a pipeline run is ~3× this number.
//
// Was 10 in 0.2.x — that tripped on routine codebase exploration where
// the planner needed 12-20 sequential reads to map a new repo. Codex
// and Claude Code allow 100+ rounds per agent loop; 50 is a generous
// midpoint that lets real work finish without going unbounded.
const MAX_TOOL_ROUNDS = 50

function emitPhase(conversationId: string, phase: AgentRunPhase): void {
  emitChatEvent('chat:phase', { conversationId, phase })
}

export function registerChatHandlers(): void {
  ipcMain.handle('chat:send', async (_event, request) => {
    // Defensive: the renderer is trusted but a malformed payload (hot
    // reload race, programmatic caller, future SDK consumer) must not
    // crash the handler. Validate the shape before doing anything.
    const validation = validateChatSendRequest(request)
    if (!validation.ok) {
      return { success: false, error: validation.error }
    }
    const { content: rawContent, model, activeSkillIds, requestedAgentMode } = validation.value
    // D3 — the prompt body the rest of the handler sees may have a
    // /research or --no-research prefix stripped off it. The actual
    // routing decision is made below before any model dispatch.
    let content = rawContent
    let conversationId = validation.value.conversationId

    // Hoisted so the catch block can reference it when an exception fires
    // before the regular `activeAbortControllers.set` runs. Generated here
    // (rather than after that .set) so the chat.error event always carries a
    // correlationId, even when the user typed into a conversation that
    // failed to materialise.
    const correlationId = randomUUID()

    try {
      if (conversationId === 'new' || !conversationId) {
        const conv = convStore.createConversation(model)
        conversationId = conv.id
      }

      // D3 — Deep research routing decision. Strips any /research or
      // --no-research prefix from the prompt and, when auto-trigger is
      // enabled in settings (defaults to off until D10 ships the real
      // orchestrator), runs the intent classifier. The /research prefix
      // forces the pipeline regardless of the auto-trigger setting.
      const deepResearchSettings = readDeepResearchSettings()
      let researchRoute: Awaited<ReturnType<typeof routeChatTurn>> | null = null
      try {
        researchRoute = await routeChatTurn(rawContent, {
          autoTrigger: deepResearchSettings.autoTrigger,
          planMode: isPlanModeActive(conversationId),
          modelOverride: deepResearchSettings.classifierModel
        })
      } catch (err) {
        console.warn('[chat] research routing decision threw; falling back to normal flow:', err)
      }
      if (researchRoute) {
        // Use the cleaned body (prefix stripped) for the saved message and
        // every downstream model call.
        content = researchRoute.kind === 'research' ? researchRoute.body : researchRoute.content
      }

      convStore.saveMessage({
        id: randomUUID(),
        conversationId,
        role: 'user',
        content,
        model
      })

      // If routing chose the research pipeline, hand off to runDeepResearch
      // and emit its outcome as the assistant message. Most errors fall
      // through to the outer catch which emits a chat:error event so the
      // user sees the problem. EXCEPTION: a NoSourcesError (R1+R2) is
      // recoverable — we persist a system note about the failed search and
      // fall through to a normal chat turn so the model can answer from
      // training knowledge instead of ghosting the conversation.
      if (researchRoute && researchRoute.kind === 'research') {
        // Set up an abort controller early so chat:cancel can interrupt
        // the in-flight research run. The normal-dispatch path below
        // creates its own a few lines later; only one of the two ever
        // runs per turn.
        const researchAbort = new AbortController()
        activeAbortControllers.set(conversationId, {
          controller: researchAbort,
          correlationId,
          startedAt: Date.now()
        })
        try {
          const outcome = await runDeepResearch({
            question: researchRoute.body,
            depth: researchRoute.depth,
            conversationId,
            correlationId,
            abortSignal: researchAbort.signal
          })
          // D11 will register the artifact with the renderer; D10's job
          // is to drop the assistant message containing the executive
          // summary and a clickable link to the on-disk markdown.
          convStore.saveMessage({
            id: randomUUID(),
            conversationId,
            role: 'assistant',
            content: `${outcome.summary}\n\n**Sources:** ${outcome.sourceCount} (${outcome.acceptedCount} accepted, ${outcome.singleSourceCount} single-source, ${outcome.disputedCount} disputed) · Providers: ${outcome.providersUsed.join(', ') || 'none'}\n\n[Open full report](artifact://research/${outcome.filename})`,
            model
          })
          activeAbortControllers.delete(conversationId)
          return { success: true, data: { conversationId, correlationId } }
        } catch (researchErr: unknown) {
          activeAbortControllers.delete(conversationId)
          if (researchErr instanceof NoSourcesError) {
            // R1+R2 — recoverable. Persist a SYSTEM-role message that
            // tells the model (and the user, in the transcript) that the
            // search cascade returned nothing. The fall-through runs the
            // normal chat dispatch which picks this system note up via
            // promptHistory below.
            const trail = researchErr.summary()
            convStore.saveMessage({
              id: randomUUID(),
              conversationId,
              role: 'system',
              content:
                'Deep research fallback: the web-search cascade returned no usable sources for this prompt. ' +
                'Answer from training knowledge ONLY. Be explicit that web search returned nothing, name any ' +
                'limitations (no recent events, no citations), and offer to retry with a narrower query or ' +
                'after the user configures a Brave Search / SerpAPI key in Settings → API Keys.\n\n' +
                `Search provider trail:\n${trail}`,
              model
            })
            // Tell the renderer the research stage failed cleanly so the
            // banner closes; the next phase emit (`understanding`) then
            // re-opens the normal-chat lifecycle.
            emitChatEvent('chat:error', {
              conversationId,
              error: `Research cascade returned no sources — falling back to model knowledge.`
            })
            // Fall through to the normal-chat dispatch below. Do NOT return.
          } else {
            // Anything else from runDeepResearch (FabricatedCitationError,
            // DeepResearchCancelledError, hard exceptions) keeps the
            // existing behaviour: surface to the outer catch as chat:error.
            throw researchErr
          }
        }
        void FabricatedCitationError
        void DeepResearchCancelledError
      }

      emitPhase(conversationId, 'understanding')

      void fireHooks('promptSubmit', { conversationId, promptBody: content })

      // Track 2 / E5 — auto context compression. Run BEFORE pulling
      // history so the next turn's prompt sees the compressed view.
      // The model's context window comes from the catalogue entry; an
      // unknown model defaults to a conservative 128k cap. The compressor
      // is a pure-SQL operation (no LLM call in v1), so the latency is
      // negligible.
      try {
        const modelInfo = resolveModel(model)
        const ctxWindow = modelInfo.contextWindow ?? 128_000
        const r = compressOldestMessages(conversationId, ctxWindow)
        if (r) {
          emitChatEvent('chat:compressed', {
            conversationId,
            summaryMessageId: r.summaryMessageId,
            compressedCount: r.compressedCount,
            reductionPct: r.reductionPct
          })
        }
      } catch (err) {
        console.error('[chat] context compression failed:', err)
      }

      const allMessages = convStore.getMessages(conversationId)
      // The dispatcher uses the effective view (compressed messages
      // hidden, summary inserted in their place) for the OpenAI API.
      const promptHistory = getEffectiveMessages(conversationId)
      const memoryBlock = memStore.buildMemoryBlock()
      // D2: always-loaded `<memory_index>` block built from MEMORY.md.
      // Returns '' when the project has no entries, in which case
      // buildSystemPrompt drops the block entirely.
      const memoryIndexBlock = memStore.buildMemoryIndexBlock()
      const taskNotificationsBlock = buildTaskNotificationsBlock(
        drainAsyncEventsForPrompt(conversationId)
      )

      const settingsRaw = readSettingsJson()
      const agentic = loadAgenticCodingConfig(settingsRaw)

      // Auto-merge the configured agentic-coding skill ids into the round's
      // active set when mode is on. mergeAgenticSkillIds dedupes against the
      // user's existing picks so toggling the same skill from the panel
      // doesn't double-inject its content.
      // activeSkillIds was already validated + filtered at the handler entry.
      const effectiveSkillIds = agentic.mode
        ? mergeAgenticSkillIds(activeSkillIds, agentic.skills)
        : activeSkillIds

      let skillContents: {
        name: string
        content: string
        allowedTools?: string[]
        description?: string
      }[] = []
      if (effectiveSkillIds.length > 0) {
        const skills = listSkills()
        skillContents = effectiveSkillIds
          .map((id: string) => {
            const skill = skills.find((s) => s.id === id)
            if (!skill) return null
            const content = getSkillContent(id)
            if (!content) return null
            return {
              name: skill.name,
              content,
              ...(skill.allowedTools ? { allowedTools: skill.allowedTools } : {}),
              // HY4 — carry the description so lazy skill stubs can summarize.
              ...(skill.description ? { description: skill.description } : {})
            }
          })
          .filter(Boolean) as {
          name: string
          content: string
          allowedTools?: string[]
          description?: string
        }[]
      }

      // HY4 — lazy skill bodies follow the tool-surface mode: lazy (default)
      // injects name+description stubs; 'full' injects full bodies as before.
      const lazySkillBodies =
        ((settingsRaw as { toolSurface?: string } | null)?.toolSurface ?? 'lazy') !== 'full'

      const { params: modelParams, systemPromptOverride } = loadModelConfig(settingsRaw, model)
      const activeWorkspace = getActiveWorkspace()
      const agentsMd = readAgentsMd(activeWorkspace)
      const chaptersBlock = buildChaptersBlock(conversationId)
      const supportsTools = resolveModel(model).supportsTools
      const systemPrompt = buildSystemPrompt(
        skillContents,
        memoryBlock,
        systemPromptOverride,
        agentsMd,
        model,
        // When mode is on, layer the coding role fragment on top of the base
        // contract. When off, leave contractRole undefined so existing turn
        // shapes match pre-Prompt-14.
        agentic.mode ? 'coding' : undefined,
        memoryIndexBlock,
        taskNotificationsBlock,
        chaptersBlock,
        supportsTools,
        lazySkillBodies
      )

      // Tools come from the unified registry — natives (memory_add today) plus
      // all currently-connected MCP server tools, with stable descriptors and
      // OpenAI-compatible function schemas.
      //
      // WC-1: Tools are now normalized for the active model's provider before
      // dispatch. The normalizer strips unsupported JSON Schema keywords,
      // fails fast on core tools that can't be normalized, and drops non-core
      // tools with a logged warning. Single-mode and multi-mode share this
      // tools array (line 529 + 574), so both pathways are covered.
      //
      // WC-2: The Coder is the role that receives tools — single-mode is
      // implicitly Coder; multi-mode's Planner uses chatOnce without tools
      // and Reviewer uses subAgentRunner without tools (per FC_AUDIT §4).
      // Filtering by role='coder' here returns the full set (Coder allowlist
      // is unrestricted) but the call site is now the explicit source of
      // truth for which role receives this tools array.
      const activeProvider = getProviderForModel(model)
      // HY2 — lazy model tool-surface. Default `'lazy'`: send the always-on
      // core set + `tool_search`; the model unlocks the rest on demand (state
      // in tool-unlock-state.ts). `'full'` or a downgraded conversation gets
      // the entire normalized catalog, byte-for-byte the pre-Hygiene path.
      const tools: ChatCompletionTool[] =
        buildDispatchTools(conversationId, activeProvider, settingsRaw)

      const apiMessages = buildApiMessagesFromStoredMessages(systemPrompt, promptHistory)

      const abortController = new AbortController()
      // Stash the abort controller + the correlationId generated above so
      // chat:cancel can find them. Every downstream producer takes this id so
      // the whole run is one row-group in the event log. Pre-Prompt-3 events
      // landed without one.
      activeAbortControllers.set(conversationId, {
        controller: abortController,
        correlationId,
        startedAt: Date.now()
      })

      // Workspace pinned at the start of the round so the in-flight tool
      // loop sees one consistent cwd even if the user retargets the folder
      // chip mid-stream.
      const workspacePath = activeWorkspace

      // Prompt 11: agentMode dispatch. The single-mode path below is
      // byte-for-byte unchanged from pre-Prompt-11. Multi mode routes
      // through `runAgentPipeline` with the validated roster. A bad
      // roster falls back to single mode so the user isn't left without
      // a reply. The whole decision tree lives in `resolveAgentDispatch`
      // so the chat:send wiring is testable in isolation.
      //
      // L8 (Lampshade Phase, 2026-06-09) — when settings resolve to
      // `agentMode: 'auto'` (the new default), `resolveAgentDispatch`
      // calls `routeAgentMode(content)` to decide single vs multi per
      // turn based on the user's prompt shape. The decision's
      // `routeReason` is logged for UI surfacing.
      const dispatch = resolveAgentDispatch(settingsRaw, content)
      if (dispatch.routeReason) {
        console.info(`[chat] auto-routed to ${dispatch.kind}: ${dispatch.routeReason}`)
      }
      void requestedAgentMode

      // HY5 (Split) — decide whether the heavyweight proof machinery (change
      // contracts + proof-gate trust notice) engages this turn. L8 routing is
      // unchanged above; this only scopes the proof flow to rigor turns.
      setProofRigor(
        conversationId,
        resolveProofRigor({
          proofGateMode: (settingsRaw as { proofGate?: string } | null)?.proofGate,
          dispatchKind: dispatch.kind,
          content
        })
      )

      if (dispatch.kind === 'multi') {
        // P11 review-P1: the Coder must execute with ITS OWN model's
        // identity, system-prompt override, and modelConfig params —
        // not the request model's. The outer `systemPrompt` and
        // `modelParams` were derived from `model` (the active model the
        // user selected for the conversation), which is the Coder model
        // ONLY when single-mode would have been used. In multi mode we
        // build a Coder-specific system prompt with contractRole='coding'
        // (always, regardless of `agenticCodingMode` — the pipeline IS
        // the coding-mode wrapper at this layer) and a Coder-specific
        // params block.
        const coderRoster = dispatch.roster
        const { params: coderModelParams, systemPromptOverride: coderSystemOverride } =
          loadModelConfig(settingsRaw, coderRoster.coder)
        const coderSystemPrompt = buildSystemPrompt(
          skillContents,
          memoryBlock,
          coderSystemOverride,
          agentsMd,
          coderRoster.coder,
          'coding',
          memoryIndexBlock,
          taskNotificationsBlock,
          chaptersBlock,
          // supportsNativeTools left undefined — preserves the exact pre-HY4
          // coder prompt (no guard/think stripping change); HY4 only adds the
          // lazy skill-body flag in the next position.
          undefined,
          lazySkillBodies // HY4
        )
        const priorWithoutLatestUser = apiMessages.filter(
          (m, idx) => idx !== 0 // drop the system entry; pipeline owns it
        )
        // Drop the most recent user turn from the prior list — pipeline
        // injects its own rewritten user message that carries the plan.
        // The latest user is whatever we just saved; locate by trailing
        // role==='user'.
        const lastUserIdx = priorWithoutLatestUser
          .map((m, i) => (m.role === 'user' ? i : -1))
          .filter((i) => i >= 0)
          .pop()
        const priorTrimmed =
          lastUserIdx === undefined
            ? priorWithoutLatestUser
            : priorWithoutLatestUser.slice(0, lastUserIdx)

        await runAgentPipeline({
          conversationId,
          correlationId,
          roster: coderRoster,
          userContent: content,
          systemPrompt: coderSystemPrompt,
          priorMessages: priorTrimmed,
          tools: tools.length > 0 ? tools : undefined,
          workspacePath,
          signal: abortController.signal,
          subAgentRunner: async (subMessages, modelId, subSignal) => {
            // chatOnce takes (messages, modelId, signal); sub-agents are
            // one-shot reasoning calls — per-model temperature/topP from
            // modelConfig doesn't apply here. R3: return the object form
            // so Planner + Reviewer reasoning flows through forkAgent →
            // SubAgentResult.reasoning → the saved Planner / Reviewer row.
            const result = await chatOnce(subMessages, modelId, subSignal, {
              correlationId,
              conversationId,
              purpose: 'sub-agent'
            })
            return { output: result.content, reasoning: result.reasoning }
          },
          coderRunner: async ({ messages, model: coderModel, tools: coderTools, signal: coderSignal }) =>
            runChatRound(
              conversationId,
              coderModel,
              messages,
              coderTools,
              workspacePath,
              coderSignal,
              0,
              coderModelParams,
              agentic.composer,
              /* suppressDoneEvent */ true,
              correlationId
            )
        })
      } else {
        if (dispatch.reason) {
          // Surface why the pipeline was bypassed; do NOT block the user's
          // reply. Falling through to single mode keeps the harness
          // useful while the roster is being corrected.
          console.warn(
            '[chat] agentMode=multi but roster invalid; falling back to single mode:',
            dispatch.reason
          )
        }
        await runChatRound(
          conversationId,
          model,
          apiMessages,
          tools.length > 0 ? tools : undefined,
          workspacePath,
          abortController.signal,
          0,
          modelParams,
          agentic.composer,
          /* suppressDoneEvent */ false,
          correlationId
        )
      }

      activeAbortControllers.delete(conversationId)
      drainPendingDocuments(correlationId)
      return { success: true, data: { conversationId } }
    } catch (err: any) {
      activeAbortControllers.delete(conversationId)
      drainPendingDocuments(correlationId)
      emitPhase(conversationId, 'error')
      emitChatEvent('chat:error', { conversationId, error: err.message })
      // Mirror into the event spine so the timeline reader sees the failure
      // alongside any model/tool/agent events that completed before the throw.
      try {
        recordEvent({
          type: 'chat.error',
          actorKind: 'system',
          severity: 'error',
          conversationId,
          correlationId,
          payload: {
            errorPreview: boundedJsonPreview(err?.message),
            errorClass: err?.name
          }
        })
      } catch (e) {
        console.error('[chat] chat.error event failed:', e)
      }
      return { success: false, error: err.message }
    }
  })

  ipcMain.handle('chat:cancel', async (_event, conversationId) => {
    const run = activeAbortControllers.get(conversationId)
    if (run) {
      run.controller.abort()
      activeAbortControllers.delete(conversationId)
      drainPendingDocuments(run.correlationId)
      try {
        recordEvent({
          type: 'chat.cancelled',
          actorKind: 'user',
          severity: 'warning',
          conversationId,
          correlationId: run.correlationId,
          payload: {
            cancelledAt: Date.now(),
            elapsedMs: Date.now() - run.startedAt
          }
        })
      } catch (err) {
        console.error('[chat] chat.cancelled event failed:', err)
      }
    }
    return { success: true, data: null }
  })

  ipcMain.handle('chat:generateTitle', async (_event, content: string) => {
    try {
      const rawResult = await chatOnce(
        [
          {
            role: 'system',
            content:
              'Generate a concise 3–5 word title for a conversation that begins with the user message below. Reply with ONLY the title — no quotes, no punctuation, no trailing period.'
          },
          { role: 'user', content }
        ],
        'deepseek-v4-flash'
      )
      const cleaned = rawResult.content.replace(/^["'\s]+|["'\s]+$/g, '').replace(/[.!?]+$/g, '').slice(0, 60)
      return { success: true, data: cleaned || content.slice(0, 40) }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'Title generation failed' }
    }
  })

  // mcp:approveToolCall used to live here because chat.ts owned the pending
  // confirmation promises. It now lives in electron/ipc/permissions.ts and
  // routes through permissionsService.
}

// Prompt 11: agent-pipeline mode needs to capture the Coder's final
// assistant message AND defer the chat:done emit until after the Reviewer
// stage has been queued (so the renderer doesn't clear the pipeline-banner
// in the gap between Coder-done and Reviewer-running). When
// `suppressDoneEvent` is true:
//   * runChatRound persists the assistant message as usual,
//   * BUT it does NOT emit `chat:phase = done` or `chat:done`,
//   * AND it resolves with the persisted message so the caller can emit
//     those events itself at the right moment.
// Single-mode callers pass `false` (the default) and ignore the return
// value; the byte-for-byte behaviour of the pre-Prompt-11 path is
// preserved.
export type RunChatRoundResult = { message: unknown } | null

/**
 * HY2 — Build the tool array handed to the model for a turn. `'lazy'` (default)
 * returns the core set + `tool_search` + any tools already unlocked for this
 * conversation; `'full'` (or a downgraded conversation) returns the entire
 * normalized catalog, identical to the pre-Hygiene dispatch.
 */
function buildDispatchTools(
  conversationId: string,
  provider: ProviderId,
  settingsRaw: unknown
): ChatCompletionTool[] {
  const mode = (settingsRaw as { toolSurface?: string } | undefined)?.toolSurface ?? 'lazy'
  if (mode === 'lazy' && !isSurfaceDowngraded(conversationId)) {
    activateLazySurface(conversationId)
    return toolRegistry.getModelToolSurface(provider, {
      unlockedNames: getUnlockedTools(conversationId)
    })
  }
  return toolRegistry.getNormalizedToolsForRole('coder', provider)
}

/**
 * HY2 — Recompute the tool array between tool-call rounds so tools unlocked by
 * a `tool_search` call this round are callable next round. In `'full'` mode
 * (and for non-lazy conversations) the array passes through unchanged; a
 * mid-loop downgrade rebuilds the full catalog.
 */
function rebuildToolsForNextRound(
  conversationId: string,
  model: string,
  currentTools: ChatCompletionTool[] | undefined
): ChatCompletionTool[] | undefined {
  if (isLazyActive(conversationId)) {
    return toolRegistry.getModelToolSurface(getProviderForModel(model), {
      unlockedNames: getUnlockedTools(conversationId)
    })
  }
  if (isSurfaceDowngraded(conversationId)) {
    return toolRegistry.getNormalizedToolsForRole('coder', getProviderForModel(model))
  }
  return currentTools
}

export async function runChatRound(
  conversationId: string,
  model: string,
  messages: ChatCompletionMessageParam[],
  tools: ChatCompletionTool[] | undefined,
  workspacePath: string,
  signal: AbortSignal,
  round: number,
  params?: ModelParams,
  composerMode: AgenticComposerMode = 'auto',
  suppressDoneEvent: boolean = false,
  correlationId?: string,
  /** Reasoning Audit Phase R6 — cumulative reasoning trail. Pre-existing
   *  rounds' chain-of-thought; this round appends its own onDone.
   *  Threaded through recursion so the FINAL round (no tool calls + the
   *  composer ran) can fold the whole trail into the composer-row's
   *  `reasoning` column via concatReasoningTrail(). Defaults to [] at
   *  the top-level call so callers don't need to pass it. */
  roundReasonings: string[] = [],
  turnStartedAt: number = Date.now()
): Promise<RunChatRoundResult> {
  trace('runChatRound.enter', {
    conversationId,
    correlationId,
    model,
    round,
    messagesCount: messages.length,
    toolsCount: tools?.length ?? 0,
    parentSignalAborted: signal.aborted
  })
  if (round >= MAX_TOOL_ROUNDS) {
    emitPhase(conversationId, 'error')
    emitChatEvent('chat:error', {
      conversationId,
      // Tool calls completed in rounds 0..MAX_TOOL_ROUNDS-1 ARE persisted —
      // re-prompting with "continue" picks up where the model left off
      // because the history reflects the partial work.
      error: `Tool-call cap reached (${MAX_TOOL_ROUNDS} rounds this stage). Re-prompt with "continue" to keep going — the partial work is saved.`
    })
    return null
  }

  const descriptor = resolveModel(model)
  // FC-10 — when the capability tracker has downgraded this model for this
  // conversation, treat it as supportsTools: false going forward. The
  // fallback parser (FC-6/FC-8) handles tool invocation from text.
  const actuallySupportsTools = descriptor.supportsTools && !isDowngraded(conversationId, model)
  const effectiveTools = actuallySupportsTools ? tools : undefined

  const audit: ModelRequestAudit | undefined = correlationId
    ? { correlationId, conversationId, purpose: 'main' }
    : undefined

  return new Promise<RunChatRoundResult>((resolve, reject) => {
    chatStream(
      messages,
      model,
      effectiveTools,
      {
        onChunk: (chunk) => {
          emitChatEvent('chat:chunk', { conversationId, content: chunk })
        },
        onReasoning: (chunk) => {
          emitChatEvent('chat:reasoning', { conversationId, content: chunk })
        },
        onVitals: (v) => {
          emitChatEvent('chat:streaming-vitals', {
            conversationId,
            lastChunkAt: v.lastChunkAt,
            msSinceLastChunk: v.msSinceLastChunk,
            chunkCount: v.chunkCount,
            tokenEstimate: v.tokenEstimate,
            attemptElapsedMs: v.attemptElapsedMs
          })
        },
        onDone: async (fullContent, toolCalls, fullReasoning) => {
          trace('runChatRound.onDone', {
            conversationId,
            round,
            contentLen: fullContent.length,
            reasoningLen: fullReasoning?.length ?? 0,
            toolCallsCount: toolCalls?.length ?? 0
          })

          // FC-10 — capability mismatch detection. When the model is flagged
          // supportsTools but returns tool-like text without tool_calls,
          // track consecutive mismatches. Downgraded models bypass future
          // native-tool attempts and go straight to fallback parsing.
          if (descriptor.supportsTools) {
            const gotToolCalls = !!(toolCalls && toolCalls.length > 0)
            const toolsWereSent = effectiveTools !== undefined
            const warning = recordCapabilityCheck(
              conversationId,
              model,
              toolsWereSent,
              gotToolCalls,
              fullContent
            )
            if (warning) {
              trace('runChatRound.capability-mismatch', {
                conversationId,
                model,
                warning
              })
              // Log but don't block — the user's current turn proceeds normally
            }
          }

          // FC-8 — when the model does not support native tool calling
          // (toolCalls is empty/null), attempt fallback parsing from the
          // text content. Fallback models are instructed to output JSON
          // following the fallback contract. If a valid fallback call is
          // found, convert it to the native toolCalls format and dispatch
          // through the same pathway.
          //
          // FC-10 — also run capability mismatch detection. When a native
          // model returns tool-like syntax but no tool_calls, track
          // consecutive mismatches. After 3, temporarily downgrade to
          // fallback mode so the user's turn isn't wasted.
          let effectiveToolCalls = toolCalls
          // Fallback parsing triggers when: (a) model doesn't support tools
          // natively, OR (b) model has been downgraded due to capability mismatch.
          const needsFallbackParsing = !descriptor.supportsTools || isDowngraded(conversationId, model)
          if ((!effectiveToolCalls || effectiveToolCalls.length === 0) && needsFallbackParsing) {
            const descriptors = toolRegistry.getDescriptors()
            const fallbackResult = parseFallbackToolCalls(fullContent, descriptors)
            if (fallbackResult && !fallbackResult.isFinalAnswer && fallbackResult.calls.length > 0) {
              // Convert fallback ToolCallRequest[] to ProviderToolCall[]
              effectiveToolCalls = fallbackResult.calls.map((fc) => ({
                id: fc.id,
                type: 'function' as const,
                function: { name: fc.name, arguments: JSON.stringify(fc.arguments) }
              }))
              trace('runChatRound.fallback-parsed', {
                conversationId,
                round,
                callCount: effectiveToolCalls.length,
                provenance: 'fallback'
              })
            }
          }

          if (!effectiveToolCalls || effectiveToolCalls.length === 0) {
            let finalContent = fullContent
            let draft: string | undefined
            let composerReasoning: string | undefined
            let composerRan = false
            // R6 — append this round's reasoning to the cumulative trail
            // BEFORE the composer runs. The trail then carries every
            // round's CoT plus the composer's CoT into the saved final.
            const roundsForTrail = [...roundReasonings, fullReasoning ?? '']
            if (resolveComposerGate(composerMode, round)) {
              emitPhase(conversationId, 'summarizing')
              try {
                const summary = summarizeRun(
                  messages as any,
                  getPlanSnapshot(conversationId),
                  toolRegistry.getCallsForConversation(conversationId, 50),
                  fullContent,
                  listProofReceipts({
                    conversationId,
                    correlationId,
                    workspacePath,
                    limit: 20
                  }).map((receipt) => ({
                    id: receipt.id,
                    kind: receipt.kind,
                    status: receipt.status,
                    command: receipt.command,
                    parsedMetrics: receipt.parsedMetrics,
                    exitCode: receipt.exitCode,
                    durationMs: receipt.durationMs
                  }))
                )
                const composed = await composeFinalResponse({
                  summary,
                  model,
                  signal,
                  // chatOnce now takes an optional audit context; the composer
                  // passes it through transparently when callers supply one.
                  // R2: composer runner returns {content, reasoning?}.
                  runner: (msgs, modelId, sig) =>
                    chatOnce(msgs, modelId, sig, audit && { ...audit, purpose: 'composer' })
                })
                if (composed.content) {
                  finalContent = composed.content
                  draft = fullContent
                  composerReasoning = composed.reasoning
                  composerRan = true
                }
              } catch (err) {
                console.warn('[chat] final response composer failed:', err)
                // The user still gets the original streamed `fullContent`;
                // the un-composed draft is the safe fallback. Record a
                // chat.error event so the Activity Timeline shows that the
                // composer pass didn't land, without disrupting the reply.
                if (correlationId) {
                  try {
                    recordEvent({
                      type: 'chat.error',
                      actorKind: 'system',
                      severity: 'warning',
                      conversationId,
                      correlationId,
                      payload: {
                        source: 'composer',
                        errorPreview: boundedJsonPreview(
                          (err as Error)?.message ?? String(err)
                        )
                      }
                    })
                  } catch (e) {
                    console.error('[chat] composer chat.error event failed:', e)
                  }
                }
              }
            }
            const documents = drainPendingDocuments(correlationId)
            // R6 — when the composer ran, write the CUMULATIVE per-round
            // reasoning trail (plus the composer's own CoT) to this row's
            // reasoning column, capped at MAX_REASONING_BYTES with an
            // honest truncation marker. Tag the row stage='composer' so
            // R7's MessageBubble shows the muted "Composer" chip.
            // When the composer did NOT run (single-shot turn, no tool
            // rounds, or composer failed), fall back to the streamed
            // round's own reasoning unchanged — single-agent behavior is
            // preserved exactly.
            const finalReasoning = composerRan
              ? concatReasoningTrail(roundsForTrail, composerReasoning)
              : fullReasoning
            const finalStage: 'composer' | undefined = composerRan ? 'composer' : undefined
            // HY5 (Split) — only run the proof gate + append its notice on
            // rigor turns. Non-rigor turns skip the receipts scan and keep a
            // clean reply; proofStatus stays undefined (banner shows nothing).
            const gate = isProofRigorActive(conversationId)
              ? evaluateProofGate({
                  conversationId,
                  correlationId,
                  workspacePath,
                  sinceMs: turnStartedAt,
                  toolCalls: toolRegistry.getCallsForConversation(conversationId, 50),
                  getDescriptor: (toolId) => toolRegistry.getById(toolId)
                })
              : null
            if (gate && !gate.trusted) {
              finalContent += proofGateNotice(gate)
            }
            // WC-4 — Persist trust state as a structured column. NULL means
            // "not applicable" (no mutating tool observed on this turn) so
            // the column stays sparse on read-only / research turns.
            // `gate.status === 'not_required'` is the proof-gate equivalent
            // of "no mutations were observed", which maps to undefined.
            // 'trusted' / 'untrusted' map directly from gate.trusted on
            // applicable turns. 'blocked' and 'waived' are reserved for the
            // M6 waiver flow (WC-5 plumbing).
            const proofStatus: 'trusted' | 'untrusted' | undefined =
              !gate || gate.status === 'not_required'
                ? undefined
                : gate.trusted
                  ? 'trusted'
                  : 'untrusted'
            const assistantMsg = convStore.saveMessage({
              id: randomUUID(),
              conversationId,
              role: 'assistant',
              content: finalContent,
              model,
              draft,
              reasoning: finalReasoning,
              documents,
              stage: finalStage,
              proofStatus
            })
            if (!suppressDoneEvent) {
              emitPhase(conversationId, 'done')
              emitChatEvent('chat:done', { conversationId, message: assistantMsg })
              void fireHooks('agentStop', { conversationId })
            }
            resolve({ message: assistantMsg })
            return
          }

          const persistedToolCalls = effectiveToolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.function.name, arguments: tc.function.arguments }
          }))

          convStore.saveMessage({
            id: randomUUID(),
            conversationId,
            role: 'assistant',
            content: fullContent || '',
            model,
            toolCalls: persistedToolCalls,
            reasoning: fullReasoning
          })

          messages.push({
            role: 'assistant',
            content: fullContent || null,
            tool_calls: persistedToolCalls
          } as any)

          // Group the model's tool_calls into execution windows: contiguous
          // spans of parallelizable calls run via Promise.all; non-parallel
          // calls run one at a time. The final tool-role messages are pushed
          // in tool_call array order regardless of completion order so the
          // next API round sees a consistent sequence.
          const resolved: ResolvedToolCall[] = new Array(effectiveToolCalls.length)
          const windows = partitionToolCallWindows(effectiveToolCalls, (id) =>
            toolRegistry.getById(id)
          )
          for (const win of windows) {
            if (win.kind === 'parallel') {
              const settled = await Promise.all(
                win.indices.map((idx) =>
                  resolveSingleToolCall(
                    effectiveToolCalls[idx],
                    conversationId,
                    model,
                    workspacePath,
                    signal,
                    correlationId
                  )
                )
              )
              for (let i = 0; i < win.indices.length; i++) {
                resolved[win.indices[i]] = settled[i]
              }
            } else {
              resolved[win.index] = await resolveSingleToolCall(
                effectiveToolCalls[win.index],
                conversationId,
                model,
                workspacePath,
                signal,
                correlationId
              )
            }
          }

          // HY3 — spill threshold (chars). Default DEFAULT_SPILL_THRESHOLD;
          // `toolResultSpill: false` or `toolResultSpillBytes: 0` disables it.
          const spillSettings = readSettingsJson() ?? {}
          const spillThreshold =
            spillSettings.toolResultSpill === false
              ? 0
              : typeof spillSettings.toolResultSpillBytes === 'number'
                ? spillSettings.toolResultSpillBytes
                : DEFAULT_SPILL_THRESHOLD
          for (const r of resolved) {
            // Persist the FULL result — the UI shows it in full.
            convStore.saveMessage({
              id: randomUUID(),
              conversationId,
              role: 'tool',
              content: r.result,
              toolCallId: r.callId
            })
            // Feed the MODEL a head+tail preview when the result is large; the
            // full text stays on disk, reachable via read_tool_result.
            const spill = maybeSpillToolResult(r.result, { threshold: spillThreshold })
            messages.push({
              role: 'tool',
              content: spill.result,
              tool_call_id: r.callId
            } as any)
          }

          try {
            // R6 — fold THIS round's reasoning into the cumulative trail
            // before recursing. The final round (no tool calls + composer
            // ran) reads the trail off the `roundReasonings` parameter
            // and folds it into the saved composer-row's reasoning column.
            const nextRoundReasonings = fullReasoning && fullReasoning.length > 0
              ? [...roundReasonings, fullReasoning]
              : roundReasonings
            const next = await runChatRound(
              conversationId,
              model,
              messages,
              // HY2 — fold in any tools unlocked by a tool_search this round.
              rebuildToolsForNextRound(conversationId, model, tools),
              workspacePath,
              signal,
              round + 1,
              params,
              composerMode,
              suppressDoneEvent,
              correlationId,
              nextRoundReasonings,
              turnStartedAt
            )
            resolve(next)
          } catch (err) {
            reject(err)
          }
        },
        onError: (error, partial) => {
          trace('runChatRound.onError', {
            conversationId,
            round,
            errorPreview: String(error).slice(0, 200),
            partialContentLen: partial?.content?.length ?? 0,
            partialReasoningLen: partial?.reasoning?.length ?? 0
          })
          // Permanently fix data loss on stream errors: if the provider
          // streamed body or reasoning before failing, persist it as an
          // assistant message instead of letting it evaporate. Without
          // this, every stream error silently discarded everything the
          // user already saw on screen — including thousands of tokens
          // of chain-of-thought from reasoning models.
          //
          // We emit `chat:done` FIRST with the persisted partial so the
          // renderer transitions the on-screen streaming buffers into a
          // durable message via finishStream (which adds it to the
          // messages array and clears the streaming state). Then we emit
          // `chat:error` so the failure still surfaces as a toast.
          const hasPartial = !!(
            partial && (partial.content || partial.reasoning)
          )
          if (hasPartial) {
            try {
              const documents = drainPendingDocuments(correlationId)
              const errorMarker = `\n\n_[stream interrupted: ${error}]_`
              const assistantMsg = convStore.saveMessage({
                id: randomUUID(),
                conversationId,
                role: 'assistant',
                content: (partial!.content || '') + errorMarker,
                model,
                reasoning: partial!.reasoning,
                documents
              })
              if (!suppressDoneEvent) {
                emitChatEvent('chat:done', {
                  conversationId,
                  message: assistantMsg
                })
              }
            } catch (e) {
              console.error('[chat] failed to persist partial on stream error:', e)
            }
          }

          emitPhase(conversationId, 'error')
          emitChatEvent('chat:error', { conversationId, error })
          // Mirror provider-side stream errors into the spine. `model.request.failed`
          // is already emitted from inside chatStream for the underlying API
          // failure; this `chat.error` row pins the orchestration-layer
          // outcome so the chat-turn timeline reads cleanly even when the
          // provider stream short-circuits before any tool round runs.
          if (correlationId) {
            try {
              recordEvent({
                type: 'chat.error',
                actorKind: 'system',
                severity: 'error',
                conversationId,
                correlationId,
                payload: {
                  errorPreview: boundedJsonPreview(error),
                  source: 'stream'
                }
              })
            } catch (e) {
              console.error('[chat] chat.error event failed:', e)
            }
          }
          reject(new Error(error))
        }
      },
      signal,
      params,
      audit
    )
  })
}

interface ResolvedToolCall {
  callId: string
  result: string
}

/**
 * WC-3 — Per-correlation cache so the implicit-contract check fires at
 * most once per turn. Cleared by id when the run completes via the
 * `cancelTurnTracking` helper called from the chat round's done/error
 * handlers (or by garbage collection when correlation ids age out).
 */
const _implicitContractCheckedCorrelations = new Set<string>()

/**
 * WC-3 — Ensure a change contract exists for the current correlation
 * before the first mutating tool call dispatches. If a Plan-mode contract
 * is already open for this conversation+correlation, do nothing. Otherwise
 * synthesize an implicit one tagged `implicit: true` so the M5 proof gate
 * has something concrete to evaluate against.
 *
 * Failures (DB unavailable, contract store fallback, etc.) are swallowed —
 * implicit contract synthesis is best-effort and must not block tool
 * dispatch. Tests assert the success path.
 */
export function ensureImplicitContractForFirstMutation(input: {
  conversationId: string
  correlationId: string
  toolName: string
  args: Record<string, unknown>
}): void {
  const key = `${input.conversationId}::${input.correlationId}`
  if (_implicitContractCheckedCorrelations.has(key)) return
  _implicitContractCheckedCorrelations.add(key)
  try {
    const existing = listChangeContracts({
      conversationId: input.conversationId,
      correlationId: input.correlationId,
      status: 'active'
    })
    if (existing.length > 0) return
    let userRequest = `Mutating tool call: ${input.toolName}`
    try {
      const msgs = convStore.getMessages(input.conversationId)
      const lastUser = [...msgs].reverse().find((m) => m.role === 'user')
      if (lastUser?.content) {
        userRequest = lastUser.content.slice(0, 2000)
      }
    } catch {
      // Best-effort — fall through to the default userRequest.
    }
    const firstObservedFile =
      typeof input.args?.path === 'string'
        ? input.args.path
        : typeof input.args?.file_path === 'string'
          ? input.args.file_path
          : typeof input.args?.target === 'string'
            ? input.args.target
            : undefined
    synthesizeImplicitChangeContract({
      conversationId: input.conversationId,
      correlationId: input.correlationId,
      userRequest,
      firstObservedFile
    })
  } catch (err) {
    // Best-effort — the M5 gate will surface the contract gap on its own
    // pass if synthesis fails.
    trace('implicitContract.synthesize-failed', {
      conversationId: input.conversationId,
      correlationId: input.correlationId,
      toolName: input.toolName,
      error: (err as Error)?.message ?? String(err)
    })
  }
}

/**
 * WC-3 — Test-only seam: reset the per-correlation cache so a fresh
 * synthesis check fires the next time the helper is invoked.
 */
export function __resetImplicitContractCacheForTesting(): void {
  _implicitContractCheckedCorrelations.clear()
}

async function resolveSingleToolCall(
  tc: ProviderToolCall,
  conversationId: string,
  model: string,
  workspacePath: string,
  signal: AbortSignal,
  correlationId?: string
): Promise<ResolvedToolCall> {
  const toolName = tc.function.name
  let args: Record<string, unknown> = {}
  try {
    args = JSON.parse(tc.function.arguments)
  } catch {
    args = {}
  }

  // HY2 — `tool_search` meta-tool. Synthetic surface-only tool (no registry
  // descriptor), handled before the dispatch path: resolve matches, unlock
  // them for this conversation so the next round can call them natively, and
  // return the match list. A malformed (empty-query) call counts toward the
  // surface downgrade so a model that can't drive the round-trip falls back
  // to the full catalog.
  if (toolName === TOOL_SEARCH_TOOL_NAME) {
    const query = typeof args.query === 'string' ? args.query.trim() : ''
    if (!query) {
      const n = recordMalformedSearch(conversationId)
      return {
        callId: tc.id,
        result: JSON.stringify({
          error: 'tool_search requires a non-empty "query" string.',
          malformedCount: n
        })
      }
    }
    const matches = toolRegistry.resolveToolSearch(query)
    unlockTools(
      conversationId,
      matches.map((m) => m.name)
    )
    return {
      callId: tc.id,
      result: JSON.stringify({
        query,
        unlocked: matches.map((m) => m.name),
        tools: matches,
        note: matches.length
          ? 'These tools are now available — call them directly on your next turn.'
          : 'No matching tools found. Try a different capability description.'
      })
    }
  }

  // FC-5 — Validate arguments against the tool's inputSchema before
  // dispatching. If the model produced invalid arguments (wrong types,
  // missing required fields, extra properties), return a corrective
  // tool-result message instead of executing. This lets the model
  // correct its call on the next turn rather than getting a cryptic
  // handler error or worse, silent wrong behavior.
  const descriptor = toolRegistry.getById(toolName)
  if (descriptor?.inputSchema) {
    const validation = validateToolArguments(toolName, args, descriptor.inputSchema)
    if (!validation.valid) {
      const errorDetail = validation.errors.join('; ')
      trace('resolveToolCall.validation-failed', {
        callId: tc.id,
        conversationId,
        toolName,
        errors: validation.errors
      })
      return {
        callId: tc.id,
        result: JSON.stringify({
          error: 'argument_validation_failed',
          details: validation.errors,
          hint: 'Check the tool schema and retry with corrected arguments.'
        })
      }
    }
    // Use the parsed (and potentially normalized) args from the validator
    args = validation.parsed
  }

  const startTime = Date.now()
  trace('resolveToolCall.enter', {
    callId: tc.id,
    conversationId,
    toolName,
    parentSignalAborted: signal.aborted
  })

  const earlyDescriptor = toolRegistry.getById(toolName)
  emitChatEvent('chat:tool-call', {
    callId: tc.id,
    conversationId,
    serverId: toolName.includes('__') ? toolName.split('__')[0] : 'internal',
    toolName: toolName.includes('__') ? toolName.split('__').slice(1).join('__') : toolName,
    title: earlyDescriptor?.title ?? toolName,
    risks: earlyDescriptor?.risks ?? [],
    providerKind: earlyDescriptor?.providerKind ?? 'native',
    startedAt: startTime,
    args,
    transcriptHidden: earlyDescriptor?.transcriptHidden
  })

  toolRegistry.recordCallStart(
    {
      id: tc.id,
      toolId: toolName,
      name: toolName,
      conversationId,
      args,
      startedAt: startTime,
      status: 'running'
    },
    correlationId
  )

  let result: string
  let explicitStatus: 'done' | 'error' | 'denied' | undefined

  if (descriptor) {
    emitPhase(conversationId, inferPhaseFromDescriptor(descriptor))
  }

  // WC-3 — Synthesize an implicit change contract for the first mutating
  // tool call on this correlation, so the M5 proof gate has scope to
  // evaluate against. Best-effort, cached per (conversation, correlation).
  // Plan-mode-authored contracts are detected by listChangeContracts and
  // preserve their authored shape.
  // HY5 (Split) — only synthesize the implicit change contract on rigor turns;
  // the proof gate that consumes it is likewise rigor-gated above.
  if (
    correlationId &&
    descriptor &&
    isMutatingDescriptor(descriptor) &&
    isProofRigorActive(conversationId)
  ) {
    ensureImplicitContractForFirstMutation({
      conversationId,
      correlationId,
      toolName,
      args
    })
  }

  // Track 2 / C3 — plan-mode gate. Block mutating tools without asking
  // for approval first: there is no point routing through the modal when
  // the mode already says no, and a global 'deny destructive' policy
  // shouldn't get to silently allow what plan-mode forbids. The
  // enter/exit tools opt out of the gate via `mutates: false` on the
  // descriptor, so the model can always flip the mode back off.
  const planModeActive = isPlanModeActive(conversationId)
  const blockedByPlanMode = planModeActive && isMutatingDescriptor(descriptor)

  const needsApproval = !blockedByPlanMode && descriptorNeedsApproval(descriptor)
  // S7 / S12 — shell_command + `dangerously_disable_sandbox: true` escalates
  // the approval flow: per-call risks gain `'sandboxBypass'`, any persisted
  // "always allow" is skipped, and the modal re-pops for every call. Other
  // tools do not honour the flag.
  const isDangerousShellBypass =
    toolName === 'shell_command' && args?.dangerously_disable_sandbox === true
  // FC-9 — fallback-provenance calls (from text parsing, not native
  // tool_calls) carry degraded trust. Mutating fallback calls skip any
  // persisted "always allow" policy and always re-prompt the user.
  const isFallbackProvenance = tc.id.startsWith('fb_')
  const isFallbackMutating = isFallbackProvenance && isMutatingDescriptor(descriptor)
  const callRisks = isDangerousShellBypass && descriptor
    ? [...descriptor.risks, 'sandboxBypass' as const]
    : descriptor?.risks
  const approvalOutcome =
    needsApproval && descriptor
      ? await permissionsService.requestApprovalDetailed({
          callId: tc.id,
          toolId: descriptor.id,
          name: descriptor.name,
          serverId: descriptor.providerId,
          providerKind: descriptor.providerKind,
          risks: callRisks ?? descriptor.risks,
          args,
          conversationId,
          correlationId,
          dangerous: (isDangerousShellBypass || isFallbackMutating) ? true : undefined
        })
      : { decision: 'allow' as const, source: 'none' }
  const approvalDecision = approvalOutcome.decision
  const approvalSource = blockedByPlanMode ? 'plan-mode' : approvalOutcome.source

  if (blockedByPlanMode) {
    result =
      'Blocked: plan mode is active for this conversation. Read-only tools are still available; call `exit_plan_mode` (or have the user click "Exit plan mode" in the banner) to allow mutating tools.'
    explicitStatus = 'denied'
  } else if (approvalDecision === 'deny') {
    result = 'Action denied by user.'
    explicitStatus = 'denied'
  } else {
    // Track 2 / C2 — preToolUse hooks run after approval but before dispatch.
    // A throwing preToolUse hook BLOCKS the call: its message reaches the
    // model as the synthetic tool result and the audit row records 'denied'
    // with approvalSource left at the approval gate's value (the hook is
    // its own provenance). Hook errors are also surfaced as logs for the
    // UI's recent-runs view.
    const preHook = await fireHooks('preToolUse', {
      conversationId,
      toolName,
      args,
      cwd: workspacePath
    })
    if (preHook.blocked) {
      result = `Blocked by hook: ${preHook.blockReason ?? 'preToolUse refused'}`
      explicitStatus = 'denied'
    } else if (toolName === 'memory_add' && typeof args.content === 'string') {
      const entry = memStore.addMemory(args.content, conversationId)
      emitChatEvent('memory:added', entry)
      result = 'Saved to memory.'
    } else if (toolName === 'create_document') {
      const nameRaw = typeof args.name === 'string' ? args.name.trim() : ''
      const mimeRaw = typeof args.mimeType === 'string' ? args.mimeType.trim() : ''
      const contentRaw = typeof args.content === 'string' ? args.content : ''
      if (!nameRaw || !mimeRaw || !contentRaw) {
        result =
          'Error: create_document requires non-empty `name`, `mimeType`, and `content`.'
        explicitStatus = 'error'
      } else {
        const sizeBytes = Buffer.byteLength(contentRaw, 'utf8')
        if (sizeBytes > CREATE_DOCUMENT_MAX_BYTES) {
          result = `Error: create_document body exceeds ${CREATE_DOCUMENT_MAX_BYTES} bytes (got ${sizeBytes}). Split into multiple documents or shorten.`
          explicitStatus = 'error'
        } else {
          const doc: StoredDocument = {
            id: randomUUID(),
            name: nameRaw.slice(0, 200),
            mimeType: mimeRaw.slice(0, 120),
            content: contentRaw,
            sizeBytes,
            createdAt: Date.now()
          }
          pushPendingDocument(correlationId, doc)
          emitChatEvent('chat:document-created', { conversationId, document: doc })
          result = `Document "${doc.name}" (${doc.sizeBytes} bytes, ${doc.mimeType}) attached to this turn. Do NOT paste the body into your visible reply — the user already sees the card.`
        }
      }
    } else if (toolName === 'enter_plan_mode') {
      // Track 2 / C3 — inline because the handler emits a renderer event.
      // Persisted on the conversation row so it survives a restart.
      setPlanModeActive(conversationId, true)
      emitChatEvent('plan:mode-changed', { conversationId, active: true })
      result =
        'Plan mode is on. Mutating tools (apply_patch, shell_command, destructive MCP) are blocked until exit_plan_mode is called.'
    } else if (toolName === 'exit_plan_mode') {
      setPlanModeActive(conversationId, false)
      emitChatEvent('plan:mode-changed', { conversationId, active: false })
      result = 'Plan mode is off. Mutating tools are allowed again.'
    } else if (toolName === 'mark_chapter') {
      // Track 2 / E1 — anchor the chapter at the assistant turn that
      // produced the call. The anchor message id is not yet persisted at
      // this point in the dispatch loop (the post-tool assistant message
      // gets persisted after this returns), so we anchor on the existing
      // tool-call id — chat-history can map it back to its parent
      // assistant turn. The renderer treats the anchor as the boundary
      // marker; UI cosmetic, no behavioural dependency on exact mapping.
      const titleRaw =
        typeof args.title === 'string' ? args.title.trim() : ''
      const summaryRaw =
        typeof args.summary === 'string' ? args.summary.trim() : ''
      if (!titleRaw) {
        result = 'Error: mark_chapter requires a non-empty `title`.'
        explicitStatus = 'error'
      } else {
        const chapter = createChapter({
          conversationId,
          title: titleRaw.slice(0, 80),
          summary: summaryRaw ? summaryRaw.slice(0, 280) : null,
          anchorMessageId: tc.id
        })
        emitChatEvent('chat:chapter-marked', { conversationId, chapter })
        // Plan §2 invariant 10 — chapters also land on the event spine
        // for the audit timeline.
        try {
          recordEvent({
            type: 'chat.chapter.marked',
            actorKind: 'model',
            conversationId,
            correlationId,
            entityKind: 'chapter',
            entityId: chapter.id,
            payload: {
              title: chapter.title,
              summary: chapter.summary,
              anchorMessageId: chapter.anchorMessageId
            }
          })
        } catch (err) {
          console.error('[chat] chat.chapter.marked spine event failed:', err)
        }
        result = `Chapter marked: "${chapter.title}"`
      }
    } else if (toolName === 'ask_user_question') {
      // Integration / H6 — route through the singleton ask-user-runtime.
      // The handler returns the chosen option label (multi-select returns a
      // comma-separated list); a timeout returns the literal "(timed out)"
      // so the model can detect non-interactive contexts and proceed.
      const question = typeof args.question === 'string' ? args.question.trim() : ''
      const header = typeof args.header === 'string' ? args.header.trim() : ''
      const optionsRaw = Array.isArray(args.options) ? args.options : []
      const options: Array<{ label: string; description?: string; preview?: string }> = []
      for (const o of optionsRaw) {
        if (!o || typeof o !== 'object') continue
        const opt = o as Record<string, unknown>
        const label = typeof opt.label === 'string' ? opt.label.trim() : ''
        if (!label) continue
        const entry: { label: string; description?: string; preview?: string } = { label }
        if (typeof opt.description === 'string') entry.description = opt.description
        if (typeof opt.preview === 'string') entry.preview = opt.preview
        options.push(entry)
      }
      if (!question || !header || options.length < 2 || options.length > 4) {
        result =
          'Error: ask_user_question requires `question`, `header`, and 2-4 `options` with non-empty `label`s.'
        explicitStatus = 'error'
      } else {
        try {
          const runtime = getAskUserRuntime()
          if (!runtime) {
            throw new Error('ask-user runtime not initialised')
          }
          const answer = await runtime.ask({
            question,
            header,
            options,
            multiSelect: !!args.multiSelect,
            timeoutMs:
              typeof args.timeoutMs === 'number' && Number.isFinite(args.timeoutMs)
                ? args.timeoutMs
                : undefined
          })
          if (answer.kind === 'timeout') {
            result = '(timed out — user did not respond)'
          } else if (answer.kind === 'cancelled') {
            result = '(cancelled by user)'
          } else if (answer.kind === 'single') {
            result = answer.notes ? `${answer.label} — ${answer.notes}` : answer.label
          } else {
            const joined = answer.labels.join(', ')
            result = answer.notes ? `${joined} — ${answer.notes}` : joined
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          result = `Error: ${msg}`
          explicitStatus = 'error'
        }
      }
    } else if (toolRegistry.hasHandler(toolName)) {
      const dispatched = await dispatchNativeTool(() =>
        toolRegistry.executeNative(toolName, args, {
          conversationId,
          workspacePath,
          model,
          signal,
          callId: tc.id,
          correlationId
        })
      )
      result = dispatched.result
      explicitStatus = dispatched.status
      if (toolName === 'update_plan' && dispatched.status === 'done') {
        try {
          const snapshot = JSON.parse(result)
          emitChatEvent('plan:updated', { conversationId, snapshot })
        } catch {
          // Snapshot shape drifted — renderer refetches on the next
          // conversation switch.
        }
      }
    } else if (toolName.includes('__')) {
      const [serverId, ...nameParts] = toolName.split('__')
      const mcpToolName = nameParts.join('__')
      try {
        const mcpResult = await mcpManager.callTool(serverId, mcpToolName, args)
        result = typeof mcpResult === 'string' ? mcpResult : JSON.stringify(mcpResult)
      } catch (err: any) {
        result = `Error: ${err.message}`
      }
    } else {
      result = `Unknown tool: ${toolName}`
    }
  }

  // Track 2 / C2 — postToolUse fires after the handler completes (whether
  // it succeeded, failed, or was denied by approval/hook). Hooks here can
  // log every invocation but never block — we are past the dispatch point.
  // Awaited so the synchronous JS sandbox completes before the next call
  // in the same window starts.
  if (result === undefined) result = ''
  await fireHooks('postToolUse', {
    conversationId,
    toolName,
    args,
    result,
    cwd: workspacePath
  })

  const duration = Date.now() - startTime
  const finishedAt = startTime + duration
  const auditStatus = explicitStatus ?? classifyToolResult(result)
  toolRegistry.recordCallEnd(tc.id, {
    status: auditStatus,
    result: auditStatus === 'error' ? undefined : result,
    error: auditStatus === 'error' ? result : undefined,
    finishedAt,
    approvalSource,
    correlationId
  })
  emitChatEvent('chat:tool-call-result', {
    callId: tc.id,
    conversationId,
    result,
    duration,
    status: auditStatus === 'done' ? 'success' : auditStatus
  })
  trace('resolveToolCall.return', {
    callId: tc.id,
    toolName,
    duration,
    status: auditStatus,
    resultLen: result.length
  })

  return { callId: tc.id, result }
}
