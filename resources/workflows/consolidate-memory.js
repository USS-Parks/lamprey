/* global agent, args, log, memory, phase */

export const meta = {
  name: 'consolidate-memory',
  description:
    'Merge duplicate or near-duplicate typed memory entries, write the consolidated files, and delete entries fully represented by the merge.',
  phases: [
    { title: 'Load' },
    { title: 'Consolidate' },
    { title: 'Write' }
  ]
}

const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference']
const requestedType = args && args.type ? String(args.type) : 'project'
const type = MEMORY_TYPES.includes(requestedType) ? requestedType : 'project'

function compactEntry(entry) {
  return {
    name: String(entry && entry.name ? entry.name : ''),
    projectSlug: String(entry && entry.projectSlug ? entry.projectSlug : '__global__'),
    description: String(entry && entry.description ? entry.description : ''),
    type: String(entry && entry.type ? entry.type : type),
    body: String(entry && entry.body ? entry.body : '')
  }
}

function extractJson(value) {
  if (value && typeof value === 'object') return value
  const text = String(value || '').trim()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1))
    }
  }
  return null
}

phase('Load')
const supplied = args && Array.isArray(args.entries) ? args.entries : null
const loaded = supplied || await memory.list({ type })
const entries = loaded
  .map(compactEntry)
  .filter((entry) => entry.name && entry.type === type && entry.body.trim())

if (entries.length < 2) {
  return { type, kept: entries.length, written: 0, deleted: 0, note: 'fewer than two entries' }
}

phase('Consolidate')
const proposal = await agent(
  `You are consolidating Lamprey memory files of type "${type}".

Input entries are JSON. Merge only true duplicates or near-duplicates. Preserve distinct facts and user preferences. Do not invent facts. Prefer existing names when keeping entries; if you create a new merged name, use lowercase slug-friendly words. Delete an input entry only when its facts are fully represented by an entry you return.

Return exactly this JSON object and nothing else:
{
  "entries": [
    { "name": "existing_or_new_name", "projectSlug": "__global__", "description": "short hook", "body": "complete markdown body" }
  ],
  "deleteNames": ["obsolete_entry_name"]
}

Input entries:
${JSON.stringify(entries, null, 2)}`,
  {
    label: 'memory-consolidator',
    phase: 'Consolidate',
    agentType: 'general',
    model: 'pro'
  }
)

const parsed = extractJson(proposal)
const proposedEntries = parsed && Array.isArray(parsed.entries) ? parsed.entries : []
const proposedDeleteNames = parsed && Array.isArray(parsed.deleteNames) ? parsed.deleteNames : []

const byName = new Map(entries.map((entry) => [entry.name, entry]))
const writes = proposedEntries
  .map((entry) => {
    const fallback = byName.get(String(entry && entry.name ? entry.name : '')) || entries[0]
    return {
      name: String(entry && entry.name ? entry.name : fallback.name),
      projectSlug: String(entry && entry.projectSlug ? entry.projectSlug : fallback.projectSlug),
      description: String(entry && entry.description ? entry.description : fallback.description),
      type,
      body: String(entry && entry.body ? entry.body : fallback.body)
    }
  })
  .filter((entry) => entry.name && entry.body.trim())

const deleteNames = proposedDeleteNames
  .map((name) => String(name || '').trim())
  .filter((name) => byName.has(name))

if (writes.length === 0 && deleteNames.length === 0) {
  return { type, kept: entries.length, written: 0, deleted: 0, note: 'no consolidation proposed' }
}

phase('Write')
const written = []
for (const entry of writes) {
  written.push(await memory.write(entry))
}

const writeNames = new Set(writes.map((entry) => entry.name))
let deleted = 0
for (const name of deleteNames) {
  if (writeNames.has(name)) continue
  const removed = await memory.delete(name)
  if (removed) deleted += 1
}

log('Consolidated ' + entries.length + ' ' + type + ' memories into ' + written.length + ' writes; deleted ' + deleted + '.')

return {
  type,
  scanned: entries.length,
  written: written.length,
  deleted,
  keptNames: writes.map((entry) => entry.name)
}
