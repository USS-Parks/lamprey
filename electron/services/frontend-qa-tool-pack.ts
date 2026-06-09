import { toolRegistry } from './tool-registry'
import {
  executeBrowserEvaluateReadonly,
  executeBrowserGetCurrentTab,
  executeBrowserOpen,
  executeBrowserScreenshot,
  type BrowserEvaluateArgs,
  type BrowserOpenArgs,
  type BrowserScreenshotArgs
} from './browser-tools'
import {
  executeFrontendQa,
  type FrontendQaArgs,
  type FrontendQaBrowser
} from './frontend-qa-tool'

const browser: FrontendQaBrowser = {
  open: (args) => executeBrowserOpen(args as BrowserOpenArgs),
  screenshot: (args) => executeBrowserScreenshot(args as BrowserScreenshotArgs),
  getCurrentTab: () => executeBrowserGetCurrentTab(),
  read: (args) => executeBrowserEvaluateReadonly(args as BrowserEvaluateArgs)
}

toolRegistry.registerNative(
  {
    id: 'frontend_qa',
    name: 'frontend_qa',
    title: 'Frontend QA',
    description:
      'Run a conservative browser QA pass against a user-provided dev-server URL. Opens the URL in the in-app browser, captures a screenshot, reads basic page health, and optionally checks expected_text and CSS selectors. Does not auto-detect or start dev servers. Returns a JSON report with screenshotPath, page metadata, checks, and notes.',
    providerKind: 'native',
    providerId: 'internal',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description:
            'The exact URL to inspect, usually a localhost/dev-server URL supplied by the user.'
        },
        expected_text: {
          type: 'array',
          description:
            'Optional visible text snippets that should appear in document.body. Missing snippets fail the QA report.',
          items: { type: 'string' }
        },
        selectors: {
          type: 'array',
          description:
            'Optional CSS selectors that should exist after load. Missing selectors fail the QA report.',
          items: { type: 'string' }
        },
        case_sensitive: {
          type: 'boolean',
          description: 'If true, expected_text checks are case-sensitive. Default false.'
        },
        new_tab: {
          type: 'boolean',
          description: 'If true, opens the URL in a new browser tab. Default false.'
        }
      },
      required: ['url'],
      additionalProperties: false
    },
    risks: ['network', 'read'],
    requiresApproval: false,
    enabled: true
  },
  async (args) => executeFrontendQa(args as unknown as FrontendQaArgs, browser)
)
