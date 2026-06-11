/**
 * Compact fallback label for a model id the catalog doesn't know (legacy
 * rows, removed custom models): 'deepseek-v4-pro' → 'Deepseek V4 Pro',
 * 'qwen3-coder-plus' → 'Qwen3 Coder Plus'.
 *
 * The MessageBubble model chip predates the multi-provider era and used to
 * hardcode `'deepseek-reasoner' ? 'R1' : 'V3'`, mislabeling every modern
 * model as "V3". The chip now prefers the catalog display name (model-store
 * `ModelInfo.name`, the same source the ModelSwitcher shows) and uses this
 * formatter only when the id is not in the catalog.
 */
export function formatModelIdFallback(modelId: string): string {
  return modelId
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((part) =>
      /^v?\d/.test(part) ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)
    )
    .join(' ')
}
