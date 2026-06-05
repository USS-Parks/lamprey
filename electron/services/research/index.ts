import { randomUUID } from 'crypto'
import { app } from 'electron'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { DepthTier } from './intent'
import type { PlannedQuery } from './planner'
import type { CuratedSource } from './collector'
import type { ExtractedPage } from './extractor'
import type { Claim } from './claims'
import type { ClaimSet, EmbeddingProvider } from './corroborator'
import { planQueries } from './planner'
import { collectSources } from './collector'
import { extractAll } from './extractor'
import { extractClaimsAll } from './claims'
import { corroborateWithOpposition } from './corroborator'
import { synthesizeReport, FabricatedCitationError } from './synthesizer'
import { registerArtifact } from '../research-artifacts-store'

// Public orchestrator entry point for the deep-research pipeline.
//
// Stages (in order):
//   1. plan      — planner → 3..8 sub-queries
//   2. collect   — adapter cascade fan-out → CuratedSource[N]
//   3. extract   — readable-text per page (parallel, cap 6)
//   4. claims    — atomic factual claims per page (parallel, cap 6)
//   5. corroborate — embedding-clustered + opposition LLM
//   6. synthesize — strict-citation markdown
//   7. emit      — write `.md` artifact to userData/artifacts/research/
//
// Cancellation: an `AbortSignal` threads through every stage. The
// orchestrator checks `signal.aborted` at every stage boundary and gives
// each LLM call ~3s to wind down before declaring the run cancelled.
//
// Progress: `onProgress` (or the default chat-event bridge in D12) is
// invoked at every stage boundary with a snapshot the renderer can
// display: `{stage, sourcesFound, sourcesFetched, claimsExtracted,
//   claimsAccepted, elapsedMs}`.

export type ResearchStage =
  | 'planning'
  | 'searching'
  | 'reading'
  | 'extracting-claims'
  | 'corroborating'
  | 'synthesizing'
  | 'writing-artifact'
  | 'done'
  | 'cancelled'
  | 'failed'

export interface ResearchProgress {
  runId: string
  conversationId: string
  stage: ResearchStage
  sourcesFound: number
  sourcesFetched: number
  claimsExtracted: number
  claimsAccepted: number
  claimsDisputed: number
  elapsedMs: number
  /** Last error message when stage is 'failed'. */
  error?: string
}

export interface RunDeepResearchOpts {
  question: string
  depth: DepthTier
  conversationId: string
  correlationId: string
  abortSignal?: AbortSignal
  onProgress?: (event: ResearchProgress) => void
  /** Test-only stage overrides. */
  deps?: OrchestratorDeps
  /** Override artifact directory (defaults to `userData/artifacts/research/`). */
  artifactDir?: string
  /** Override the model used for synthesis (defaults to settings). */
  synthModel?: string
  /** Override the model used for planner / claims / opposition LLM calls. */
  cheapModel?: string
}

export interface OrchestratorDeps {
  planQueries?: typeof planQueries
  collectSources?: typeof collectSources
  extractAll?: typeof extractAll
  extractClaimsAll?: typeof extractClaimsAll
  corroborate?: (
    claims: Claim[],
    sources: CuratedSource[],
    embeddings: EmbeddingProvider
  ) => Promise<ClaimSet>
  synthesizeReport?: typeof synthesizeReport
  /** Inject the embedding provider directly so tests don't load the real RAG worker. */
  embeddings?: EmbeddingProvider
  /** Replace the artifact-write step with a memory-only sink for tests. */
  writeArtifact?: (path: string, contents: string) => void
  /** Override the current-time clock for deterministic tests. */
  now?: () => number
  /** Override the accessed-at date string used in the bibliography. */
  accessedAt?: string
}

export interface DeepResearchOutcome {
  runId: string
  artifactPath: string
  filename: string
  /** Brief executive summary (1-3 sentences) shown inline in chat. */
  summary: string
  /** Full markdown report. */
  markdown: string
  sourceCount: number
  acceptedCount: number
  singleSourceCount: number
  disputedCount: number
  providersUsed: string[]
  elapsedMs: number
}

export class DeepResearchCancelledError extends Error {
  constructor() {
    super('Deep research run was cancelled.')
    this.name = 'DeepResearchCancelledError'
  }
}

// Re-export typed errors so the chat dispatch can `instanceof` them.
export { FabricatedCitationError } from './synthesizer'

// Kept for backwards-compat with the D3 stub. Always returns false now
// that the real orchestrator is wired.
export function isDeepResearchNotImplemented(_err: unknown): boolean {
  return false
}

export async function runDeepResearch(opts: RunDeepResearchOpts): Promise<DeepResearchOutcome> {
  const runId = randomUUID()
  const deps = opts.deps ?? {}
  const now = deps.now ?? Date.now
  const startedAt = now()
  const signal = opts.abortSignal ?? new AbortController().signal
  let progressSnapshot: ResearchProgress = {
    runId,
    conversationId: opts.conversationId,
    stage: 'planning',
    sourcesFound: 0,
    sourcesFetched: 0,
    claimsExtracted: 0,
    claimsAccepted: 0,
    claimsDisputed: 0,
    elapsedMs: 0
  }

  const emit = (next: Partial<ResearchProgress>): void => {
    progressSnapshot = { ...progressSnapshot, ...next, elapsedMs: now() - startedAt }
    try {
      opts.onProgress?.(progressSnapshot)
    } catch (err) {
      console.warn('[research] onProgress callback threw:', err)
    }
  }

  const checkAbort = (): void => {
    if (signal.aborted) {
      emit({ stage: 'cancelled' })
      throw new DeepResearchCancelledError()
    }
  }

  try {
    // -- Stage 1: plan --
    emit({ stage: 'planning' })
    const plan = await (deps.planQueries ?? planQueries)(opts.question, opts.depth, opts.cheapModel)
    checkAbort()

    // -- Stage 2: collect --
    emit({ stage: 'searching' })
    const collect = await (deps.collectSources ?? collectSources)(plan.queries, opts.depth, {
      signal
    })
    emit({
      stage: 'searching',
      sourcesFound: collect.sources.length
    })
    checkAbort()

    if (collect.sources.length === 0) {
      emit({ stage: 'failed', error: 'No sources found for the planner queries.' })
      throw new Error('No sources found for the planner queries.')
    }

    // -- Stage 3: extract --
    emit({ stage: 'reading' })
    const extracted = await (deps.extractAll ?? extractAll)(collect.sources, 6, signal)
    const okPages = extracted.filter((p) => p.status === 'ok')
    emit({ stage: 'reading', sourcesFetched: okPages.length })
    checkAbort()

    if (okPages.length === 0) {
      emit({ stage: 'failed', error: 'No pages could be extracted from the curated sources.' })
      throw new Error('No pages could be extracted from the curated sources.')
    }

    // -- Stage 4: claim extraction --
    emit({ stage: 'extracting-claims' })
    const claims = await (deps.extractClaimsAll ?? extractClaimsAll)(
      okPages,
      6,
      opts.cheapModel,
      undefined,
      signal
    )
    emit({ stage: 'extracting-claims', claimsExtracted: claims.length })
    checkAbort()

    if (claims.length === 0) {
      emit({ stage: 'failed', error: 'No factual claims were extracted from the sources.' })
      throw new Error('No factual claims were extracted from the sources.')
    }

    // -- Stage 5: corroborate --
    emit({ stage: 'corroborating' })
    const embeddings = deps.embeddings ?? (await loadEmbeddingsProvider())
    const corroborate = deps.corroborate ?? ((c, s, e) => corroborateWithOpposition(c, s, e))
    const claimSet = await corroborate(claims, collect.sources, embeddings)
    emit({
      stage: 'corroborating',
      claimsAccepted: claimSet.accepted.length,
      claimsDisputed: claimSet.disputed.length
    })
    checkAbort()

    // -- Stage 6: synthesize --
    emit({ stage: 'synthesizing' })
    const accessedAt = deps.accessedAt ?? new Date(startedAt).toISOString().slice(0, 10)
    const synth = await (deps.synthesizeReport ?? synthesizeReport)(
      {
        question: opts.question,
        claimSet,
        sources: collect.sources,
        accessedAt,
        modelOverride: opts.synthModel
      }
    )
    checkAbort()

    // -- Stage 7: write artifact --
    emit({ stage: 'writing-artifact' })
    const dir = opts.artifactDir ?? defaultArtifactDir()
    mkdirSync(dir, { recursive: true })
    const filename = `research-${synth.filenameSlug}-${startedAt}.md`
    const filePath = join(dir, filename)
    const writer = deps.writeArtifact ?? ((p, c) => writeFileSync(p, c, 'utf-8'))
    writer(filePath, synth.markdown)

    // D11 — register the artifact so the renderer can list / open /
    // download it via window.api.research.list / read / download.
    if (!deps.writeArtifact) {
      try {
        registerArtifact(filename, filePath, opts.question, Buffer.byteLength(synth.markdown, 'utf-8'), startedAt)
      } catch (err) {
        console.warn('[research] failed to register artifact:', err)
      }
    }

    emit({ stage: 'done' })

    return {
      runId,
      artifactPath: filePath,
      filename,
      summary: synth.summary,
      markdown: synth.markdown,
      sourceCount: synth.citedSources.length,
      acceptedCount: claimSet.accepted.length,
      singleSourceCount: claimSet.singleSource.length,
      disputedCount: claimSet.disputed.length,
      providersUsed: collect.providersUsed,
      elapsedMs: now() - startedAt
    }
  } catch (err) {
    if (err instanceof DeepResearchCancelledError) {
      throw err
    }
    if (err instanceof FabricatedCitationError) {
      emit({
        stage: 'failed',
        error: `Synthesizer cited indices not present in the source pool: ${err.fabricatedRefs.join(', ')}.`
      })
      throw err
    }
    emit({ stage: 'failed', error: (err as Error).message ?? String(err) })
    throw err
  }
}

function defaultArtifactDir(): string {
  const userData = app.getPath('userData')
  return join(userData, 'artifacts', 'research')
}

async function loadEmbeddingsProvider(): Promise<EmbeddingProvider> {
  // Lazy-load the RAG embeddings service so tests don't pay the cost of
  // bringing in the worker_threads module.
  const { getEmbeddingsService } = await import('../rag/embeddings/service')
  const userData = app.getPath('userData')
  const svc = getEmbeddingsService(userData)
  return {
    embed: (texts: string[]) => svc.embed(texts)
  }
}

// ---------------------------------------------------------------------
// Active-run registry — exported so the IPC layer can cancel by runId.
// ---------------------------------------------------------------------

const activeRuns = new Map<string, { controller: AbortController; conversationId: string; lastProgress: ResearchProgress | null; startedAt: number }>()

export function registerRun(runId: string, controller: AbortController, conversationId: string): void {
  activeRuns.set(runId, { controller, conversationId, lastProgress: null, startedAt: Date.now() })
}

export function recordProgress(runId: string, snap: ResearchProgress): void {
  const entry = activeRuns.get(runId)
  if (entry) entry.lastProgress = snap
}

export function deregisterRun(runId: string): void {
  activeRuns.delete(runId)
}

export function cancelRun(runId: string): boolean {
  const entry = activeRuns.get(runId)
  if (!entry) return false
  entry.controller.abort()
  return true
}

export function getRunStatus(runId: string): ResearchProgress | null {
  return activeRuns.get(runId)?.lastProgress ?? null
}

export function listActiveRuns(): Array<{ runId: string; conversationId: string; startedAt: number; lastProgress: ResearchProgress | null }> {
  return Array.from(activeRuns.entries()).map(([runId, entry]) => ({
    runId,
    conversationId: entry.conversationId,
    startedAt: entry.startedAt,
    lastProgress: entry.lastProgress
  }))
}

/** Reset the active-run registry — exported for tests only. */
export function __resetActiveRuns(): void {
  for (const e of activeRuns.values()) e.controller.abort()
  activeRuns.clear()
}
