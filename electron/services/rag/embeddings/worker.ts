// Worker-thread that hosts a transformers.js feature-extraction pipeline.
// Spawned by `service.ts`. Communication is via the standard worker
// `postMessage` / `parentPort.on('message')` protocol.
//
// Why a worker, not just async?
//   ONNX inference is CPU-heavy; a 2,000-chunk ingest would freeze the
//   main process for tens of seconds and block IPC. With a worker, ingest
//   is backgrounded and the UI stays responsive.
//
// Why not native llama.cpp?
//   Binary distribution headache (per-arch, per-OS, GPU/CPU) for marginal
//   quality gain. transformers.js trades a small speed hit for zero-config
//   installation across every Lamprey target.

import { parentPort, workerData } from 'worker_threads'
import { join } from 'path'

// transformers.js is a top-level dependency but the worker entry runs in a
// fresh module graph. Cache the dynamic-import result so subsequent embed
// calls don't pay the import cost on each message.
type PipelineFn = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean }
) => Promise<{
  data: Float32Array
  dims: number[]
}>

interface WorkerInitData {
  userDataPath: string
}

interface LoadMessage {
  type: 'load'
  modelRef: string
  id: string
}

interface EmbedMessage {
  type: 'embed'
  texts: string[]
  id: string
}

interface DisposeMessage {
  type: 'dispose'
}

type InboundMessage = LoadMessage | EmbedMessage | DisposeMessage

let pipelineP: Promise<PipelineFn> | null = null
let currentModelRef: string | null = null

async function ensurePipeline(modelRef: string): Promise<PipelineFn> {
  if (pipelineP && currentModelRef === modelRef) return pipelineP
  // Reset the cached promise when the model id changes so a switch loads
  // the new weights instead of returning the old pipeline.
  currentModelRef = modelRef
  pipelineP = (async () => {
    // transformers.js ships its own types; types align so no override
    // needed. We narrow to the two named exports we actually use.
    const { pipeline, env } = (await import('@xenova/transformers')) as unknown as {
      pipeline: (
        task: string,
        modelRef: string
      ) => Promise<(texts: string[], opts: { pooling: 'mean'; normalize: boolean }) => Promise<{ data: Float32Array; dims: number[] }>>
      env: { cacheDir: string }
    }
    const data = workerData as WorkerInitData
    // Pin the model cache to userData so production installs share the
    // download between sessions. In headless tests workerData is undefined
    // (the worker isn't actually spawned), so guard the assignment.
    if (data?.userDataPath) {
      env.cacheDir = join(data.userDataPath, 'models', 'transformers')
    }
    const pipe = await pipeline('feature-extraction', modelRef)
    return async (texts: string[], options) => {
      const out = await pipe(texts, options)
      // transformers.js Tensor → { data, dims } shape.
      return { data: out.data as Float32Array, dims: out.dims as number[] }
    }
  })()
  return pipelineP
}

async function handleLoad(msg: LoadMessage): Promise<void> {
  try {
    await ensurePipeline(msg.modelRef)
    parentPort?.postMessage({ type: 'load:done', id: msg.id })
  } catch (err) {
    parentPort?.postMessage({
      type: 'error',
      id: msg.id,
      message: (err as Error)?.message ?? String(err)
    })
  }
}

async function handleEmbed(msg: EmbedMessage): Promise<void> {
  try {
    if (!pipelineP) {
      throw new Error('embed received before load — call setActive first')
    }
    const pipe = await pipelineP
    const out = await pipe(msg.texts, { pooling: 'mean', normalize: true })
    // The flat `data` is a stacked Float32Array of length texts.length *
    // dims. Slice into per-text vectors so the main thread doesn't have to
    // re-derive the layout.
    const [n, dim] = out.dims
    const vectors: Float32Array[] = []
    for (let i = 0; i < n; i++) {
      vectors.push(out.data.slice(i * dim, (i + 1) * dim))
    }
    parentPort?.postMessage({ type: 'embed:done', id: msg.id, vectors })
  } catch (err) {
    parentPort?.postMessage({
      type: 'error',
      id: msg.id,
      message: (err as Error)?.message ?? String(err)
    })
  }
}

parentPort?.on('message', (msg: InboundMessage) => {
  if (!msg || typeof msg !== 'object' || typeof (msg as { type: string }).type !== 'string') return
  switch (msg.type) {
    case 'load':
      void handleLoad(msg)
      break
    case 'embed':
      void handleEmbed(msg)
      break
    case 'dispose':
      pipelineP = null
      currentModelRef = null
      break
  }
})
