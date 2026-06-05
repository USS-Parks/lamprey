// Barrel for the snip service. Importers (tool-registry, ipc/snip)
// pull from here so the internal file layout can move without ripple.

export { applySnip } from './apply'
export type { SnipApplyContext, SnipApplyOutcome } from './apply'
export {
  initializeFilterLoader,
  shutdownFilterLoader,
  listActiveFilters,
  listAllFilters,
  listLoadErrors,
  reloadAllFilters,
  getUserFilterDir,
  getBuiltInFilterDir,
  subscribeFilterChanges
} from './filter-loader'
export type { FilterListEntry } from './filter-loader'
export type { FilterLoadError } from './filter-schema'
export {
  recordEvent,
  recordCommandLog,
  getStats,
  getRecent,
  getUnfilteredCommands,
  clearAll
} from './tracking'
export type {
  Filter,
  MatchSpec,
  PipelineAction,
  SnipEvent,
  SnipStats,
  SnipRecentRow,
  SnipDiscoverSuggestion
} from './types'
