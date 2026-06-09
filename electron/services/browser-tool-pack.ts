import { toolRegistry } from './tool-registry'
import {
  executeBrowserClick,
  executeBrowserEvaluateReadonly,
  executeBrowserFind,
  executeBrowserGetCurrentTab,
  executeBrowserOpen,
  executeBrowserScreenshot,
  executeBrowserType,
  type BrowserClickArgs,
  type BrowserEvaluateArgs,
  type BrowserFindArgs,
  type BrowserOpenArgs,
  type BrowserScreenshotArgs,
  type BrowserTypeArgs
} from './browser-tools'

toolRegistry.registerNative(
  {
    id: 'browser_open',
    name: 'browser_open',
    title: 'Browser: Open URL',
    description:
      'Open a URL in the in-app browser. By default reuses the active tab; pass new_tab=true to open in a new tab. Waits for navigation to settle (15s ceiling) before returning. Returns the resolved URL, tab id, and page title.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to open (http/https). Bare hostnames are coerced to https://.' },
        new_tab: {
          type: 'boolean',
          description: 'If true, opens in a new tab instead of reusing the active one. Default false.'
        }
      },
      required: ['url'],
      additionalProperties: false
    },
    risks: ['network'],
    requiresApproval: false,
    enabled: true
  },
  async (args) => executeBrowserOpen(args as unknown as BrowserOpenArgs)
)

toolRegistry.registerNative(
  {
    id: 'browser_click',
    name: 'browser_click',
    title: 'Browser: Click',
    description:
      'Click an element in a browser tab by CSS selector. Defaults to the active tab unless tab_id is provided. Returns "clicked" on success, "not-found" if the selector matched no element.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the element to click.' },
        tab_id: { type: 'string', description: 'Optional tab id. Defaults to the active tab.' }
      },
      required: ['selector'],
      additionalProperties: false
    },
    risks: ['destructive', 'write', 'network'],
    requiresApproval: true,
    enabled: true
  },
  async (args) => executeBrowserClick(args as unknown as BrowserClickArgs)
)

toolRegistry.registerNative(
  {
    id: 'browser_type',
    name: 'browser_type',
    title: 'Browser: Type',
    description:
      'Type text into an element selected by CSS selector. Focuses the element, sets its value (or textContent for contentEditable), then dispatches input and change events. Returns "typed" / "not-found" / "not-editable".',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the input or contentEditable element.' },
        text: { type: 'string', description: 'The text to set as the element value.' },
        tab_id: { type: 'string', description: 'Optional tab id. Defaults to the active tab.' }
      },
      required: ['selector', 'text'],
      additionalProperties: false
    },
    risks: ['destructive', 'write', 'network'],
    requiresApproval: true,
    enabled: true
  },
  async (args) => executeBrowserType(args as unknown as BrowserTypeArgs)
)

toolRegistry.registerNative(
  {
    id: 'browser_find',
    name: 'browser_find',
    title: 'Browser: Find text',
    description:
      'Find text on the active page (or the given tab). Uses Chromium\'s built-in find-in-page. Returns "Found N match(es)" or "No matches".',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text to search for.' },
        tab_id: { type: 'string', description: 'Optional tab id. Defaults to the active tab.' },
        case_sensitive: {
          type: 'boolean',
          description: 'If true, the search is case-sensitive. Default false.'
        }
      },
      required: ['text'],
      additionalProperties: false
    },
    risks: ['read'],
    requiresApproval: false,
    enabled: true
  },
  async (args) => executeBrowserFind(args as unknown as BrowserFindArgs)
)

toolRegistry.registerNative(
  {
    id: 'browser_screenshot',
    name: 'browser_screenshot',
    title: 'Browser: Screenshot',
    description:
      'Capture a PNG screenshot of the visible viewport of the active tab (or the given tab). Writes the file to the user-data artifacts/browser-screenshots directory and returns its absolute path. Full-page capture is not supported by WebContentsView.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        tab_id: { type: 'string', description: 'Optional tab id. Defaults to the active tab.' },
        full_page: {
          type: 'boolean',
          description: 'Reserved. Only false (the default) is supported.'
        }
      },
      additionalProperties: false
    },
    risks: ['read'],
    requiresApproval: false,
    enabled: true
  },
  async (args) => executeBrowserScreenshot(args as unknown as BrowserScreenshotArgs)
)

toolRegistry.registerNative(
  {
    id: 'browser_get_current_tab',
    name: 'browser_get_current_tab',
    title: 'Browser: Get current tab',
    description:
      'Return a JSON object describing the active tab: {id, title, url, loading, canGoBack, canGoForward}. Returns "No active tab" if no tab is open.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    risks: ['read'],
    requiresApproval: false,
    enabled: true
  },
  async () => executeBrowserGetCurrentTab()
)

toolRegistry.registerNative(
  {
    id: 'browser_evaluate_readonly',
    name: 'browser_evaluate_readonly',
    title: 'Browser: Read DOM',
    description:
      'Read DOM state from the active page. Does NOT accept arbitrary JS — pick a structured operation via `kind`: "text" (textContent of matches), "html" (outerHTML), "attr" (attribute value, needs `attr`), "value" (form value), "count" (matches), "exists" (boolean), "title", "url", "meta" (meta tag content by name, needs `attr`), "links" (anchors). `selector` is required for everything except title/url/meta. `limit` caps multi-element returns (default 1, max 50).',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: [
            'text',
            'html',
            'attr',
            'value',
            'count',
            'exists',
            'title',
            'url',
            'meta',
            'links'
          ],
          description: 'Read operation to perform.'
        },
        selector: {
          type: 'string',
          description:
            'CSS selector. Required for text/html/attr/value/count/exists. Optional for links (default "a").'
        },
        attr: {
          type: 'string',
          description:
            'Attribute name. Required when kind="attr" (HTML attribute) or kind="meta" (meta tag name).'
        },
        limit: {
          type: 'number',
          description:
            'For multi-match kinds (text/html/attr/value/links), return up to this many. Default 1, max 50.'
        }
      },
      required: ['kind'],
      additionalProperties: false
    },
    risks: ['read'],
    requiresApproval: false,
    enabled: true
  },
  async (args) => executeBrowserEvaluateReadonly(args as unknown as BrowserEvaluateArgs)
)
