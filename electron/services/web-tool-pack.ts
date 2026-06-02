import { toolRegistry } from './tool-registry'
import {
  executeImageSearch,
  executeTimeLookup,
  executeWebFind,
  executeWebOpen,
  executeWebSearch,
  type ImageSearchArgs,
  type TimeLookupArgs,
  type WebFindArgs,
  type WebOpenArgs,
  type WebSearchArgs
} from './web-tools'

// All five web tools are network-touching read-only operations (except
// time_lookup which is local). requiresApproval is false by default; the
// `network` risk badge is what a future per-conversation policy would gate
// on. See PLANNING/CODEX_TOOLSET_PARITY_PROGRESS.md "known gaps" for the
// status of sticky network policies.
toolRegistry.registerNative(
  {
    id: 'web_search',
    name: 'web_search',
    title: 'Web search',
    description:
      'Search the web using the configured provider (Brave, Tavily, SerpAPI, or SearXNG). Returns a numbered list of title + URL + snippet, optionally filtered by freshness (day/week/month/year).',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query.' },
        count: {
          type: 'number',
          description: 'Number of results to return (default 5, max 10).'
        },
        freshness: {
          type: 'string',
          enum: ['day', 'week', 'month', 'year'],
          description: 'Optional time-window filter for recency.'
        }
      },
      required: ['query']
    },
    risks: ['network', 'read'],
    requiresApproval: false,
    enabled: true
  },
  async (args) => executeWebSearch(args as unknown as WebSearchArgs)
)

toolRegistry.registerNative(
  {
    id: 'web_open',
    name: 'web_open',
    title: 'Open webpage',
    description:
      'Fetch an http(s) URL and return its visible text plus the page title. Response body is capped at 1 MB; returned text is capped at 50 KB. The fetched page is cached for follow-up web_find calls.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'http(s) URL to fetch.' },
        as: {
          type: 'string',
          enum: ['text', 'markdown'],
          description: 'Output format (default text). Markdown is currently rendered the same as text.'
        }
      },
      required: ['url']
    },
    risks: ['network', 'read'],
    requiresApproval: false,
    enabled: true
  },
  async (args) => executeWebOpen(args as unknown as WebOpenArgs)
)

toolRegistry.registerNative(
  {
    id: 'web_find',
    name: 'web_find',
    title: 'Find in webpage',
    description:
      'Search for substring matches inside a previously fetched page. If the URL is not yet cached, it is fetched first. Returns up to 5 matched lines with one line of context before/after each.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'http(s) URL previously opened (or to open now).' },
        text: { type: 'string', description: 'Substring to search for.' },
        case_sensitive: {
          type: 'boolean',
          description: 'Match case-sensitively. Default false.'
        }
      },
      required: ['url', 'text']
    },
    risks: ['read'],
    requiresApproval: false,
    enabled: true
  },
  async (args) => executeWebFind(args as unknown as WebFindArgs)
)

toolRegistry.registerNative(
  {
    id: 'image_search',
    name: 'image_search',
    title: 'Image search',
    description:
      'Search for images using the configured web search provider. Returns a numbered list of title + thumbnail URL + source page URL.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Image search query.' },
        count: {
          type: 'number',
          description: 'Number of results to return (default 5, max 10).'
        }
      },
      required: ['query']
    },
    risks: ['network', 'read'],
    requiresApproval: false,
    enabled: true
  },
  async (args) => executeImageSearch(args as unknown as ImageSearchArgs)
)

toolRegistry.registerNative(
  {
    id: 'time_lookup',
    name: 'time_lookup',
    title: 'Time lookup',
    description:
      'Return the current date and time, formatted for the given IANA timezone (e.g. "America/Los_Angeles"). Defaults to UTC. No network access.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        timezone: {
          type: 'string',
          description: 'IANA timezone identifier (e.g. "America/Los_Angeles"). Defaults to "UTC".'
        }
      }
    },
    risks: ['read'],
    requiresApproval: false,
    enabled: true
  },
  async (args) => executeTimeLookup(args as unknown as TimeLookupArgs)
)
