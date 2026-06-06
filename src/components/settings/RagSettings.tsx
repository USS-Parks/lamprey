import { useEffect, useState } from 'react'
import { useRagStore } from '@/stores/rag-store'

// RAG settings panel. Surfaces the rag block of AppSettings. Apply-on-change
// (no Save button) — same convention as the other settings tabs.

interface RagSettingsValue {
  enabled: boolean
  defaultEmbedderId: string
  autoRagInConversations: boolean
  chunkSize: number
  chunkOverlap: number
  lexK: number
  vecK: number
  fusedTopN: number
  rerankMode: 'off' | 'local-cross-encoder' | 'llm'
  multiQueryRewrite: boolean
  citationRequired: boolean
}

const DEFAULTS: RagSettingsValue = {
  enabled: true,
  defaultEmbedderId: 'bge-small-en-v1.5',
  autoRagInConversations: true,
  chunkSize: 800,
  chunkOverlap: 100,
  lexK: 30,
  vecK: 30,
  fusedTopN: 8,
  rerankMode: 'off',
  multiQueryRewrite: false,
  citationRequired: false
}

export function RagSettings() {
  const embedders = useRagStore((s) => s.embedders)
  const activeEmbedderId = useRagStore((s) => s.activeEmbedderId)
  const loadEmbedders = useRagStore((s) => s.loadEmbedders)
  const setActiveEmbedder = useRagStore((s) => s.setActiveEmbedder)
  const [value, setValue] = useState<RagSettingsValue>(DEFAULTS)

  // Hydrate from settings.json's `rag` block on mount.
  useEffect(() => {
    void loadEmbedders()
    const load = async (): Promise<void> => {
      if (!window.api?.settings) return
      const res = await window.api.settings.get()
      if (res?.success) {
        const rag = (res.data as { rag?: Partial<RagSettingsValue> }).rag
        if (rag) setValue({ ...DEFAULTS, ...rag })
      }
    }
    void load()
  }, [loadEmbedders])

  const update = async (patch: Partial<RagSettingsValue>): Promise<void> => {
    const next = { ...value, ...patch }
    setValue(next)
    if (window.api?.settings) {
      await window.api.settings.set({ rag: next })
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[14px] font-medium text-[var(--text-primary)]">RAG</h2>
        <p className="mt-1 text-[12px] text-[var(--text-muted)]">
          Local retrieval over your indexed documents. All embeddings and
          search run on-device.
        </p>
      </div>

      <Section title="Embeddings model">
        <select
          value={activeEmbedderId ?? value.defaultEmbedderId}
          onChange={(e) => {
            void setActiveEmbedder(e.target.value)
            void update({ defaultEmbedderId: e.target.value })
          }}
          className="w-full rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-1 font-mono text-[12px] text-[var(--text-primary)]"
        >
          {embedders.length === 0 && <option value="">Loading…</option>}
          {embedders.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} — {Math.round(e.approxBytes / 1024 / 1024)} MB
            </option>
          ))}
        </select>
      </Section>

      <Section title="Chunking">
        <NumericRow
          label="Chunk size (chars)"
          value={value.chunkSize}
          min={200}
          max={2000}
          onChange={(n) => update({ chunkSize: n })}
        />
        <NumericRow
          label="Overlap (chars)"
          value={value.chunkOverlap}
          min={0}
          max={400}
          onChange={(n) => update({ chunkOverlap: n })}
        />
      </Section>

      <Section title="Retrieval">
        <NumericRow
          label="Lex top-K"
          value={value.lexK}
          min={0}
          max={100}
          onChange={(n) => update({ lexK: n })}
        />
        <NumericRow
          label="Vec top-K"
          value={value.vecK}
          min={0}
          max={100}
          onChange={(n) => update({ vecK: n })}
        />
        <NumericRow
          label="Fused top-N"
          value={value.fusedTopN}
          min={1}
          max={50}
          onChange={(n) => update({ fusedTopN: n })}
        />
      </Section>

      <Section title="Rerank">
        <select
          value={value.rerankMode}
          onChange={(e) =>
            update({ rerankMode: e.target.value as RagSettingsValue['rerankMode'] })
          }
          className="w-full rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-2 py-1 font-mono text-[12px] text-[var(--text-primary)]"
        >
          <option value="off">Off (fastest)</option>
          <option value="local-cross-encoder">
            Local cross-encoder (slow, highest quality)
          </option>
          <option value="llm">LLM as reranker (uses active model)</option>
        </select>
      </Section>

      <Toggle
        label="Multi-query rewrite"
        hint="Planner rewrites your query into 2–3 phrasings; results unioned via RRF."
        value={value.multiQueryRewrite}
        onChange={(v) => update({ multiQueryRewrite: v })}
      />
      <Toggle
        label="Auto-RAG in conversations"
        hint="When on, every chat turn in a conversation with attached collections runs retrieval automatically."
        value={value.autoRagInConversations}
        onChange={(v) => update({ autoRagInConversations: v })}
      />
      <Toggle
        label="Citation required"
        hint="Model is instructed to refuse if no source supports a claim."
        value={value.citationRequired}
        onChange={(v) => update({ citationRequired: v })}
      />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="font-mono text-[11px] uppercase text-[var(--text-muted)]">
        {title}
      </h3>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  )
}

function NumericRow({
  label,
  value,
  min,
  max,
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (n: number) => void
}) {
  return (
    <label className="flex items-center justify-between gap-2 font-mono text-[11px]">
      <span className="text-[var(--text-secondary)]">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10)
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)))
        }}
        className="w-24 rounded border border-[var(--panel-border)] bg-[var(--bg-primary)] px-1 py-0.5 text-right font-mono text-[11px] text-[var(--text-primary)]"
      />
    </label>
  )
}

function Toggle({
  label,
  hint,
  value,
  onChange
}: {
  label: string
  hint?: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 font-mono text-[11px]">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <div className="flex flex-col">
        <span className="text-[var(--text-primary)]">{label}</span>
        {hint && <span className="text-[var(--text-muted)]">{hint}</span>}
      </div>
    </label>
  )
}
